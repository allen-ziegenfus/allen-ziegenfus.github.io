/**
 * Cloud Functions: die Webversionen jedes Originals, das in den Firebase-Bucket
 * hochgeladen wird (process.js), und das Veröffentlichen (publish.js).
 * Deployen mit `firebase deploy --only functions`.
 */
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { onObjectFinalized } from "firebase-functions/v2/storage";
import { logger } from "firebase-functions";
import { kuenstlerVon, originalVerarbeiten, r2Client } from "./process.js";

const PROJEKT = "vollrad-werkverzeichnis";
const BUCKET = `${PROJEKT}.firebasestorage.app`;

initializeApp();
const db = getFirestore("werkverzeichnis");

// Der R2-Schlüssel, einmal je Instanz aus dem Secret Manager gelesen. Nur das
// Servicekonto dieser Funktion darf ihn lesen.
let r2;
async function r2Einmal() {
  if (!r2) {
    const sm = new SecretManagerServiceClient();
    const lesen = async name => (await sm.accessSecretVersion({
      name: `projects/${PROJEKT}/secrets/${name}/versions/latest`,
    }))[0].payload.data.toString().trim();
    r2 = r2Client(await lesen("r2-access-key-id"), await lesen("r2-secret-access-key"));
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
  serviceAccount: `bilder-function@${PROJEKT}.iam.gserviceaccount.com`,
}, async ereignis => {
  const { name, md5Hash } = ereignis.data;
  const kuenstler = kuenstlerVon(name);
  if (!kuenstler) return;                   // kein Original, das wir verarbeiten
  const kuenstlerDok = db.collection("artists").doc(kuenstler);
  const copyright = (await kuenstlerDok.get()).get("copyright");
  const ergebnis = await originalVerarbeiten({
    datei: getStorage().bucket(BUCKET).file(name), md5: md5Hash, kuenstlerDok, r2: await r2Einmal(),
    copyright: copyright ? `© ${copyright}` : undefined,
  });
  logger.info(`${name}: ${ergebnis?.art}`, { breiten: ergebnis?.breiten });
});

export { veroeffentlichen, buildStatus } from "./publish.js";
