/**
 * Copy the content pages (_Seiten and its seite_* tabs) into Firestore as
 * artists/<ARTIST>/seiten/<slug>, for the Firestore test (FIRESTORE.md).
 *
 *   node --no-warnings --loader ts-node/esm tools/firestore_import_pages.ts [--overwrite]
 *
 * Reads through the build's own Source, so the Sheet when SHEET_ID is set (and
 * the credentials can read it), the offline archive otherwise
 * (ROW_SOURCE=csv EXPORT_DIR=...). Pages that already exist are skipped, so
 * edits made in the admin page survive a re-run.
 *
 * Each page becomes one Markdown text. The Sheet splits a page over rows; they
 * are joined in order. Table pages (Spalte1/Spalte2, i.e. Biografie) become a
 * Markdown table with an empty header row, which the site hides.
 */
import { Firestore, FieldValue } from "@google-cloud/firestore";
import { csvSource, googleSource, type Row } from "../src/werkverzeichnis/source.js";
import { slugify } from "../src/werkverzeichnis/slugify.js";

const project = process.env.FIRESTORE_PROJECT ?? "vollrad-werkverzeichnis";
const databaseId = process.env.FIRESTORE_DATABASE ?? "werkverzeichnis";
const ARTIST = process.env.ARTIST_ID ?? "kutscher";
const overwrite = process.argv.includes("--overwrite");

const source = (process.env.ROW_SOURCE ?? (process.env.SHEET_ID ? "google" : "csv")) === "google"
  ? googleSource(process.env.SHEET_ID!, process.env.DRIVE_FOLDER_ID ?? "", ".cache/originals")
  : csvSource(process.env.EXPORT_DIR ?? "../werkverzeichnis-export");

const byOrder = (a: Row, b: Row) => Number(a.Reihenfolge) - Number(b.Reihenfolge);
const cell = (s = "") => s.trim().replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

function toMarkdown(rows: Row[]): string {
  const kept = rows.filter(r => r.Reihenfolge).sort(byOrder);
  if (kept.some(r => r.Spalte1 !== undefined)) {
    return ["|  |  |", "| --- | --- |",
      ...kept.map(r => `| ${cell(r.Spalte1)} | ${cell(r.Spalte2)} |`)].join("\n") + "\n";
  }
  return kept.map(r => (r.Text ?? "").trim()).filter(Boolean).join("\n\n") + "\n";
}

const db = new Firestore({ projectId: project, databaseId });
const seiten = db.collection("artists").doc(ARTIST).collection("seiten");

let written = 0, skipped = 0;
for (const p of (await source.rows("_Seiten")).sort(byOrder)) {
  const slug = slugify(p.Tab, { lower: true });
  const data = {
    titel: p.Tab,
    kategorie: p.Kategorie,
    reihenfolge: Number(p.Reihenfolge),
    text: toMarkdown(await source.rows(`seite_${p.Tab.replace(/\//g, "_")}`)),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const ref = seiten.doc(slug);
  if (!overwrite && (await ref.get()).exists) { skipped++; continue; }
  await ref.set(data);
  written++;
  console.log(`  ${slug.padEnd(16)} ${data.kategorie.padEnd(7)} ${data.text.length} chars`);
}
console.log(`${written} pages written, ${skipped} existing skipped -> ${project}/${databaseId}/artists/${ARTIST}/seiten`);
