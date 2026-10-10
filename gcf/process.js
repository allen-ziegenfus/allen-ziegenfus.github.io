/**
 * One original in Cloud Storage -> its web versions in R2, and a record of them
 * in Firestore. Used by the upload trigger (index.js) and by the backfill
 * (tools/bilder_backfill.mjs), so both produce exactly the same files.
 *
 * Web versions are named after the original's MD5 ("fingerprint") and never
 * change: a replaced original gets new names, so a published site keeps
 * showing what it was built with until the next deploy (see FIRESTORE.md).
 *
 *   R2:        <artist>/<md5>-<width>.avif|webp   images
 *              <artist>/<md5>.<ext>               videos, copied as is
 *   Firestore: artists/<artist>/medien/<md5>      width, height, widths, formats, preview
 */
import sharp from "sharp";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export const R2_ACCOUNT = "cf3fa9a06c8f2e93e24fa3eeaa80b783";
export const R2_BUCKET = "werkverzeichnis-bilder";

/** Widths the site picks from; smaller originals get only the widths they reach. */
export const WIDTHS = [400, 800, 1200, 2000];

const IMAGE = /\.(jpe?g|png|webp|gif|tiff?)$/i;
const VIDEO = /\.(mp4|webm)$/i;
const ORIGINAL = /^artists\/([^/]+)\/(works|werkgruppen)\/[^/]+\/[^/]+$/;

/** Which originals we process, and for which artist; null for anything else. */
export function artistOf(objectPath) {
  return objectPath.match(ORIGINAL)?.[1] ?? null;
}

export const fingerprint = md5Base64 => Buffer.from(md5Base64, "base64").toString("hex");

export function r2Client(accessKeyId, secretAccessKey) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

const put = (r2, key, body, contentType) => r2.send(new PutObjectCommand({
  Bucket: R2_BUCKET, Key: key, Body: body, ContentType: contentType,
  // Never changes under this name, so caches may keep it forever.
  CacheControl: "public, max-age=31536000, immutable",
}));

/**
 * Process one original. `file` is a @google-cloud/storage File, `md5` its
 * MD5 as GCS reports it (base64), `artistDoc` the artist's Firestore document.
 * Does nothing if this fingerprint is done.
 * Returns what it recorded, or null for files it doesn't handle.
 */
export async function processOriginal({ file, md5, artistDoc, r2, copyright }) {
  const name = file.name;
  const artist = artistOf(name);
  if (!artist) return null;
  const id = fingerprint(md5);
  const record = artistDoc.collection("medien").doc(id);
  const existing = await record.get();
  if (existing.exists) return existing.data();

  const [bytes] = await file.download();
  const base = `${artist}/${id}`;
  let data, outputs;
  try {
    ({ data, outputs } = await render(name, bytes, base, copyright));
  } catch (e) {
    // A file sharp can't read won't get better by retrying: record it and move on.
    data = { art: "fehler", fehler: String(e.message ?? e).slice(0, 500) };
    outputs = [];
  }
  // Upload errors, on the other hand, are thrown, so the trigger retries.
  for (const o of outputs) await put(r2, o.key, o.body, o.type);

  data = { ...data, original: name, erstellt: new Date() };
  await record.set(data);
  return data;
}

/** The files to write for one original, and its record. sharp only, no network. */
async function render(name, bytes, base, copyright) {
  if (VIDEO.test(name)) {
    const ext = name.match(VIDEO)[1].toLowerCase();
    return {
      data: { art: "video", formate: [ext], groesse: bytes.length },
      outputs: [{ key: `${base}.${ext}`, body: bytes, type: ext === "mp4" ? "video/mp4" : "video/webm" }],
    };
  }
  if (!IMAGE.test(name)) return { data: { art: "nicht unterstützt" }, outputs: [] };  // PDFs etc.

  // Animated GIF/WebP stay animated, as WebP only (sharp can't animate AVIF).
  const meta = await sharp(bytes, { animated: true }).metadata();
  const animated = (meta.pages ?? 1) > 1;
  // Orientation is applied first, so width and height are as displayed.
  const upright = await sharp(bytes, { animated }).rotate().toBuffer({ resolveWithObject: true });
  const width = upright.info.width;
  const height = animated ? meta.pageHeight ?? upright.info.height : upright.info.height;
  const widths = [...new Set([...WIDTHS.filter(w => w < width), Math.min(width, WIDTHS.at(-1))])]
    .sort((a, b) => a - b);
  const formats = animated ? ["webp"] : ["avif", "webp"];
  // Everything else from the original's metadata (camera, GPS, history) is dropped.
  const exif = copyright ? { IFD0: { Copyright: copyright } } : undefined;

  const outputs = [];
  for (const w of widths) {
    for (const fmt of formats) {
      let out = sharp(upright.data, { animated }).resize({ width: w, withoutEnlargement: true })
        .toColorspace("srgb");
      if (exif) out = out.withExif(exif);
      out = fmt === "avif" ? out.avif({ quality: 50, effort: 4 }) : out.webp({ quality: 80 });
      outputs.push({ key: `${base}-${w}.${fmt}`, body: await out.toBuffer(), type: `image/${fmt}` });
    }
  }

  // A tiny blurred preview the page shows until the real image has loaded.
  const preview = await sharp(upright.data).resize({ width: 16 }).webp({ quality: 40 }).toBuffer();
  return {
    data: {
      art: "bild", breite: width, hoehe: height, breiten: widths, formate: formats,
      vorschau: `data:image/webp;base64,${preview.toString("base64")}`,
    },
    outputs,
  };
}
