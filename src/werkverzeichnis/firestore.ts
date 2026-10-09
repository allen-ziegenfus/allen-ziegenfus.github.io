import { Firestore } from "@google-cloud/firestore";

/**
 * The Firestore test (FIRESTORE.md): build-time reads, as whoever the Google
 * credentials belong to — the developer locally, the service account in CI.
 * Absent configuration means "no Firestore pages", not a failed build.
 */
const project = import.meta.env.FIRESTORE_PROJECT;
export const ARTIST = import.meta.env.ARTIST_ID ?? "kutscher";

export const db = project
  ? new Firestore({
      projectId: project,
      databaseId: import.meta.env.FIRESTORE_DATABASE ?? "(default)",
    })
  : null;

export const artist = () => db!.collection("artists").doc(ARTIST);
