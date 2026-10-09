/**
 * Ad-hoc Firestore queries for the test database, printed as a table.
 *
 *   node tools/fsq.mjs '<query>' [extra columns…]
 *
 * <query> is a JavaScript expression over `works`, `history` and `werkgruppen`
 * (collection refs under artists/<ARTIST>), e.g.
 *
 *   node tools/fsq.mjs 'works.where("werkgruppe", "==", "objekte").where("Standort", "==", "Atelier")' Standort
 *
 * Runs with your gcloud application-default credentials, as an admin: the
 * security rules do not apply. Reads only, unless you write a query that writes.
 */
import { Firestore, FieldPath } from "@google-cloud/firestore";

const db = new Firestore({
  projectId: process.env.FIRESTORE_PROJECT ?? "vollrad-werkverzeichnis",
  databaseId: process.env.FIRESTORE_DATABASE ?? "werkverzeichnis",
});
const artist = db.doc(`artists/${process.env.ARTIST_ID ?? "kutscher"}`);
const works = artist.collection("works");
const history = artist.collection("history");
const werkgruppen = artist.collection("werkgruppen");

const [expr, ...extra] = process.argv.slice(2);
if (!expr) { console.error("usage: node tools/fsq.mjs '<query>' [columns…]"); process.exit(1); }

const q = eval(expr);
const snap = await q.get();

// count() and other aggregations return one snapshot with data(), not documents.
if (!snap.docs) { console.log(snap.data()); process.exit(0); }

const cols = ["InvNr", "Titel", "Jahr", ...extra];
const cut = (v, n) => { const s = v == null ? "" : String(v); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
console.log(cols.map(c => cut(c, c === "Titel" ? 40 : 20).padEnd(c === "Titel" ? 40 : 20)).join(" "));
for (const d of snap.docs) {
  const r = d.data();
  console.log(cols.map(c => cut(r[c], c === "Titel" ? 40 : 20).padEnd(c === "Titel" ? 40 : 20)).join(" "));
}
console.log(`\n${snap.size} document(s)`);
