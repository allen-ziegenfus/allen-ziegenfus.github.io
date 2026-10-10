/**
 * Cloud Function: makes the web versions of every original uploaded to the
 * Firebase bucket (process.js). Deploy with `firebase deploy --only functions`.
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { onObjectFinalized } from "firebase-functions/v2/storage";
import { logger } from "firebase-functions";
import { artistOf, processOriginal, r2Client } from "./process.js";

const PROJECT = "vollrad-werkverzeichnis";
const BUCKET = `${PROJECT}.firebasestorage.app`;

initializeApp();
const db = getFirestore("werkverzeichnis");

// The R2 key, read once per instance from Secret Manager. Only this function's
// service account may read it.
let r2;
async function r2Once() {
  if (!r2) {
    const sm = new SecretManagerServiceClient();
    const read = async name => (await sm.accessSecretVersion({
      name: `projects/${PROJECT}/secrets/${name}/versions/latest`,
    }))[0].payload.data.toString().trim();
    r2 = r2Client(await read("r2-access-key-id"), await read("r2-secret-access-key"));
  }
  return r2;
}

export const bilder = onObjectFinalized({
  bucket: BUCKET,
  region: "europe-west3",
  memory: "2GiB",
  cpu: 1,
  timeoutSeconds: 300,
  concurrency: 1,
  maxInstances: 10,
  retry: true,
  serviceAccount: `bilder-function@${PROJECT}.iam.gserviceaccount.com`,
}, async event => {
  const { name, md5Hash } = event.data;
  const artist = artistOf(name);
  if (!artist) return;                      // not an original we handle
  const artistDoc = db.collection("artists").doc(artist);
  const copyright = (await artistDoc.get()).get("copyright");
  const result = await processOriginal({
    file: getStorage().bucket(BUCKET).file(name), md5: md5Hash, artistDoc, r2: await r2Once(),
    copyright: copyright ? `© ${copyright}` : undefined,
  });
  logger.info(`${name}: ${result?.art}`, { breiten: result?.breiten });
});
