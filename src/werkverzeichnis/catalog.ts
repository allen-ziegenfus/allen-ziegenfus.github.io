/**
 * The Werkverzeichnis data model, read from Firestore
 * (artists/{artist} and its werkgruppen, works, seiten, medien).
 */
import { slugify } from "./slugify.js";

/** Site settings, from the artist document (edited in the admin page). */
export interface Artist {
  titel: string;
  websiteTitel: string;
  titelZeile1: string;
  titelZeile2: string;
  copyright: string;
}

export interface Werkgruppe {
  slug: string;
  titel: string;
  kurztitel?: string;
  reihenfolge: number;
  /** Cover image in Cloud Storage (object path). */
  cover?: string;
}

/** The fields of a work, in the order the site's JSON has always had them. */
export const WORK_FIELDS = [
  "InvNr", "Anzahl", "Werkgruppe", "Maße", "Material", "Beschreibung", "Jahr", "Zustand",
  "Standort", "Titel", "Technik", "Auflage", "Signatur", "Foto", "Ausstellung", "Literatur",
  "Bibliographie",
] as const;

export type Work = {
  slug: string; werkgruppe: string; InvNr: string;
  /** Images in Cloud Storage (object paths), in order; the first is the thumbnail. */
  images?: string[];
} & Partial<Record<(typeof WORK_FIELDS)[number], string>>;

export interface Seite {
  slug: string;
  titel: string;
  kategorie: "Header" | "Footer";
  reihenfolge: number;
  /** Markdown. */
  text: string;
}

/**
 * The web versions of one original, made by the image function (gcf/process.js)
 * and keyed by the original's MD5. Files: <artist>/<md5>-<width>.<format> in R2.
 */
export interface Medium {
  art: "bild" | "video" | "nicht unterstützt" | "fehler";
  breite?: number;
  hoehe?: number;
  breiten?: number[];
  formate?: string[];
  vorschau?: string;
  fehler?: string;
}

export interface Catalog {
  artist: Artist;
  werkgruppen: Werkgruppe[];
  works: Work[];
  seiten: Seite[];
  /** Web versions by fingerprint. */
  medien: Map<string, Medium>;
  /** Data problems found while reading; the build reports them. */
  problems: string[];
}

/** An empty string reads as absent. */
const cell = (v: string | undefined) => (v && v.trim() !== "" ? v : undefined);

/**
 * Runs with the build's Google credentials, which bypass the security rules
 * (read access is all the build service account has).
 */
export async function firestoreCatalog(project: string, databaseId: string, artistId: string): Promise<Catalog> {
  const { Firestore } = await import("@google-cloud/firestore");
  const artistRef = new Firestore({ projectId: project, databaseId }).collection("artists").doc(artistId);
  const problems: string[] = [];

  const [a, wg, ws, ss, ms] = await Promise.all([artistRef.get(),
    ...["werkgruppen", "works", "seiten", "medien"].map(c => artistRef.collection(c).get())]);
  if (!a.exists) throw new Error(`artist "${artistId}" not in Firestore`);
  const { titel, websiteTitel, titelZeile1, titelZeile2, copyright } = a.data()!;
  const artist = { titel, websiteTitel, titelZeile1, titelZeile2, copyright };
  const medien = new Map(ms.docs.map(d => [d.id, d.data() as Medium]));

  const werkgruppen: Werkgruppe[] = wg.docs.map(d => {
    const g = d.data();
    return {
      slug: d.id, titel: g.titel, kurztitel: g.kurztitel ?? undefined,
      reihenfolge: g.reihenfolge, cover: g.cover ?? undefined,
    };
  }).sort((a, b) => a.reihenfolge - b.reihenfolge);

  const known = new Set(werkgruppen.map(g => g.slug));
  const works: Work[] = [];
  for (const d of ws.docs) {
    const w = d.data();
    if (!known.has(w.werkgruppe)) {
      problems.push(`work ${d.id}: unknown Werkgruppe "${w.werkgruppe}"`);
      continue;
    }
    if (d.id !== slugify(w.InvNr ?? "", { lower: true })) {
      problems.push(`work ${d.id}: id does not match its Inv. Nr. "${w.InvNr}"`);
    }
    const fields = Object.fromEntries(WORK_FIELDS
      .map(f => [f, cell(w[f])])
      .filter(([, v]) => v !== undefined));
    works.push({ ...fields, InvNr: w.InvNr, slug: d.id, werkgruppe: w.werkgruppe, images: w.images });
  }

  const seiten: Seite[] = ss.docs.map(d => {
    const s = d.data();
    return { slug: d.id, titel: s.titel, kategorie: s.kategorie, reihenfolge: s.reihenfolge, text: s.text };
  }).sort((a, b) => a.reihenfolge - b.reihenfolge);

  return { artist, werkgruppen, works, seiten, medien, problems };
}
