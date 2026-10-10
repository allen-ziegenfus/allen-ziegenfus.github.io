/**
 * Tests firestore.rules with the Firebase Rules API's test endpoint: no emulator
 * (and no Java), no data touched. Lookups (`get`, `exists`, `getAfter`) are
 * mocked per case.
 *
 *   node tools/rules_test.mjs
 *
 * Two parts:
 *   - the permission matrix, generated from src/werkverzeichnis/permissions.js:
 *     every role (plus super-admin and a stranger) × every permission, so the
 *     rules' table and the UI's table cannot drift apart
 *   - hand-written cases for what the table does not express: validation,
 *     creating artists, other artists, unverified emails
 *
 * Uses your gcloud application-default credentials.
 */
import fs from "fs";
import { GoogleAuth } from "google-auth-library";
import { PERMISSIONS, ROLES } from "../src/werkverzeichnis/permissions.js";

const PROJECT = process.env.FIRESTORE_PROJECT ?? "vollrad-werkverzeichnis";
const DB = process.env.FIRESTORE_DATABASE ?? "werkverzeichnis";
const root = `/databases/${DB}/documents`;

// The test endpoint takes JSON; RFC 3339 strings compare equal to request.time.
const NOW = "2026-10-09T12:00:00Z";
const EARLIER = "2026-10-01T00:00:00Z";

const SUPER = "super@example.org", STRANGER = "stranger@example.org";
const member = role => `${role}@example.org`;

const kutscher = {
  titel: "Vollrad Kutscher", websiteTitel: "Werkverzeichnis", titelZeile1: "Werkverzeichnis von",
  titelZeile2: "Vollrad Kutscher", copyright: "Vollrad Kutscher",
  roles: Object.fromEntries(ROLES.map(r => [member(r), r])),
  active: true, updatedAt: EARLIER,
};
const work = { InvNr: "OB1", werkgruppe: "objekte", Titel: "Ding", updatedAt: EARLIER };
const gruppe = { titel: "Fotografie", kurztitel: null, reihenfolge: 13 };
const seite = { titel: "Kontakt", kategorie: "Footer", reihenfolge: 1, text: "**Hallo**\n", updatedAt: EARLIER };

function auth(email, { verified = true, superAdmin = false } = {}) {
  if (!email) return null;
  return { uid: email, token: { email, email_verified: verified, ...(superAdmin && { superAdmin: true }) } };
}
const as = who => who === SUPER ? auth(SUPER, { superAdmin: true }) : auth(who);

// Every case sees the same world: one artist, one work, one fresh history entry.
const world = [
  { function: "get", args: [{ exactValue: `${root}/artists/kutscher` }], result: { value: { data: kutscher } } },
  { function: "get", args: [{ anyValue: {} }], result: { value: null } },
  { function: "getAfter", args: [{ exactValue: `${root}/artists/kutscher/history/h1` }],
    result: { value: { data: { work: "ob1" } } } },
  { function: "exists", args: [{ anyValue: {} }], result: { value: false } },
];

function test(name, expectation, authObj, method, path, { data, existing } = {}) {
  return {
    name,
    expectation,
    request: {
      auth: authObj, method, path: `${root}/${path}`, time: NOW,
      ...(data && { resource: { data } }),
    },
    ...(existing && { resource: { data: existing } }),
    functionMocks: world,
  };
}

// One request per permission that needs exactly that permission and is
// otherwise valid.
const probes = {
  "read": who => test(`${who} read`, null, as(who), "get", "artists/kutscher/works/ob1", { existing: work }),
  "works.edit": who => test(`${who} works.edit`, null, as(who), "update", "artists/kutscher/works/ob1",
    { data: { ...work, Titel: "Neu", updatedAt: NOW, lastChange: "h1" }, existing: work }),
  "werkgruppen.edit": who => test(`${who} werkgruppen.edit`, null, as(who), "create",
    "artists/kutscher/werkgruppen/fotografie", { data: gruppe }),
  "seiten.edit": who => test(`${who} seiten.edit`, null, as(who), "update", "artists/kutscher/seiten/kontakt",
    { data: { ...seite, text: "Neu\n", updatedAt: NOW }, existing: seite }),
  "settings.edit": who => test(`${who} settings.edit`, null, as(who), "update", "artists/kutscher",
    { data: { ...kutscher, titel: "Neu", updatedAt: NOW }, existing: kutscher }),
  "roles.manage": who => test(`${who} roles.manage`, null, as(who), "update", "artists/kutscher",
    { data: { ...kutscher, roles: { ...kutscher.roles, [STRANGER]: "editor" }, updatedAt: NOW }, existing: kutscher }),
};

const allPermissions = [...new Set(Object.values(PERMISSIONS).flat())];
const missing = allPermissions.filter(p => !probes[p]);
if (missing.length) {
  console.error(`No probe for permission(s): ${missing.join(", ")}. Add one to tools/rules_test.mjs.`);
  process.exit(1);
}

const matrix = [];
for (const permission of allPermissions) {
  for (const role of ROLES) {
    matrix.push({ ...probes[permission](member(role)),
      expectation: PERMISSIONS[role].includes(permission) ? "ALLOW" : "DENY" });
  }
  matrix.push({ ...probes[permission](SUPER), expectation: "ALLOW" });
  matrix.push({ ...probes[permission](STRANGER), expectation: "DENY" });
}

const ADMIN = member("admin"), EDITOR = member("editor");
const newArtist = { ...kutscher, titel: "Neue Künstlerin", roles: {}, updatedAt: NOW };

const cases = [
  ...matrix,

  test("super-admin creates an artist", "ALLOW", as(SUPER), "create", "artists/neue", { data: newArtist }),
  test("admin cannot create artists", "DENY", as(ADMIN), "create", "artists/neue", { data: newArtist }),
  test("superAdmin claim must be true, not truthy", "DENY",
    { uid: "x", token: { email: "x@example.org", email_verified: true, superAdmin: "yes" } },
    "create", "artists/neue", { data: newArtist }),
  test("bad artist id", "DENY", as(SUPER), "create", "artists/Neue Künstlerin", { data: newArtist }),
  test("unknown field", "DENY", as(SUPER), "create", "artists/neue", { data: { ...newArtist, extra: 1 } }),
  test("client-chosen timestamp", "DENY", as(SUPER), "create", "artists/neue",
    { data: { ...newArtist, updatedAt: EARLIER } }),
  test("missing title", "DENY", as(SUPER), "create", "artists/neue", { data: { ...newArtist, titel: "" } }),
  test("unknown role", "DENY", as(SUPER), "create", "artists/neue",
    { data: { ...newArtist, roles: { [STRANGER]: "owner" } } }),

  test("super-admin lists artists", "ALLOW", as(SUPER), "list", "artists/kutscher", { existing: kutscher }),
  test("member lists own artist", "ALLOW", as(EDITOR), "list", "artists/kutscher", { existing: kutscher }),
  test("stranger cannot list", "DENY", as(STRANGER), "list", "artists/kutscher", { existing: kutscher }),
  test("unverified email cannot read", "DENY", auth(EDITOR, { verified: false }), "get",
    "artists/kutscher/works/ob1", { existing: work }),
  test("signed out cannot read", "DENY", null, "get", "artists/kutscher/works/ob1", { existing: work }),

  test("admin edits settings and roles together", "ALLOW", as(ADMIN), "update", "artists/kutscher",
    { data: { ...kutscher, titel: "Neu", roles: {}, updatedAt: NOW }, existing: kutscher }),
  test("nobody deletes an artist", "DENY", as(SUPER), "delete", "artists/kutscher", { existing: kutscher }),

  test("admin of another artist cannot add a Werkgruppe", "DENY", as(ADMIN), "create",
    "artists/andere/werkgruppen/x", { data: gruppe }),
  test("Werkgruppe order must be an integer", "DENY", as(ADMIN), "create",
    "artists/kutscher/werkgruppen/fotografie", { data: { ...gruppe, reihenfolge: "13" } }),
  test("nobody deletes a Werkgruppe", "DENY", as(SUPER), "delete", "artists/kutscher/werkgruppen/objekte",
    { existing: gruppe }),

  test("editor reads pages", "ALLOW", as(EDITOR), "get", "artists/kutscher/seiten/kontakt", { existing: seite }),
  test("editor cannot delete a page", "DENY", as(EDITOR), "delete", "artists/kutscher/seiten/kontakt", { existing: seite }),
  test("admin deletes a page", "ALLOW", as(ADMIN), "delete", "artists/kutscher/seiten/kontakt", { existing: seite }),
  test("page needs Header or Footer", "DENY", as(ADMIN), "create", "artists/kutscher/seiten/neu",
    { data: { ...seite, kategorie: "Seitenleiste", updatedAt: NOW } }),
  test("Inv. Nr. cannot change", "DENY", as(EDITOR), "update", "artists/kutscher/works/ob1",
    { data: { ...work, InvNr: "OB2", updatedAt: NOW, lastChange: "h1" }, existing: work }),
  test("edit without history entry", "DENY", as(EDITOR), "update", "artists/kutscher/works/ob1",
    { data: { ...work, Titel: "Neu", updatedAt: NOW, lastChange: "h2" }, existing: work }),
  test("history entry in someone else's name", "DENY", as(EDITOR), "create", "artists/kutscher/history/h1",
    { data: { work: "ob1", by: ADMIN, at: NOW, changes: {} } }),
];

const client = await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getClient();
const res = await client.request({
  url: `https://firebaserules.googleapis.com/v1/projects/${PROJECT}:test`,
  method: "POST",
  headers: { "x-goog-user-project": PROJECT },
  data: {
    source: { files: [{ name: "firestore.rules", content: fs.readFileSync("firestore.rules", "utf8") }] },
    testSuite: { testCases: cases.map(({ name, ...c }) => c) },
  },
});

let failed = 0;
for (const issue of res.data.issues ?? []) console.log(`rules: ${issue.severity} ${issue.description}`);
res.data.testResults.forEach((r, i) => {
  const ok = r.state === "SUCCESS";
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${cases[i].expectation.padEnd(5)} ${cases[i].name}`);
  if (!ok) for (const m of r.debugMessages ?? []) console.log(`       ${m}`);
});
console.log(`\n${cases.length - failed}/${cases.length} passed (${matrix.length} from the permission table)`);
process.exit(failed ? 1 : 0);
