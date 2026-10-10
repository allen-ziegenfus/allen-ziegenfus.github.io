/**
 * Firestore -> Dateien für den Build (public/*.json).
 *
 *   FIRESTORE_PROJECT=... FIRESTORE_DATABASE=... ARTIST_ID=... yarn data
 *
 * Werke führen ihre Bilder als Pfade im Bucket der Originale (BUCKET, sonst der
 * Firebase-Bucket des Projekts). Die Bildfunktion hat deren Webversionen schon
 * erzeugt, ausgeliefert unter BILDER_URL; der Build verlinkt sie nur, über die
 * MD5 des Originals, die die Bucket-Liste liefert, ohne etwas herunterzuladen.
 */
import * as fs from "fs";
import { marked } from "marked";
import { Storage } from "@google-cloud/storage";
import { firestoreKatalog, WERK_FELDER, type Medium } from "./catalog.js";

const PUBLIC = "./public";

const env = process.env;

function pflicht(name: string): string {
  const v = env[name];
  if (!v) throw new Error(`${name} must be set`);
  return v;
}

const PROJEKT = pflicht("FIRESTORE_PROJECT");
const DATENBANK = env.FIRESTORE_DATABASE ?? "werkverzeichnis";
const KUENSTLER = pflicht("ARTIST_ID");
const BUCKET = env.BUCKET ?? `${PROJEKT}.firebasestorage.app`;
const BILDER_URL = env.BILDER_URL ?? "/bilder";

/**
 * Ein Bild, wie die Seiten es brauchen. `src` funktioniert immer allein; die
 * srcsets (avif, webp), Größe und Vorschau gibt es, wenn die Bildfunktion sie
 * erzeugt hat.
 */
interface Bild {
  src: string;
  /** ~400 px, für Vorschaubilder und Listen. */
  klein?: string;
  /** Die größte Version, für die Lightbox. */
  gross?: string;
  breite?: number;
  hoehe?: number;
  avif?: string;
  webp?: string;
  vorschau?: string;
  /** MIME-Typ, bei Videos. */
  video?: string;
}

const PLATZHALTER: Bild = { src: "/placeholder.png" };

function ausMedium(md5: string, m: Medium): Bild {
  const basis = `${BILDER_URL}/${KUENSTLER}/${md5}`;
  if (m.art === "video") return { src: `${basis}.${m.formate![0]}`, video: `video/${m.formate![0]}` };
  if (m.art !== "bild") return PLATZHALTER;              // nicht unterstützt, unlesbar
  const breiten = m.breiten!;
  const waehle = (ziel: number) => breiten.find(b => b >= ziel) ?? breiten.at(-1)!;
  const srcset = (format: string) => breiten.map(b => `${basis}-${b}.${format} ${b}w`).join(", ");
  return {
    src: `${basis}-${waehle(800)}.webp`, klein: `${basis}-${waehle(400)}.webp`,
    gross: `${basis}-${breiten.at(-1)}.webp`, breite: m.breite, hoehe: m.hoehe,
    avif: m.formate!.includes("avif") ? srcset("avif") : undefined, webp: srcset("webp"),
    vorschau: m.vorschau,
  };
}

function jahreAusloesen(jahr?: string): number[] {
  if (!jahr) return [];
  const jahre: number[] = [];
  for (const teil of String(jahr).split(",")) {
    const [von, bis] = teil.split("-").map(s => Number(s.trim()));
    if (!von) continue;
    if (!bis) { jahre.push(von); continue; }
    for (let j = von; j <= bis; j++) jahre.push(j);
  }
  return jahre;
}

/** Die Originale der Künstler:in: Objektpfad -> MD5 (hex). */
async function fingerabdruecke(): Promise<Map<string, string>> {
  const [dateien] = await new Storage({ projectId: PROJEKT }).bucket(BUCKET)
    .getFiles({ prefix: `artists/${KUENSTLER}/` });
  return new Map(dateien.map(d => [d.name, Buffer.from(d.metadata.md5Hash!, "base64").toString("hex")]));
}

/** Validierung ist der Preis einer schemalosen Quelle. Laut scheitern, nie eine Lücke zeigen. */
const probleme: string[] = [];

async function bauen() {
  const [katalog, md5s] = await Promise.all([firestoreKatalog(PROJEKT, DATENBANK, KUENSTLER), fingerabdruecke()]);
  probleme.push(...katalog.probleme);

  /**
   * Ein gelistetes Bild als Bild. Fehlt es im Bucket oder gibt es noch keine
   * Webversionen, ist das ein Datenproblem, keine Lücke zum Anzeigen.
   */
  function webBild(pfad: string, besitzer: string): Bild | null {
    const md5 = md5s.get(pfad);
    if (md5 === undefined) { probleme.push(`${besitzer}: image ${pfad} not in the bucket`); return null; }
    const m = katalog.medien.get(md5);
    if (!m) { probleme.push(`${besitzer}: web versions of ${pfad} not made yet`); return null; }
    if (m.art === "fehler") console.warn(`  ${besitzer}: ${pfad} unreadable: ${m.fehler}`);
    return ausMedium(md5, m);
  }

  // Gleichstand nach Slug entschieden, damit die Reihenfolge nie von der Lesereihenfolge abhängt.
  const nachSlug = (a: { slug: string }, b: { slug: string }) => a.slug.localeCompare(b.slug);
  const gruppen = [...katalog.werkgruppen].sort((a, b) => a.reihenfolge - b.reihenfolge || nachSlug(a, b));
  const vorschaubild = (b: Bild) => b.video ? "/placeholder.png" : b.klein ?? b.src;

  const werkgruppen = [];
  const suchMetadaten = {
    MinYear: Number.MAX_VALUE, MaxYear: Number.MIN_VALUE,
    Werkgruppen: [] as any[], InvNrs: [] as string[],
  };

  for (const gruppe of gruppen) {
    const werke = katalog.werke.filter(w => w.werkgruppe === gruppe.slug);
    const eintraege = [];

    for (const werk of werke) {
      // Die eigenen Bildpfade des Werks, in Reihenfolge; das erste ist das Vorschaubild.
      const bilder = (werk.images ?? []).map(p => webBild(p, werk.slug)).filter((b): b is Bild => b !== null);
      if (!bilder.length) bilder.push(PLATZHALTER);

      const jahr = Number(werk.Jahr);
      if (jahr) {
        suchMetadaten.MinYear = Math.min(suchMetadaten.MinYear, jahr);
        suchMetadaten.MaxYear = Math.max(suchMetadaten.MaxYear, jahr);
      }

      eintraege.push({
        InvNr: werk.InvNr,
        InventoryNumber: werk.InvNr.replaceAll(/[^0-9]/g, ""),
        Slug: werk.slug,
        WerkgruppeSlug: gruppe.slug,
        ...Object.fromEntries(WERK_FELDER.filter(f => f !== "InvNr").map(f => [f, werk[f]])),
        Bilder: bilder,
        Thumbnail: vorschaubild(bilder[0]),
      });
    }

    eintraege.sort((a, b) =>
      Number(a.InventoryNumber) - Number(b.InventoryNumber) || a.Slug.localeCompare(b.Slug));
    suchMetadaten.InvNrs.push(...eintraege.map(e => e.InvNr));

    if (!gruppe.cover) probleme.push(`no cover image for Werkgruppe ${gruppe.slug}`);
    const titelbild = gruppe.cover ? webBild(gruppe.cover, gruppe.slug) ?? PLATZHALTER : PLATZHALTER;

    werkgruppen.push({
      Titel: gruppe.titel,
      Slug: gruppe.slug,
      Thumbnail: vorschaubild(titelbild),
      Titelbild: titelbild,
      Count: eintraege.length,
      Records: eintraege,
      Reihenfolge: gruppe.reihenfolge,
      Kurztitel: gruppe.kurztitel,
    });
    suchMetadaten.Werkgruppen.push({
      WerkgruppenSlug: gruppe.slug, WerkgruppenTitel: gruppe.titel,
    });
    console.log(`  ${gruppe.slug.padEnd(22)} ${eintraege.length} works`);
  }

  const verwaist = katalog.werke.filter(w => !gruppen.some(g => g.slug === w.werkgruppe));
  if (verwaist.length) probleme.push(`${verwaist.length} work(s) in no Werkgruppe`);

  const seiten = [...katalog.seiten]
    .sort((a, b) => a.reihenfolge - b.reihenfolge || nachSlug(a, b))
    .map(s => ({
      Name: s.titel, Slug: s.slug, Html: marked.parse(s.text),
      Reihenfolge: s.reihenfolge, Kategorie: s.kategorie,
    }));

  const anzahlWerke = werkgruppen.reduce((n, w) => n + w.Records.length, 0);
  console.log(`\n${werkgruppen.length} Werkgruppen, ${anzahlWerke} works, ${seiten.length} pages`);

  if (probleme.length) {
    console.error(`\n${probleme.length} problem(s) in the data:`);
    for (const p of probleme.slice(0, 40)) console.error(`  ! ${p}`);
    if (env.STRICT === "1") process.exit(1);
  }

  const suchDaten = werkgruppen.flatMap(w => w.Records.map((e: any) => ({
    InvNr: e.InvNr, Beschreibung: e.Beschreibung, Jahr: e.Jahr,
    Jahre: jahreAusloesen(e.Jahr), Slug: e.Slug, Titel: e.Titel,
    Werkgruppe: e.Werkgruppe, WerkgruppeSlug: e.WerkgruppeSlug, Thumbnail: e.Thumbnail,
  })));

  fs.writeFileSync(`${PUBLIC}/site.json`, JSON.stringify(katalog.kuenstler));
  fs.writeFileSync(`${PUBLIC}/werkgruppen.json`, JSON.stringify(werkgruppen));
  fs.writeFileSync(`${PUBLIC}/searchData.json`, JSON.stringify(suchDaten));
  fs.writeFileSync(`${PUBLIC}/searchMetadata.json`, JSON.stringify(suchMetadaten));
  fs.writeFileSync(`${PUBLIC}/pages.json`, JSON.stringify(seiten));
  fs.writeFileSync(`${PUBLIC}/robots.txt`,
    `User-agent: *\nAllow: /\n\nSitemap: ${env.SITE}/sitemap-index.xml\n`);
}

await bauen();
