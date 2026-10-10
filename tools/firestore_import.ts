/**
 * Copy the Sheet (or the archive) into Firestore: Werkgruppen, works, pages.
 * Reads through catalog.ts, the same code the build uses, so what lands in
 * Firestore is exactly what a Sheet build would publish.
 *
 *   SHEET_ID=... node --no-warnings --loader ts-node/esm tools/firestore_import.ts [flags]
 *   ROW_SOURCE=csv EXPORT_DIR=... node --no-warnings --loader ts-node/esm tools/firestore_import.ts [flags]
 *
 *   (no flag)          add what's missing, leave existing documents alone
 *   --overwrite        replace Werkgruppen and works, and delete works the Sheet
 *                      no longer has, so Firestore mirrors the Sheet
 *   --overwrite-pages  also replace pages (by default they're only added: pages
 *                      are edited in the admin page now, not in the Sheet)
 *
 * Runs with your gcloud application-default credentials (as an admin, so the
 * security rules don't apply). Reading the Sheet needs them to include the
 * spreadsheets scope.
 */
import { Firestore, FieldValue } from "@google-cloud/firestore";
import { sheetCatalog } from "../src/werkverzeichnis/catalog.js";
import { csvSource, googleSource } from "../src/werkverzeichnis/source.js";

const env = process.env;
const project = env.FIRESTORE_PROJECT ?? "vollrad-werkverzeichnis";
const databaseId = env.FIRESTORE_DATABASE ?? "werkverzeichnis";
const ARTIST = env.ARTIST_ID ?? "kutscher";
const overwrite = process.argv.includes("--overwrite");
const overwritePages = process.argv.includes("--overwrite-pages");

const mode = env.ROW_SOURCE ?? (env.SHEET_ID ? "google" : "csv");
const source = mode === "google"
  ? googleSource(env.SHEET_ID!, env.DRIVE_FOLDER_ID ?? "", ".cache/originals")
  : csvSource(env.EXPORT_DIR ?? "../werkverzeichnis-export");

const catalog = await sheetCatalog(source);
// Like the build: rows with problems are skipped, and STRICT=1 refuses to import.
if (catalog.problems.length) {
  console.error(`${catalog.problems.length} problem(s) in the source data:`);
  for (const p of catalog.problems.slice(0, 40)) console.error(`  ! ${p}`);
  if (env.STRICT === "1") process.exit(1);
}

const db = new Firestore({ projectId: project, databaseId });
const artist = db.collection("artists").doc(ARTIST);
if (!(await artist.get()).exists) throw new Error(`artists/${ARTIST} does not exist; create it in the admin page`);

const writer = db.bulkWriter();
const count = { written: 0, kept: 0, deleted: 0 };
writer.onWriteResult(() => { count.written++; });
writer.onWriteError(e => {
  if (e.code === 6) { count.kept++; return false; }  // ALREADY_EXISTS
  return e.failedAttempts < 3;
});
const put = (ref: FirebaseFirestore.DocumentReference, data: object, replace: boolean) =>
  (replace ? writer.set(ref, data) : writer.create(ref, data)).catch(() => {});

// Image paths (tools/gcs_upload.ts) aren't in the Sheet; an overwrite keeps them.
const keep = async (collection: string, field: string) => new Map((await artist.collection(collection).get())
  .docs.filter(d => d.get(field) !== undefined).map(d => [d.id, { [field]: d.get(field) }]));
const covers = await keep("werkgruppen", "cover");
const images = await keep("works", "images");

for (const { slug, ...g } of catalog.werkgruppen) {
  put(artist.collection("werkgruppen").doc(slug),
    { ...g, kurztitel: g.kurztitel ?? null, bild: g.bild ?? null, ...covers.get(slug) }, overwrite);
}
for (const { slug, ...w } of catalog.works) {
  put(artist.collection("works").doc(slug),
    { ...w, ...images.get(slug), updatedAt: FieldValue.serverTimestamp() }, overwrite);
}
for (const { slug, ...s } of catalog.seiten) {
  put(artist.collection("seiten").doc(slug), { ...s, updatedAt: FieldValue.serverTimestamp() }, overwritePages);
}

if (overwrite) {
  const inSheet = new Set(catalog.works.map(w => w.slug));
  for (const d of (await artist.collection("works").get()).docs) {
    if (!inSheet.has(d.id)) { writer.delete(d.ref).catch(() => {}); count.deleted++; console.log(`  delete work ${d.id}`); }
  }
}
await writer.close();
count.written -= count.deleted;

const extra = (await artist.collection("werkgruppen").get()).docs
  .map(d => d.id).filter(id => !catalog.werkgruppen.some(g => g.slug === id));
if (extra.length) console.log(`  not in the Sheet, left alone: Werkgruppe(n) ${extra.join(", ")}`);

console.log(`${catalog.werkgruppen.length} Werkgruppen, ${catalog.works.length} works, ` +
  `${catalog.seiten.length} pages from ${mode}: ${count.written} written, ${count.kept} kept, ` +
  `${count.deleted} deleted -> ${project}/${databaseId}/artists/${ARTIST}`);
