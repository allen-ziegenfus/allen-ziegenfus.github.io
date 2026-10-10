/**
 * Make the web versions of every original already in the bucket, the same way
 * the upload function does (process.js). For originals uploaded before the
 * function existed, or after changing what it produces (then delete the
 * medien records first, or they are skipped as done).
 *
 *   cd gcf && npm install && node backfill.js [artist]
 *
 * Uses your gcloud application-default credentials, including for reading the
 * R2 key from Secret Manager.
 */
import os from "os";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { processOriginal, r2Client } from "./process.js";

const PROJECT = "vollrad-werkverzeichnis";
const BUCKET = `${PROJECT}.firebasestorage.app`;
const ARTIST = process.argv[2] ?? "kutscher";

initializeApp({ projectId: PROJECT });
const sm = new SecretManagerServiceClient();
const secret = async name => (await sm.accessSecretVersion({
  name: `projects/${PROJECT}/secrets/${name}/versions/latest`,
}))[0].payload.data.toString().trim();
const r2 = r2Client(await secret("r2-access-key-id"), await secret("r2-secret-access-key"));

const artistDoc = getFirestore("werkverzeichnis").collection("artists").doc(ARTIST);
const copyright = (await artistDoc.get()).get("copyright");
const [files] = await getStorage().bucket(BUCKET).getFiles({ prefix: `artists/${ARTIST}/` });
const done = new Set((await artistDoc.collection("medien").select().get()).docs.map(d => d.id));
const todo = files.filter(f => !done.has(Buffer.from(f.metadata.md5Hash, "base64").toString("hex")));
console.log(`${files.length} originals, ${files.length - todo.length} already done, ${todo.length} to process`);

const counts = {};
let next = 0, finished = 0;
const started = Date.now();
await Promise.all(Array.from({ length: Math.max(2, os.cpus().length - 2) }, async () => {
  while (next < todo.length) {
    const file = todo[next++];
    const d = await processOriginal({ file, md5: file.metadata.md5Hash, artistDoc, r2,
      copyright: copyright ? `© ${copyright}` : undefined });
    const kind = d?.art ?? "übersprungen";
    counts[kind] = (counts[kind] ?? 0) + 1;
    if (kind === "fehler") console.log(`  ${file.name}: ${d.fehler}`);
    if (++finished % 100 === 0) {
      const rate = finished / ((Date.now() - started) / 1000);
      console.log(`  ${finished}/${todo.length}, ~${Math.round((todo.length - finished) / rate / 60)} min left`);
    }
  }
}));
console.log(`done in ${Math.round((Date.now() - started) / 60000)} min:`, counts);
