/**
 * Testet firestore.rules über den Test-Endpunkt der Firebase Rules API: kein
 * Emulator (und kein Java), keine Daten werden angefasst. Abfragen (`get`,
 * `exists`, `getAfter`) werden je Fall simuliert.
 *
 *   node tools/rules_test.mjs
 *
 * Zwei Teile:
 *   - die Berechtigungsmatrix, erzeugt aus src/werkverzeichnis/permissions.js:
 *     jede Rolle (dazu Super-Admin und eine Fremde) × jede Berechtigung, damit
 *     die Tabelle der Regeln und die der Oberfläche nicht auseinanderlaufen
 *   - handgeschriebene Fälle für das, was die Tabelle nicht ausdrückt:
 *     Validierung, Anlegen von Künstler:innen, andere Künstler:innen,
 *     unbestätigte E-Mail-Adressen
 *
 * Läuft mit deinen gcloud Application Default Credentials.
 */
import fs from "fs";
import { GoogleAuth } from "google-auth-library";
import { BERECHTIGUNGEN, ROLLEN } from "../src/werkverzeichnis/permissions.js";

const PROJEKT = process.env.FIRESTORE_PROJECT ?? "vollrad-werkverzeichnis";
const DATENBANK = process.env.FIRESTORE_DATABASE ?? "werkverzeichnis";
const wurzel = `/databases/${DATENBANK}/documents`;

// Der Test-Endpunkt nimmt JSON; RFC-3339-Zeichenketten gelten als gleich request.time.
const JETZT = "2026-10-09T12:00:00Z";
const FRUEHER = "2026-10-01T00:00:00Z";

const SUPER = "super@example.org", FREMDE = "stranger@example.org";
const mitglied = rolle => `${rolle}@example.org`;

const kutscher = {
  titel: "Vollrad Kutscher", websiteTitel: "Werkverzeichnis", titelZeile1: "Werkverzeichnis von",
  titelZeile2: "Vollrad Kutscher", copyright: "Vollrad Kutscher",
  roles: Object.fromEntries(ROLLEN.map(r => [mitglied(r), r])),
  active: true, updatedAt: FRUEHER,
};
const werk = { InvNr: "OB1", werkgruppe: "objekte", Titel: "Ding", updatedAt: FRUEHER };
const gruppe = { titel: "Fotografie", kurztitel: null, reihenfolge: 13 };
const seite = { titel: "Kontakt", kategorie: "Footer", reihenfolge: 1, text: "**Hallo**\n", updatedAt: FRUEHER };

function anmeldung(email, { bestaetigt = true, superAdmin = false } = {}) {
  if (!email) return null;
  return { uid: email, token: { email, email_verified: bestaetigt, ...(superAdmin && { superAdmin: true }) } };
}
const als = wer => wer === SUPER ? anmeldung(SUPER, { superAdmin: true }) : anmeldung(wer);

// Jeder Fall sieht dieselbe Welt: eine Künstlerin, ein Werk, ein neuer Verlaufseintrag.
const welt = [
  { function: "get", args: [{ exactValue: `${wurzel}/artists/kutscher` }], result: { value: { data: kutscher } } },
  { function: "get", args: [{ anyValue: {} }], result: { value: null } },
  { function: "getAfter", args: [{ exactValue: `${wurzel}/artists/kutscher/history/h1` }],
    result: { value: { data: { work: "ob1" } } } },
  { function: "exists", args: [{ anyValue: {} }], result: { value: false } },
];

function fall(name, erwartung, auth, methode, pfad, { daten, vorhanden } = {}) {
  return {
    name,
    expectation: erwartung,
    request: {
      auth, method: methode, path: `${wurzel}/${pfad}`, time: JETZT,
      ...(daten && { resource: { data: daten } }),
    },
    ...(vorhanden && { resource: { data: vorhanden } }),
    functionMocks: welt,
  };
}

// Je Berechtigung eine Anfrage, die genau diese Berechtigung braucht und sonst
// gültig ist.
const proben = {
  "lesen": wer => fall(`${wer} lesen`, null, als(wer), "get", "artists/kutscher/works/ob1", { vorhanden: werk }),
  "werke.bearbeiten": wer => fall(`${wer} werke.bearbeiten`, null, als(wer), "update", "artists/kutscher/works/ob1",
    { daten: { ...werk, Titel: "Neu", updatedAt: JETZT, lastChange: "h1" }, vorhanden: werk }),
  "werkgruppen.bearbeiten": wer => fall(`${wer} werkgruppen.bearbeiten`, null, als(wer), "create",
    "artists/kutscher/werkgruppen/fotografie", { daten: gruppe }),
  "seiten.bearbeiten": wer => fall(`${wer} seiten.bearbeiten`, null, als(wer), "update", "artists/kutscher/seiten/kontakt",
    { daten: { ...seite, text: "Neu\n", updatedAt: JETZT }, vorhanden: seite }),
  "einstellungen.bearbeiten": wer => fall(`${wer} einstellungen.bearbeiten`, null, als(wer), "update", "artists/kutscher",
    { daten: { ...kutscher, titel: "Neu", updatedAt: JETZT }, vorhanden: kutscher }),
  "rollen.verwalten": wer => fall(`${wer} rollen.verwalten`, null, als(wer), "update", "artists/kutscher",
    { daten: { ...kutscher, roles: { ...kutscher.roles, [FREMDE]: "editor" }, updatedAt: JETZT }, vorhanden: kutscher }),
  "veroeffentlichen": wer => fall(`${wer} veroeffentlichen`, null, als(wer), "create", "artists/kutscher/veroeffentlichungen/v1",
    { daten: { von: wer, angefordert: JETZT, status: "angefordert" } }),
};

const alleBerechtigungen = [...new Set(Object.values(BERECHTIGUNGEN).flat())];
const ohneProbe = alleBerechtigungen.filter(b => !proben[b]);
if (ohneProbe.length) {
  console.error(`No probe for permission(s): ${ohneProbe.join(", ")}. Add one to tools/rules_test.mjs.`);
  process.exit(1);
}

const matrix = [];
for (const berechtigung of alleBerechtigungen) {
  for (const rolle of ROLLEN) {
    matrix.push({ ...proben[berechtigung](mitglied(rolle)),
      expectation: BERECHTIGUNGEN[rolle].includes(berechtigung) ? "ALLOW" : "DENY" });
  }
  matrix.push({ ...proben[berechtigung](SUPER), expectation: "ALLOW" });
  matrix.push({ ...proben[berechtigung](FREMDE), expectation: "DENY" });
}

const ADMIN = mitglied("admin"), EDITOR = mitglied("editor");
const neueKuenstlerin = { ...kutscher, titel: "Neue Künstlerin", roles: {}, updatedAt: JETZT };

const faelle = [
  ...matrix,

  fall("Super-Admin legt Künstlerin an", "ALLOW", als(SUPER), "create", "artists/neue", { daten: neueKuenstlerin }),
  fall("Admin legt keine Künstler:innen an", "DENY", als(ADMIN), "create", "artists/neue", { daten: neueKuenstlerin }),
  fall("superAdmin-Claim muss true sein, nicht nur wahrheitsähnlich", "DENY",
    { uid: "x", token: { email: "x@example.org", email_verified: true, superAdmin: "yes" } },
    "create", "artists/neue", { daten: neueKuenstlerin }),
  fall("ungültige Kennung", "DENY", als(SUPER), "create", "artists/Neue Künstlerin", { daten: neueKuenstlerin }),
  fall("unbekanntes Feld", "DENY", als(SUPER), "create", "artists/neue", { daten: { ...neueKuenstlerin, extra: 1 } }),
  fall("Zeitstempel vom Client", "DENY", als(SUPER), "create", "artists/neue",
    { daten: { ...neueKuenstlerin, updatedAt: FRUEHER } }),
  fall("Titel fehlt", "DENY", als(SUPER), "create", "artists/neue", { daten: { ...neueKuenstlerin, titel: "" } }),
  fall("unbekannte Rolle", "DENY", als(SUPER), "create", "artists/neue",
    { daten: { ...neueKuenstlerin, roles: { [FREMDE]: "owner" } } }),

  fall("Super-Admin listet Künstler:innen", "ALLOW", als(SUPER), "list", "artists/kutscher", { vorhanden: kutscher }),
  fall("Mitglied listet die eigene Künstlerin", "ALLOW", als(EDITOR), "list", "artists/kutscher", { vorhanden: kutscher }),
  fall("Fremde listet nicht", "DENY", als(FREMDE), "list", "artists/kutscher", { vorhanden: kutscher }),
  fall("unbestätigte E-Mail liest nicht", "DENY", anmeldung(EDITOR, { bestaetigt: false }), "get",
    "artists/kutscher/works/ob1", { vorhanden: werk }),
  fall("abgemeldet liest nicht", "DENY", null, "get", "artists/kutscher/works/ob1", { vorhanden: werk }),

  fall("Admin ändert Einstellungen und Rollen zusammen", "ALLOW", als(ADMIN), "update", "artists/kutscher",
    { daten: { ...kutscher, titel: "Neu", roles: {}, updatedAt: JETZT }, vorhanden: kutscher }),
  fall("niemand löscht eine Künstlerin", "DENY", als(SUPER), "delete", "artists/kutscher", { vorhanden: kutscher }),

  fall("Admin einer anderen Künstlerin legt keine Werkgruppe an", "DENY", als(ADMIN), "create",
    "artists/andere/werkgruppen/x", { daten: gruppe }),
  fall("Reihenfolge der Werkgruppe muss eine ganze Zahl sein", "DENY", als(ADMIN), "create",
    "artists/kutscher/werkgruppen/fotografie", { daten: { ...gruppe, reihenfolge: "13" } }),
  fall("Werkgruppe hat keinen Bildordner mehr", "DENY", als(ADMIN), "create",
    "artists/kutscher/werkgruppen/fotografie", { daten: { ...gruppe, ordner: "fotografie" } }),
  fall("niemand löscht eine Werkgruppe", "DENY", als(SUPER), "delete", "artists/kutscher/werkgruppen/objekte",
    { vorhanden: gruppe }),

  fall("Bearbeiter:in liest Seiten", "ALLOW", als(EDITOR), "get", "artists/kutscher/seiten/kontakt", { vorhanden: seite }),
  fall("Bearbeiter:in löscht keine Seite", "DENY", als(EDITOR), "delete", "artists/kutscher/seiten/kontakt", { vorhanden: seite }),
  fall("Admin löscht eine Seite", "ALLOW", als(ADMIN), "delete", "artists/kutscher/seiten/kontakt", { vorhanden: seite }),
  fall("Seite braucht Header oder Footer", "DENY", als(ADMIN), "create", "artists/kutscher/seiten/neu",
    { daten: { ...seite, kategorie: "Seitenleiste", updatedAt: JETZT } }),
  fall("Inv. Nr. bleibt", "DENY", als(EDITOR), "update", "artists/kutscher/works/ob1",
    { daten: { ...werk, InvNr: "OB2", updatedAt: JETZT, lastChange: "h1" }, vorhanden: werk }),
  fall("Änderung ohne Verlaufseintrag", "DENY", als(EDITOR), "update", "artists/kutscher/works/ob1",
    { daten: { ...werk, Titel: "Neu", updatedAt: JETZT, lastChange: "h2" }, vorhanden: werk }),
  fall("Veröffentlichung im Namen einer anderen", "DENY", als(ADMIN), "create",
    "artists/kutscher/veroeffentlichungen/v1", { daten: { von: EDITOR, angefordert: JETZT, status: "angefordert" } }),
  fall("Veröffentlichung mit eigenem Status", "DENY", als(ADMIN), "create",
    "artists/kutscher/veroeffentlichungen/v1", { daten: { von: ADMIN, angefordert: JETZT, status: "fertig" } }),
  fall("niemand ändert eine Veröffentlichung", "DENY", als(SUPER), "update", "artists/kutscher/veroeffentlichungen/v1",
    { daten: { von: SUPER, angefordert: JETZT, status: "fertig" },
      vorhanden: { von: SUPER, angefordert: FRUEHER, status: "angefordert" } }),
  fall("Bearbeiter:in liest Veröffentlichungen", "ALLOW", als(EDITOR), "get", "artists/kutscher/veroeffentlichungen/v1",
    { vorhanden: { von: ADMIN, angefordert: FRUEHER, status: "fertig" } }),
  fall("Verlaufseintrag im Namen einer anderen", "DENY", als(EDITOR), "create", "artists/kutscher/history/h1",
    { daten: { work: "ob1", by: ADMIN, at: JETZT, changes: {} } }),
];

const client = await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getClient();
const antwort = await client.request({
  url: `https://firebaserules.googleapis.com/v1/projects/${PROJEKT}:test`,
  method: "POST",
  headers: { "x-goog-user-project": PROJEKT },
  data: {
    source: { files: [{ name: "firestore.rules", content: fs.readFileSync("firestore.rules", "utf8") }] },
    testSuite: { testCases: faelle.map(({ name, ...f }) => f) },
  },
});

let fehlgeschlagen = 0;
for (const problem of antwort.data.issues ?? []) console.log(`rules: ${problem.severity} ${problem.description}`);
antwort.data.testResults.forEach((r, i) => {
  const ok = r.state === "SUCCESS";
  if (!ok) fehlgeschlagen++;
  console.log(`${ok ? "ok  " : "FAIL"} ${faelle[i].expectation.padEnd(5)} ${faelle[i].name}`);
  if (!ok) for (const m of r.debugMessages ?? []) console.log(`       ${m}`);
});
console.log(`\n${faelle.length - fehlgeschlagen}/${faelle.length} passed (${matrix.length} from the permission table)`);
process.exit(fehlgeschlagen ? 1 : 0);
