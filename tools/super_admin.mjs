/**
 * Grants or revokes the super-admin role: a custom claim `superAdmin: true` on
 * the Firebase Auth user, which firestore.rules trusts. Claims are invisible in
 * Firestore Studio, so this script is the way to see and change them.
 *
 *   node tools/super_admin.mjs list
 *   node tools/super_admin.mjs grant  name@gmail.com
 *   node tools/super_admin.mjs revoke name@gmail.com
 *
 * The person must have signed in once (so the user exists). The change reaches
 * their browser on the next sign-in, or within the hour when the token renews.
 * Uses your gcloud application-default credentials.
 */
import { GoogleAuth } from "google-auth-library";

const PROJECT = process.env.FIRESTORE_PROJECT ?? "vollrad-werkverzeichnis";
const api = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}`;

const client = await new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] }).getClient();
const call = async (path, data) => (await client.request({
  url: `${api}/${path}`, method: "POST", data, headers: { "x-goog-user-project": PROJECT },
})).data;

const claims = u => JSON.parse(u.customAttributes ?? "{}");

const [command, email] = process.argv.slice(2);

if (command === "list") {
  // One page is plenty: a handful of editors per artist.
  const res = await call("accounts:query", { returnUserInfo: true, limit: "500" });
  for (const u of res.userInfo ?? []) {
    if (claims(u).superAdmin) console.log(u.email);
  }
} else if ((command === "grant" || command === "revoke") && email) {
  const { users } = await call("accounts:lookup", { email: [email] });
  if (!users?.length) {
    console.error(`${email} has never signed in; ask them to sign in once first.`);
    process.exit(1);
  }
  const user = users[0];
  const { superAdmin, ...rest } = claims(user);
  const next = command === "grant" ? { ...rest, superAdmin: true } : rest;
  await call("accounts:update", { localId: user.localId, customAttributes: JSON.stringify(next) });
  console.log(`${email}: ${command === "grant" ? "now" : "no longer"} super-admin. ` +
              `Takes effect on their next sign-in.`);
} else {
  console.error("usage: node tools/super_admin.mjs list | grant <email> | revoke <email>");
  process.exit(1);
}
