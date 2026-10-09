/**
 * Deploys firestore.rules to the named database, after tools/rules_test.mjs
 * passes. The Firebase CLI would do the same but needs a firebase.json and a
 * login of its own; this uses your gcloud application-default credentials.
 *
 *   node tools/rules_deploy.mjs
 */
import fs from "fs";
import { execFileSync } from "child_process";
import { GoogleAuth } from "google-auth-library";

const PROJECT = process.env.FIRESTORE_PROJECT ?? "vollrad-werkverzeichnis";
const DB = process.env.FIRESTORE_DATABASE ?? "werkverzeichnis";
const api = `https://firebaserules.googleapis.com/v1/projects/${PROJECT}`;

execFileSync("node", ["tools/rules_test.mjs"], { stdio: ["ignore", "ignore", "inherit"] });

const client = await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getClient();
const request = (url, method, data) =>
  client.request({ url, method, data, headers: { "x-goog-user-project": PROJECT } });

const { data: ruleset } = await request(`${api}/rulesets`, "POST", {
  source: { files: [{ name: "firestore.rules", content: fs.readFileSync("firestore.rules", "utf8") }] },
});
const release = `projects/${PROJECT}/releases/cloud.firestore/${DB}`;
await request(`https://firebaserules.googleapis.com/v1/${release}`, "PATCH", {
  release: { name: release, rulesetName: ruleset.name },
});
console.log(`deployed ${ruleset.name} to ${DB}`);
