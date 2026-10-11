/**
 * Publishing. The admin page creates artists/{a}/veroeffentlichungen/{id}
 * (firestore.rules lets only the `publish` permission do that); `veroeffentlichen`
 * runs that artist's Cloud Build trigger (cloudbuild.yaml) and `buildStatus`
 * follows the build through Cloud Build's Pub/Sub topic.
 *
 * Status: angefordert → läuft → fertig | fehler. A request made while a build
 * is running waits ("wartet"); when the build ends, one new build takes all
 * waiting requests, since a build reads whatever Firestore holds when it starts.
 */
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { CloudBuildClient } from "@google-cloud/cloudbuild";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { logger } from "firebase-functions";

const PROJECT = "vollrad-werkverzeichnis";
const REGION = "europe-west3";
const SERVICE_ACCOUNT = `publish-function@${PROJECT}.iam.gserviceaccount.com`;

/** Which trigger and branch build which artist's site. */
const SITES = {
  kutscher: { trigger: "werkverzeichnis-firestore-build", branch: "firestore-build" },
};

const DONE = { SUCCESS: "fertig", FAILURE: "fehler", INTERNAL_ERROR: "fehler", TIMEOUT: "fehler",
  CANCELLED: "fehler", EXPIRED: "fehler" };

const db = () => getFirestore("werkverzeichnis");
let cloudBuild;

/**
 * Who builds right now: artists/{a}/intern/veroeffentlichen holds `seit` and
 * `buildId` while a publication build runs (no rule matches it, so clients can't
 * see it). Both handlers read and write it in transactions, so two requests
 * can't both start a build, and a request queued while a build ends is never lost.
 */
const lockOf = artistRef => artistRef.collection("intern").doc("veroeffentlichen");
// A lock older than the build timeout lost its status message; don't wait on it.
const STALE = 30 * 60 * 1000;

/**
 * Releases the lock after a failed start. Requests that queued up meanwhile
 * fail too: no build will end to pick them up.
 */
async function release(artistRef, meldung) {
  const lock = lockOf(artistRef);
  await db().runTransaction(async tx => {
    await tx.get(lock);
    const waiting = await tx.get(artistRef.collection("veroeffentlichungen").where("status", "==", "wartet"));
    for (const d of waiting.docs) tx.update(d.ref, { status: "fehler", meldung });
    tx.delete(lock);
  });
}

/** Starts one build for `refs` (requests of one artist, who holds the lock). */
async function start(artistRef, refs) {
  const artist = artistRef.id;
  const lock = lockOf(artistRef);
  const site = SITES[artist];
  if (!site) {
    const meldung = `Kein Build für „${artist}“ eingerichtet.`;
    await Promise.all(refs.map(r => r.update({ status: "fehler", meldung })));
    await release(artistRef, meldung);
    return;
  }
  cloudBuild ??= new CloudBuildClient();
  try {
    const [op] = await cloudBuild.runBuildTrigger({
      name: `projects/${PROJECT}/locations/${REGION}/triggers/${site.trigger}`,
      source: { branchName: site.branch },
    });
    const build = op.metadata.build;
    const batch = db().batch();
    for (const r of refs) {
      batch.update(r, { status: "läuft", buildId: build.id, logUrl: build.logUrl,
        gestartet: FieldValue.serverTimestamp() });
    }
    batch.update(lock, { buildId: build.id });
    await batch.commit();
    logger.info(`${artist}: build ${build.id} for ${refs.length} request(s)`);
  } catch (e) {
    logger.error(e);
    const meldung = String(e.message ?? e);
    await Promise.all(refs.map(r => r.update({ status: "fehler", meldung })));
    await release(artistRef, meldung);
  }
}

export const veroeffentlichen = onDocumentCreated({
  document: "artists/{artist}/veroeffentlichungen/{id}",
  database: "werkverzeichnis",
  region: REGION,
  serviceAccount: SERVICE_ACCOUNT,
}, async event => {
  const ref = event.data.ref;
  const artistRef = ref.parent.parent;
  const lock = lockOf(artistRef);
  const mine = await db().runTransaction(async tx => {
    const held = (await tx.get(lock)).get("seit");
    if (held && held.toMillis() > Date.now() - STALE) {
      tx.update(ref, { status: "wartet" });
      // Writing the lock makes a finishing build's transaction see this request.
      tx.update(lock, { wartend: FieldValue.increment(1) });
      return false;
    }
    tx.set(lock, { seit: Timestamp.now(), buildId: null });
    return true;
  });
  if (mine) await start(artistRef, [ref]);
});

export const buildStatus = onMessagePublished({
  topic: "cloud-builds",
  region: REGION,
  serviceAccount: SERVICE_ACCOUNT,
}, async event => {
  const build = event.data.message.json;
  const status = DONE[build.status];
  if (!status) return;                       // still queued or working
  const requests = await db().collectionGroup("veroeffentlichungen").where("buildId", "==", build.id).get();
  if (requests.empty) return;                // a push build, not a publication
  const batch = db().batch();
  for (const d of requests.docs) {
    batch.update(d.ref, { status, buildStatus: build.status,
      fertig: build.finishTime ? Timestamp.fromDate(new Date(build.finishTime)) : FieldValue.serverTimestamp() });
  }
  await batch.commit();

  // Hand the lock to the waiting requests, or release it. Only once per build:
  // Pub/Sub may deliver the message again.
  const artistRef = requests.docs[0].ref.parent.parent;
  const lock = lockOf(artistRef);
  const next = await db().runTransaction(async tx => {
    if ((await tx.get(lock)).get("buildId") !== build.id) return [];
    const waiting = await tx.get(artistRef.collection("veroeffentlichungen").where("status", "==", "wartet"));
    if (waiting.empty) tx.delete(lock);
    else tx.set(lock, { seit: Timestamp.now(), buildId: null });
    return waiting.docs.map(d => d.ref);
  });
  if (next.length) await start(artistRef, next);
});
