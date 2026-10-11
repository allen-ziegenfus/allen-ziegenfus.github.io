/**
 * Spontane Firestore-Abfragen, als Tabelle ausgegeben.
 *
 *   node tools/fsq.mjs '<abfrage>' [weitere Spalten…]
 *
 * <abfrage> ist ein JavaScript-Ausdruck über `werke`, `verlauf` und `werkgruppen`
 * (Sammlungen unter artists/<ARTIST_ID>), z. B.
 *
 *   node tools/fsq.mjs 'werke.where("werkgruppe", "==", "objekte").where("Standort", "==", "Atelier")' Standort
 *
 * Läuft mit deinen gcloud Application Default Credentials, als Admin: Die
 * Sicherheitsregeln gelten nicht. Liest nur, außer man schreibt eine Abfrage, die schreibt.
 */
import { Firestore, FieldPath } from "@google-cloud/firestore";

const db = new Firestore({
  projectId: process.env.FIRESTORE_PROJECT ?? "vollrad-werkverzeichnis",
  databaseId: process.env.FIRESTORE_DATABASE ?? "werkverzeichnis",
});
const kuenstler = db.doc(`artists/${process.env.ARTIST_ID ?? "kutscher"}`);
const werke = kuenstler.collection("works");
const verlauf = kuenstler.collection("history");
const werkgruppen = kuenstler.collection("werkgruppen");

const [ausdruck, ...weitere] = process.argv.slice(2);
if (!ausdruck) { console.error("usage: node tools/fsq.mjs '<query>' [columns…]"); process.exit(1); }

const abfrage = eval(ausdruck);
const snap = await abfrage.get();

// count() und andere Aggregationen liefern einen Snapshot mit data(), keine Dokumente.
if (!snap.docs) { console.log(snap.data()); process.exit(0); }

const spalten = ["InvNr", "Titel", "Jahr", ...weitere];
const kuerzen = (v, n) => { const s = v == null ? "" : String(v); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const breite = s => s === "Titel" ? 40 : 20;
console.log(spalten.map(s => kuerzen(s, breite(s)).padEnd(breite(s))).join(" "));
for (const d of snap.docs) {
  const zeile = d.data();
  console.log(spalten.map(s => kuerzen(zeile[s], breite(s)).padEnd(breite(s))).join(" "));
}
console.log(`\n${snap.size} document(s)`);
