/**
 * Ein Original in Cloud Storage -> seine Webversionen in R2 und ein Eintrag dazu
 * in Firestore. Benutzt vom Upload-Trigger (index.js) und vom Nachholen
 * (backfill.js), damit beide genau dieselben Dateien erzeugen.
 *
 * Webversionen heißen nach der MD5 des Originals („Fingerabdruck“) und ändern
 * sich nie: Ein ersetztes Original bekommt neue Namen, so dass eine
 * veröffentlichte Seite zeigt, womit sie gebaut wurde, bis zum nächsten Deploy.
 *
 *   R2:        <artist>/<md5>-<breite>.avif|webp   Bilder und erste Seiten von PDFs
 *              <artist>/<md5>.<endung>             Videos, unverändert kopiert
 *   Firestore: artists/<artist>/medien/<md5>       Breite, Höhe, Breiten, Formate, Vorschau
 */
import { createRequire } from "module";
import path from "path";
import sharp from "sharp";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export const R2_KONTO = "cf3fa9a06c8f2e93e24fa3eeaa80b783";
export const R2_BUCKET = "werkverzeichnis-bilder";

/** Breiten, aus denen die Seite wählt; kleinere Originale bekommen nur die, die sie erreichen. */
export const BREITEN = [400, 800, 1200, 2000];

const BILD = /\.(jpe?g|png|webp|gif|tiff?)$/i;
const VIDEO = /\.(mp4|webm)$/i;
const PDF = /\.pdf$/i;

/** Lange Seite der gerenderten ersten PDF-Seite, bevor die üblichen Breiten entstehen. */
const PDF_GROESSE = 2000;
const ORIGINAL = /^artists\/([^/]+)\/(works|werkgruppen)\/[^/]+\/[^/]+$/;

/** Welche Originale verarbeitet werden, und für welche Künstler:in; sonst null. */
export function kuenstlerVon(objektPfad) {
  return objektPfad.match(ORIGINAL)?.[1] ?? null;
}

export const fingerabdruck = md5Base64 => Buffer.from(md5Base64, "base64").toString("hex");

export function r2Client(accessKeyId, secretAccessKey) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${R2_KONTO}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

const hochladen = (r2, schluessel, inhalt, typ) => r2.send(new PutObjectCommand({
  Bucket: R2_BUCKET, Key: schluessel, Body: inhalt, ContentType: typ,
  // Ändert sich unter diesem Namen nie, Caches dürfen es für immer behalten.
  CacheControl: "public, max-age=31536000, immutable",
}));

/**
 * Ein Original verarbeiten. `datei` ist eine @google-cloud/storage-File, `md5`
 * ihre MD5, wie GCS sie meldet (base64), `kuenstlerDok` das Firestore-Dokument
 * der Künstler:in. Tut nichts, wenn dieser Fingerabdruck schon erledigt ist.
 * Gibt zurück, was eingetragen wurde, oder null für nicht behandelte Dateien.
 */
export async function originalVerarbeiten({ datei, md5, kuenstlerDok, r2, copyright }) {
  const name = datei.name;
  const kuenstler = kuenstlerVon(name);
  if (!kuenstler) return null;
  const id = fingerabdruck(md5);
  const eintrag = kuenstlerDok.collection("medien").doc(id);
  const vorhanden = await eintrag.get();
  if (vorhanden.exists) return vorhanden.data();

  const [bytes] = await datei.download();
  const basis = `${kuenstler}/${id}`;
  let daten, ausgaben;
  try {
    ({ daten, ausgaben } = await rendern(name, bytes, basis, copyright));
  } catch (e) {
    // Eine Datei, die sharp nicht lesen kann, wird durch Wiederholen nicht besser:
    // eintragen und weiter.
    daten = { art: "fehler", fehler: String(e.message ?? e).slice(0, 500) };
    ausgaben = [];
  }
  // Fehler beim Hochladen dagegen werden geworfen, damit der Trigger es erneut versucht.
  for (const a of ausgaben) await hochladen(r2, a.schluessel, a.inhalt, a.typ);

  daten = { ...daten, original: name, erstellt: new Date() };
  await eintrag.set(daten);
  return daten;
}

/** Die Dateien zu einem Original und sein Eintrag. Nur sharp, kein Netz. */
async function rendern(name, bytes, basis, copyright) {
  if (VIDEO.test(name)) {
    const endung = name.match(VIDEO)[1].toLowerCase();
    return {
      daten: { art: "video", formate: [endung], groesse: bytes.length },
      ausgaben: [{ schluessel: `${basis}.${endung}`, inhalt: bytes,
        typ: endung === "mp4" ? "video/mp4" : "video/webm" }],
    };
  }
  if (PDF.test(name)) {
    // Die erste Seite steht für das Dokument (meist gescannte Drucke).
    const { png, seiten } = await ersteSeiteVonPdf(bytes);
    const ergebnis = await bildRendern(png, basis, copyright);
    return { ...ergebnis, daten: { ...ergebnis.daten, quelle: "pdf", seiten } };
  }
  if (!BILD.test(name)) return { daten: { art: "nicht unterstützt" }, ausgaben: [] };
  return bildRendern(bytes, basis, copyright);
}

/** Erste Seite eines PDFs als PNG, PDF_GROESSE an der langen Seite. pdf.js, erst bei Bedarf geladen. */
async function ersteSeiteVonPdf(bytes) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");
  const schriften = path.join(path.dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")),
    "standard_fonts") + path.sep;
  const aufgabe = getDocument({
    data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0, standardFontDataUrl: schriften,
  });
  try {
    const pdf = await aufgabe.promise;
    const seite = await pdf.getPage(1);
    const natuerlich = seite.getViewport({ scale: 1 });
    const viewport = seite.getViewport({ scale: PDF_GROESSE / Math.max(natuerlich.width, natuerlich.height) });
    const leinwand = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    const ctx = leinwand.getContext("2d");
    ctx.fillStyle = "white";                       // PDFs gehen von Papier aus, nicht von Transparenz
    ctx.fillRect(0, 0, leinwand.width, leinwand.height);
    await seite.render({ canvasContext: ctx, viewport, canvas: leinwand }).promise;
    return { png: leinwand.toBuffer("image/png"), seiten: pdf.numPages };
  } finally {
    await aufgabe.destroy();
  }
}

/** Breiten × Formate für ein Rasterbild, dazu sein Eintrag. */
async function bildRendern(bytes, basis, copyright) {
  // Animierte GIF/WebP bleiben animiert, nur als WebP (sharp kann AVIF nicht animieren).
  const meta = await sharp(bytes, { animated: true }).metadata();
  const animiert = (meta.pages ?? 1) > 1;
  // Die Ausrichtung wird zuerst angewendet, damit Breite und Höhe wie angezeigt sind.
  const aufrecht = await sharp(bytes, { animated: animiert }).rotate().toBuffer({ resolveWithObject: true });
  const breite = aufrecht.info.width;
  const hoehe = animiert ? meta.pageHeight ?? aufrecht.info.height : aufrecht.info.height;
  const breiten = [...new Set([...BREITEN.filter(b => b < breite), Math.min(breite, BREITEN.at(-1))])]
    .sort((a, b) => a - b);
  const formate = animiert ? ["webp"] : ["avif", "webp"];
  // Alle anderen Metadaten des Originals (Kamera, GPS, Verlauf) fallen weg.
  const exif = copyright ? { IFD0: { Copyright: copyright } } : undefined;

  const ausgaben = [];
  for (const b of breiten) {
    for (const format of formate) {
      let bild = sharp(aufrecht.data, { animated: animiert }).resize({ width: b, withoutEnlargement: true })
        .toColorspace("srgb");
      if (exif) bild = bild.withExif(exif);
      bild = format === "avif" ? bild.avif({ quality: 50, effort: 4 }) : bild.webp({ quality: 80 });
      ausgaben.push({ schluessel: `${basis}-${b}.${format}`, inhalt: await bild.toBuffer(), typ: `image/${format}` });
    }
  }

  // Eine winzige unscharfe Vorschau, die die Seite zeigt, bis das richtige Bild geladen ist.
  const vorschau = await sharp(aufrecht.data).resize({ width: 16 }).webp({ quality: 40 }).toBuffer();
  return {
    daten: {
      art: "bild", breite, hoehe, breiten, formate,
      vorschau: `data:image/webp;base64,${vorschau.toString("base64")}`,
    },
    ausgaben,
  };
}
