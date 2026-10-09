/**
 * Tests firestore.rules with the Firebase Rules API's test endpoint: no emulator
 * (and no Java), no data touched. Lookups (`get`, `exists`) are mocked per case.
 *
 *   node tools/rules_test.mjs
 *
 * Uses your gcloud application-default credentials.
 */
import fs from "fs";
import { GoogleAuth } from "google-auth-library";

const PROJECT = process.env.FIRESTORE_PROJECT ?? "vollrad-werkverzeichnis";
const DB = process.env.FIRESTORE_DATABASE ?? "werkverzeichnis";
const root = `/databases/${DB}/documents`;

// The test endpoint takes JSON; RFC 3339 strings compare equal to request.time.
const NOW = "2026-10-09T12:00:00Z";

const SUPER = "super@example.org", ADMIN = "horst@example.org",
  EDITOR = "editor@example.org", STRANGER = "stranger@example.org";

const kutscher = {
  titel: "Vollrad Kutscher", websiteTitel: "Werkverzeichnis", titelZeile1: "Werkverzeichnis von",
  titelZeile2: "Vollrad Kutscher", copyright: "Vollrad Kutscher",
  editors: [EDITOR], admins: [ADMIN], active: true, updatedAt: "2026-10-01T00:00:00Z",
};

const auth = (email, verified = true) =>
  email ? { uid: email, token: { email, email_verified: verified } } : null;

// Every case sees the same world: one super-admin, one artist.
const world = [
  { function: "exists", args: [{ exactValue: `${root}/admins/${SUPER}` }], result: { value: true } },
  { function: "exists", args: [{ anyValue: {} }], result: { value: false } },
  { function: "get", args: [{ exactValue: `${root}/artists/kutscher` }], result: { value: { data: kutscher } } },
  { function: "get", args: [{ anyValue: {} }], result: { value: null } },
];

function test(name, expectation, who, method, path, { data, existing } = {}) {
  return {
    name,
    expectation,
    request: {
      auth: auth(who), method, path: `${root}/${path}`, time: NOW,
      ...(data && { resource: { data } }),
    },
    ...(existing && { resource: { data: existing } }),
    functionMocks: world,
  };
}

const newArtist = { ...kutscher, titel: "Neue Künstlerin", admins: [], editors: [], updatedAt: NOW };
const edited = { ...kutscher, titel: "Vollrad Kutscher (neu)", updatedAt: NOW };
const gruppe = { titel: "Fotografie", kurztitel: null, reihenfolge: 13 };

const cases = [
  test("super-admin reads own admin doc", "ALLOW", SUPER, "get", `admins/${SUPER}`),
  test("nobody reads someone else's admin doc", "DENY", ADMIN, "get", `admins/${SUPER}`),
  test("admins are never written from the browser", "DENY", SUPER, "create", `admins/${ADMIN}`, { data: {} }),

  test("super-admin creates an artist", "ALLOW", SUPER, "create", "artists/neue", { data: newArtist }),
  test("artist admin cannot create artists", "DENY", ADMIN, "create", "artists/neue", { data: newArtist }),
  test("bad artist id", "DENY", SUPER, "create", "artists/Neue Künstlerin", { data: newArtist }),
  test("unknown field", "DENY", SUPER, "create", "artists/neue", { data: { ...newArtist, extra: 1 } }),
  test("client-chosen timestamp", "DENY", SUPER, "create", "artists/neue", { data: { ...newArtist, updatedAt: "2026-10-01T00:00:00Z" } }),
  test("missing title", "DENY", SUPER, "create", "artists/neue", { data: { ...newArtist, titel: "" } }),

  test("super-admin lists artists", "ALLOW", SUPER, "list", "artists/kutscher", { existing: kutscher }),
  test("artist admin lists own artist", "ALLOW", ADMIN, "list", "artists/kutscher", { existing: kutscher }),
  test("stranger cannot list", "DENY", STRANGER, "list", "artists/kutscher", { existing: kutscher }),
  test("editor reads artist", "ALLOW", EDITOR, "get", "artists/kutscher", { existing: kutscher }),
  test("stranger cannot read artist", "DENY", STRANGER, "get", "artists/kutscher", { existing: kutscher }),
  test("unverified email cannot read", "DENY", null, "get", "artists/kutscher", { existing: kutscher }),

  test("artist admin edits settings", "ALLOW", ADMIN, "update", "artists/kutscher", { data: edited, existing: kutscher }),
  test("artist admin adds an editor", "ALLOW", ADMIN, "update", "artists/kutscher",
    { data: { ...edited, editors: [EDITOR, STRANGER] }, existing: kutscher }),
  test("artist admin cannot change admins", "DENY", ADMIN, "update", "artists/kutscher",
    { data: { ...edited, admins: [ADMIN, STRANGER] }, existing: kutscher }),
  test("super-admin changes admins", "ALLOW", SUPER, "update", "artists/kutscher",
    { data: { ...edited, admins: [STRANGER] }, existing: kutscher }),
  test("editor cannot edit settings", "DENY", EDITOR, "update", "artists/kutscher", { data: edited, existing: kutscher }),
  test("nobody deletes an artist", "DENY", SUPER, "delete", "artists/kutscher", { existing: kutscher }),

  test("artist admin adds a Werkgruppe", "ALLOW", ADMIN, "create", "artists/kutscher/werkgruppen/fotografie", { data: gruppe }),
  test("editor cannot add a Werkgruppe", "DENY", EDITOR, "create", "artists/kutscher/werkgruppen/fotografie", { data: gruppe }),
  test("Werkgruppe order must be an integer", "DENY", ADMIN, "create", "artists/kutscher/werkgruppen/fotografie",
    { data: { ...gruppe, reihenfolge: "13" } }),
  test("admin of another artist cannot add a Werkgruppe", "DENY", ADMIN, "create", "artists/andere/werkgruppen/x", { data: gruppe }),
  test("editor reads Werkgruppen", "ALLOW", EDITOR, "get", "artists/kutscher/werkgruppen/objekte", { existing: gruppe }),
  test("nobody deletes a Werkgruppe", "DENY", SUPER, "delete", "artists/kutscher/werkgruppen/objekte", { existing: gruppe }),

  test("editor reads works", "ALLOW", EDITOR, "get", "artists/kutscher/works/ob1", { existing: { InvNr: "OB1" } }),
  test("artist admin reads works", "ALLOW", ADMIN, "get", "artists/kutscher/works/ob1", { existing: { InvNr: "OB1" } }),
  test("stranger cannot read works", "DENY", STRANGER, "get", "artists/kutscher/works/ob1", { existing: { InvNr: "OB1" } }),
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
  console.log(`${ok ? "ok  " : "FAIL"} ${cases[i].name}`);
  if (!ok) for (const m of r.debugMessages ?? []) console.log(`       ${m}`);
});
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
