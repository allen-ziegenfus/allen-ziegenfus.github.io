/**
 * Deployt firestore.rules in die genannte Datenbank, nachdem tools/rules_test.mjs
 * bestanden hat. Die Firebase CLI täte dasselbe, braucht aber eine firebase.json
 * und eine eigene Anmeldung; dies nutzt deine gcloud Application Default Credentials.
 *
 *   node tools/rules_deploy.mjs
 */
import fs from "fs";
import { execFileSync } from "child_process";
import { GoogleAuth } from "google-auth-library";

const PROJEKT = process.env.FIRESTORE_PROJECT ?? "vollrad-werkverzeichnis";
const DATENBANK = process.env.FIRESTORE_DATABASE ?? "werkverzeichnis";
const api = `https://firebaserules.googleapis.com/v1/projects/${PROJEKT}`;

execFileSync("node", ["tools/rules_test.mjs"], { stdio: ["ignore", "ignore", "inherit"] });

const client = await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getClient();
const anfrage = (url, method, data) =>
  client.request({ url, method, data, headers: { "x-goog-user-project": PROJEKT } });

const { data: regelsatz } = await anfrage(`${api}/rulesets`, "POST", {
  source: { files: [{ name: "firestore.rules", content: fs.readFileSync("firestore.rules", "utf8") }] },
});
const freigabe = `projects/${PROJEKT}/releases/cloud.firestore/${DATENBANK}`;
await anfrage(`https://firebaserules.googleapis.com/v1/${freigabe}`, "PATCH", {
  release: { name: freigabe, rulesetName: regelsatz.name },
});
console.log(`deployed ${regelsatz.name} to ${DATENBANK}`);
