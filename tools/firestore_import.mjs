/**
 * Copy one Werkgruppe from the build's werkgruppen.json into Firestore, for the
 * Firestore test (FIRESTORE.md). The Sheet stays the source; this is a snapshot.
 *
 *   gcloud auth application-default login
 *   FIRESTORE_PROJECT=<project-id> [FIRESTORE_DATABASE=<id>] \
 *     node tools/firestore_import.mjs [werkgruppe-slug | all] [--overwrite]
 *
 * Writes artists/<ARTIST>/werkgruppen/<slug> and artists/<ARTIST>/works/<work-slug>.
 * Works that already exist are skipped, so edits made in the test editor survive a
 * re-run; --overwrite replaces them with the build's data instead.
 */
import fs from "fs";
import { Firestore } from "@google-cloud/firestore";

const project = process.env.FIRESTORE_PROJECT;
if (!project) throw new Error("FIRESTORE_PROJECT must be set");
const ARTIST = process.env.ARTIST_ID ?? "kutscher";
const args = process.argv.slice(2);
const overwrite = args.includes("--overwrite");
const slug = args.find(a => !a.startsWith("--")) ?? "objekte";

const all = JSON.parse(fs.readFileSync("public/werkgruppen.json", "utf8"));
const groups = slug === "all" ? all : all.filter(g => g.Slug === slug);
if (!groups.length) throw new Error(`no Werkgruppe "${slug}" in public/werkgruppen.json`);

const databaseId = process.env.FIRESTORE_DATABASE ?? "(default)";
const db = new Firestore({ projectId: project, databaseId });
const artist = db.collection("artists").doc(ARTIST);

// Fields the build derives rather than stores; everything else is Sheet data.
const DERIVED = ["InventoryNumber", "Slug", "WerkgruppeSlug", "Bilder", "Thumbnail"];

const writer = db.bulkWriter();
let skipped = 0;
writer.onWriteError(e => {
  if (e.code === 6) { skipped++; return false; }   // ALREADY_EXISTS: keep the edited work
  return e.failedAttempts < 3;
});
writer.set(artist, { updatedAt: Firestore.FieldValue.serverTimestamp() }, { merge: true });
for (const group of groups) {
  writer.set(artist.collection("werkgruppen").doc(group.Slug), {
    titel: group.Titel,
    kurztitel: group.Kurztitel ?? null,
    reihenfolge: Number(group.Reihenfolge),
    cover: group.Thumbnail,
  });
  for (const r of group.Records) {
    const fields = Object.fromEntries(
      Object.entries(r).filter(([k, v]) => !DERIVED.includes(k) && v !== undefined));
    const data = {
      ...fields,
      werkgruppe: group.Slug,
      // Image URLs of the current build, so the test pages can render them as is.
      images: r.Bilder,
      updatedAt: Firestore.FieldValue.serverTimestamp(),
    };
    const ref = artist.collection("works").doc(r.Slug);
    if (overwrite) writer.set(ref, data);
    else writer.create(ref, data).catch(() => {});
  }
}
await writer.close();
const total = groups.reduce((n, g) => n + g.Records.length, 0);
console.log(`${groups.length} Werkgruppen, ${total - skipped} works written, ${skipped} existing skipped ` +
            `-> ${project}/${databaseId}/artists/${ARTIST}`);
