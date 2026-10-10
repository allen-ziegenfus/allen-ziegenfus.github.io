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

/** Starts one build for `refs` (requests of one artist) and records it on each. */
async function start(artist, refs) {
  const site = SITES[artist];
  if (!site) {
    await Promise.all(refs.map(r => r.update({ status: "fehler", meldung: `Kein Build für „${artist}“ eingerichtet.` })));
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
    await batch.commit();
    logger.info(`${artist}: build ${build.id} for ${refs.length} request(s)`);
  } catch (e) {
    logger.error(e);
    await Promise.all(refs.map(r => r.update({ status: "fehler", meldung: String(e.message ?? e) })));
  }
}

export const veroeffentlichen = onDocumentCreated({
  document: "artists/{artist}/veroeffentlichungen/{id}",
  database: "werkverzeichnis",
  region: REGION,
  serviceAccount: SERVICE_ACCOUNT,
}, async event => {
  const { artist } = event.params;
  const ref = event.data.ref;
  // A build older than the build timeout lost its status message; don't wait on it.
  const since = Date.now() - 30 * 60 * 1000;
  const running = (await ref.parent.where("status", "==", "läuft").get()).docs
    .filter(d => d.get("gestartet")?.toMillis() > since);
  if (running.length) {
    await ref.update({ status: "wartet" });
    return;
  }
  await start(artist, [ref]);
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

  const artistRef = requests.docs[0].ref.parent.parent;
  const waiting = await artistRef.collection("veroeffentlichungen").where("status", "==", "wartet").get();
  if (!waiting.empty) await start(artistRef.id, waiting.docs.map(d => d.ref));
});
