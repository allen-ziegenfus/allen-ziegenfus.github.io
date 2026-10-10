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

/**
 * Wer gerade baut: artists/{a}/intern/veroeffentlichen hält `seit` und `buildId`,
 * solange ein Veröffentlichungs-Build läuft (keine Regel passt darauf, Clients
 * sehen es nicht). Beide Handler lesen und schreiben es in Transaktionen: Zwei
 * Anfragen starten nicht beide einen Build, und eine Anfrage, die beim Ende
 * eines Builds eingeht, geht nicht verloren.
 */
const sperreVon = kuenstlerRef => kuenstlerRef.collection("intern").doc("veroeffentlichen");
// Eine Sperre, älter als das Build-Timeout, hat ihre Statusmeldung verloren; nicht auf sie warten.
const VERALTET = 30 * 60 * 1000;

/**
 * Gibt die Sperre nach einem gescheiterten Start frei. Inzwischen wartende
 * Anfragen schlagen ebenfalls fehl: Kein Build wird enden, der sie übernimmt.
 */
async function freigeben(kuenstlerRef, meldung) {
  const sperre = sperreVon(kuenstlerRef);
  await db().runTransaction(async tx => {
    await tx.get(sperre);
    const wartend = await tx.get(kuenstlerRef.collection("veroeffentlichungen").where("status", "==", "wartet"));
    for (const d of wartend.docs) tx.update(d.ref, { status: "fehler", meldung });
    tx.delete(sperre);
  });
}

/** Startet einen Build für `anfragen` (einer Künstler:in, die die Sperre hält). */
async function starten(kuenstlerRef, anfragen) {
  const kuenstler = kuenstlerRef.id;
  const sperre = sperreVon(kuenstlerRef);
  const seite = SEITEN[kuenstler];
  if (!seite) {
    const meldung = `Kein Build für „${kuenstler}“ eingerichtet.`;
    await Promise.all(anfragen.map(a => a.update({ status: "fehler", meldung })));
    await freigeben(kuenstlerRef, meldung);
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
    stapel.update(sperre, { buildId: build.id });
    await stapel.commit();
    logger.info(`${kuenstler}: build ${build.id} for ${anfragen.length} request(s)`);
  } catch (e) {
    logger.error(e);
    const meldung = String(e.message ?? e);
    await Promise.all(anfragen.map(a => a.update({ status: "fehler", meldung })));
    await freigeben(kuenstlerRef, meldung);
  }
}

export const veroeffentlichen = onDocumentCreated({
  document: "artists/{kuenstler}/veroeffentlichungen/{id}",
  database: "werkverzeichnis",
  region: REGION,
  serviceAccount: SERVICEKONTO,
}, async ereignis => {
  const ref = ereignis.data.ref;
  const kuenstlerRef = ref.parent.parent;
  const sperre = sperreVon(kuenstlerRef);
  const meine = await db().runTransaction(async tx => {
    const seit = (await tx.get(sperre)).get("seit");
    if (seit && seit.toMillis() > Date.now() - VERALTET) {
      tx.update(ref, { status: "wartet" });
      // Das Schreiben der Sperre lässt die Transaktion eines endenden Builds diese Anfrage sehen.
      tx.update(sperre, { wartend: FieldValue.increment(1) });
      return false;
    }
    tx.set(sperre, { seit: Timestamp.now(), buildId: null });
    return true;
  });
  if (meine) await starten(kuenstlerRef, [ref]);
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

  // Die Sperre an die wartenden Anfragen übergeben oder freigeben. Nur einmal je
  // Build: Pub/Sub kann die Nachricht erneut zustellen.
  const kuenstlerRef = anfragen.docs[0].ref.parent.parent;
  const sperre = sperreVon(kuenstlerRef);
  const naechste = await db().runTransaction(async tx => {
    if ((await tx.get(sperre)).get("buildId") !== build.id) return [];
    const wartend = await tx.get(kuenstlerRef.collection("veroeffentlichungen").where("status", "==", "wartet"));
    if (wartend.empty) tx.delete(sperre);
    else tx.set(sperre, { seit: Timestamp.now(), buildId: null });
    return wartend.docs.map(d => d.ref);
  });
  if (naechste.length) await starten(kuenstlerRef, naechste);
});
