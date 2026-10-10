/**
 * Erteilt oder entzieht die Rolle Super-Admin: ein Custom Claim
 * `superAdmin: true` am Firebase-Auth-Nutzer, dem firestore.rules vertraut.
 * Claims sind im Firestore Studio unsichtbar, deshalb sieht und ändert man sie
 * mit diesem Skript.
 *
 *   node tools/super_admin.mjs list
 *   node tools/super_admin.mjs grant  name@gmail.com
 *   node tools/super_admin.mjs revoke name@gmail.com
 *
 * Die Person muss sich einmal angemeldet haben (damit es den Nutzer gibt). Die
 * Änderung wirkt bei ihrer nächsten Anmeldung oder spätestens nach einer Stunde,
 * wenn sich das Token erneuert. Läuft mit deinen gcloud Application Default
 * Credentials.
 */
import { GoogleAuth } from "google-auth-library";

const PROJEKT = process.env.FIRESTORE_PROJECT ?? "vollrad-werkverzeichnis";
const api = `https://identitytoolkit.googleapis.com/v1/projects/${PROJEKT}`;

const client = await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getClient();
const aufruf = async (pfad, daten) => (await client.request({
  url: `${api}/${pfad}`, method: "POST", data: daten, headers: { "x-goog-user-project": PROJEKT },
})).data;

const claims = n => JSON.parse(n.customAttributes ?? "{}");

const [befehl, email] = process.argv.slice(2);

if (befehl === "list") {
  // Eine Seite reicht: eine Handvoll Bearbeiter:innen je Künstler:in.
  const antwort = await aufruf("accounts:query", { returnUserInfo: true, limit: "500" });
  for (const n of antwort.userInfo ?? []) {
    if (claims(n).superAdmin) console.log(n.email);
  }
} else if ((befehl === "grant" || befehl === "revoke") && email) {
  const { users } = await aufruf("accounts:lookup", { email: [email] });
  if (!users?.length) {
    console.error(`${email} has never signed in; ask them to sign in once first.`);
    process.exit(1);
  }
  const nutzer = users[0];
  const { superAdmin, ...rest } = claims(nutzer);
  const neu = befehl === "grant" ? { ...rest, superAdmin: true } : rest;
  await aufruf("accounts:update", { localId: nutzer.localId, customAttributes: JSON.stringify(neu) });
  console.log(`${email}: ${befehl === "grant" ? "now" : "no longer"} super-admin. ` +
              `Takes effect on their next sign-in.`);
} else {
  console.error("usage: node tools/super_admin.mjs list | grant <email> | revoke <email>");
  process.exit(1);
}
