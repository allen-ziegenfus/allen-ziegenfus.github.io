/**
 * Upload the archive's original images to Cloud Storage and record them in
 * Firestore, so the Firestore build no longer needs Drive.
 *
 *   node --no-warnings --loader ts-node/esm tools/gcs_upload.ts [--dry-run]
 *
 * Which works exist comes from Firestore; their images are found in the archive
 * (EXPORT_DIR/originals/<ordner>/) by the old filename convention, <slug>-NN.ext.
 * They go to
 *
 *   artists/<ARTIST>/works/<slug>/NN.ext            -> works/<slug>.images
 *   artists/<ARTIST>/werkgruppen/<slug>/cover.ext   -> werkgruppen/<slug>.cover
 *
 * Files already in the bucket with the same MD5 are skipped, so a re-run only
 * uploads what changed. Runs with your gcloud application-default credentials.
 */
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Firestore } from "@google-cloud/firestore";
import { Storage } from "@google-cloud/storage";
import { firestoreCatalog } from "../src/werkverzeichnis/catalog.js";

const env = process.env;
const PROJECT = env.FIRESTORE_PROJECT ?? "vollrad-werkverzeichnis";
const DATABASE = env.FIRESTORE_DATABASE ?? "werkverzeichnis";
const BUCKET = env.BUCKET ?? `${PROJECT}.firebasestorage.app`;
const ARTIST = env.ARTIST_ID ?? "kutscher";
const ORIGINALS = path.join(env.EXPORT_DIR ?? "../werkverzeichnis-export", "originals");
const dryRun = process.argv.includes("--dry-run");

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif",
  ".webp": "image/webp", ".tif": "image/tiff", ".tiff": "image/tiff", ".pdf": "application/pdf",
  ".mp4": "video/mp4", ".webm": "video/webm",
};

const catalog = await firestoreCatalog(PROJECT, DATABASE, ARTIST);
const bucket = new Storage({ projectId: PROJECT }).bucket(BUCKET);
const db = new Firestore({ projectId: PROJECT, databaseId: DATABASE });
const artist = db.collection("artists").doc(ARTIST);

// What's in the bucket already: object path -> MD5 (base64, as GCS reports it).
const [objects] = await bucket.getFiles({ prefix: `artists/${ARTIST}/` });
const inBucket = new Map(objects.map(o => [o.name, o.metadata.md5Hash]));
const md5 = (file: string) => crypto.createHash("md5").update(fs.readFileSync(file)).digest("base64");

const uploads: { from: string; to: string }[] = [];
const plan = (from: string, to: string) => {
  if (inBucket.get(to) !== md5(from)) uploads.push({ from, to });
  return to;
};

const listing = (dir: string) =>
  fs.existsSync(path.join(ORIGINALS, dir)) ? fs.readdirSync(path.join(ORIGINALS, dir)).sort() : [];

let orphans = 0;
const workImages = new Map<string, string[]>();
const covers = new Map<string, string>();

for (const g of catalog.werkgruppen) {
  const files = listing(g.ordner);
  const claimed = new Set<string>();
  for (const w of catalog.works.filter(w => w.werkgruppe === g.slug)) {
    const mine = files.filter(f => /^\d+\.[A-Za-z0-9]+$/.test(f.startsWith(w.slug + "-") ? f.slice(w.slug.length + 1) : ""));
    mine.forEach(f => claimed.add(f));
    workImages.set(w.slug, mine.map(f => {
      const [, nn, ext] = f.slice(w.slug.length + 1).match(/^(\d+)(\.[A-Za-z0-9]+)$/)!;
      return plan(path.join(ORIGINALS, g.ordner, f), `artists/${ARTIST}/works/${w.slug}/${nn}${ext.toLowerCase()}`);
    }));
  }
  const unclaimed = files.filter(f => !claimed.has(f) && !f.startsWith("."));
  if (unclaimed.length) {
    orphans += unclaimed.length;
    console.log(`  ${g.ordner}: ${unclaimed.length} file(s) match no work, e.g. ${unclaimed.slice(0, 3).join(", ")}`);
  }
  if (g.bild && fs.existsSync(path.join(ORIGINALS, "_covers", g.bild))) {
    covers.set(g.slug, plan(path.join(ORIGINALS, "_covers", g.bild),
      `artists/${ARTIST}/werkgruppen/${g.slug}/cover${path.extname(g.bild).toLowerCase()}`));
  } else {
    console.log(`  ${g.slug}: no cover file`);
  }
}

const total = [...workImages.values()].reduce((n, l) => n + l.length, 0) + covers.size;
const bytes = uploads.reduce((n, u) => n + fs.statSync(u.from).size, 0);
console.log(`${total} images (${orphans} unclaimed files skipped); ` +
  `${uploads.length} to upload, ${(bytes / 1e6).toFixed(0)} MB`);
if (dryRun) process.exit(0);

let done = 0, next = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (next < uploads.length) {
    const { from, to } = uploads[next++];
    await bucket.upload(from, {
      destination: to,
      metadata: { contentType: TYPES[path.extname(from).toLowerCase()], metadata: { original: path.basename(from) } },
    });
    if (++done % 250 === 0) console.log(`  ${done}/${uploads.length}`);
  }
}));

// Record the paths; only documents whose list changed are written.
const writer = db.bulkWriter();
let changed = 0;
for (const w of catalog.works) {
  const images = workImages.get(w.slug) ?? [];
  if (JSON.stringify(images) !== JSON.stringify(w.images ?? [])) {
    writer.update(artist.collection("works").doc(w.slug), { images });
    changed++;
  }
}
for (const g of catalog.werkgruppen) {
  const cover = covers.get(g.slug);
  if (cover && cover !== g.cover) {
    writer.update(artist.collection("werkgruppen").doc(g.slug), { cover });
    changed++;
  }
}
await writer.close();
console.log(`uploaded ${done}, updated ${changed} Firestore document(s) -> gs://${BUCKET}/artists/${ARTIST}/`);
