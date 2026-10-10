/**
 * Veröffentlichen. Die Verwaltungsseite legt artists/{a}/veroeffentlichungen/{id}
 * an (firestore.rules erlaubt das nur mit der Berechtigung `veroeffentlichen`);
 * `veroeffentlichen` startet den Cloud-Build-Trigger dieser Künstler:in
 * (cloudbuild.yaml), und `buildStatus` verfolgt den Build über das Pub/Sub-Topic
 * von Cloud Build.
 *
 * Status: angefordert → läuft → fertig | fehler. Eine Anfrage während eines
 * laufenden Builds wartet („wartet“); endet der Build, übernimmt ein neuer Build
 * alle wartenden Anfragen, denn ein Build liest, was beim Start in Firestore steht.
 */
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { CloudBuildClient } from "@google-cloud/cloudbuild";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import { logger } from "firebase-functions";

const PROJEKT = "vollrad-werkverzeichnis";
const REGION = "europe-west3";
const SERVICEKONTO = `publish-function@${PROJEKT}.iam.gserviceaccount.com`;

/** Welcher Trigger und welcher Branch die Seite welcher Künstler:in bauen. */
const SEITEN = {
  kutscher: { trigger: "werkverzeichnis-firestore-build", branch: "firestore-build" },
};

const ENDE = { SUCCESS: "fertig", FAILURE: "fehler", INTERNAL_ERROR: "fehler", TIMEOUT: "fehler",
  CANCELLED: "fehler", EXPIRED: "fehler" };

const db = () => getFirestore("werkverzeichnis");
let cloudBuild;

/** Startet einen Build für `anfragen` (einer Künstler:in) und trägt ihn bei jeder ein. */
async function starten(kuenstler, anfragen) {
  const seite = SEITEN[kuenstler];
  if (!seite) {
    await Promise.all(anfragen.map(a => a.update({ status: "fehler", meldung: `Kein Build für „${kuenstler}“ eingerichtet.` })));
    return;
  }
  cloudBuild ??= new CloudBuildClient();
  try {
    const [vorgang] = await cloudBuild.runBuildTrigger({
      name: `projects/${PROJEKT}/locations/${REGION}/triggers/${seite.trigger}`,
      source: { branchName: seite.branch },
    });
    const build = vorgang.metadata.build;
    const stapel = db().batch();
    for (const a of anfragen) {
      stapel.update(a, { status: "läuft", buildId: build.id, logUrl: build.logUrl,
        gestartet: FieldValue.serverTimestamp() });
    }
    await stapel.commit();
    logger.info(`${kuenstler}: build ${build.id} for ${anfragen.length} request(s)`);
  } catch (e) {
    logger.error(e);
    await Promise.all(anfragen.map(a => a.update({ status: "fehler", meldung: String(e.message ?? e) })));
  }
}

export const veroeffentlichen = onDocumentCreated({
  document: "artists/{kuenstler}/veroeffentlichungen/{id}",
  database: "werkverzeichnis",
  region: REGION,
  serviceAccount: SERVICEKONTO,
}, async ereignis => {
  const { kuenstler } = ereignis.params;
  const ref = ereignis.data.ref;
  // Ein Build, der älter ist als das Build-Timeout, hat seine Statusmeldung
  // verloren; nicht auf ihn warten.
  const seit = Date.now() - 30 * 60 * 1000;
  const laufend = (await ref.parent.where("status", "==", "läuft").get()).docs
    .filter(d => d.get("gestartet")?.toMillis() > seit);
  if (laufend.length) {
    await ref.update({ status: "wartet" });
    return;
  }
  await starten(kuenstler, [ref]);
});

export const buildStatus = onMessagePublished({
  topic: "cloud-builds",
  region: REGION,
  serviceAccount: SERVICEKONTO,
}, async ereignis => {
  const build = ereignis.data.message.json;
  const status = ENDE[build.status];
  if (!status) return;                       // wartet noch oder läuft
  const anfragen = await db().collectionGroup("veroeffentlichungen").where("buildId", "==", build.id).get();
  if (anfragen.empty) return;                // ein Build nach Push, keine Veröffentlichung
  const stapel = db().batch();
  for (const d of anfragen.docs) {
    stapel.update(d.ref, { status, buildStatus: build.status,
      fertig: build.finishTime ? Timestamp.fromDate(new Date(build.finishTime)) : FieldValue.serverTimestamp() });
  }
  await stapel.commit();

  const kuenstlerRef = anfragen.docs[0].ref.parent.parent;
  const wartend = await kuenstlerRef.collection("veroeffentlichungen").where("status", "==", "wartet").get();
  if (!wartend.empty) await starten(kuenstlerRef.id, wartend.docs.map(d => d.ref));
});
