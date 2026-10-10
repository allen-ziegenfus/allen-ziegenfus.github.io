/**
 * Das Datenmodell des Werkverzeichnisses, gelesen aus Firestore
 * (artists/{artist} und seine Sammlungen werkgruppen, works, seiten, medien).
 */
import { slugify } from "./slugify.js";

/** Einstellungen der Seite, aus dem Künstler-Dokument (bearbeitet in der Verwaltungsseite). */
export interface Kuenstler {
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
  /** Titelbild in Cloud Storage (Objektpfad). */
  cover?: string;
}

/** Die Felder eines Werks, in der Reihenfolge, die das JSON der Seite immer hatte. */
export const WERK_FELDER = [
  "InvNr", "Anzahl", "Werkgruppe", "Maße", "Material", "Beschreibung", "Jahr", "Zustand",
  "Standort", "Titel", "Technik", "Auflage", "Signatur", "Foto", "Ausstellung", "Literatur",
  "Bibliographie",
] as const;

export type Werk = {
  slug: string; werkgruppe: string; InvNr: string;
  /** Bilder in Cloud Storage (Objektpfade), in Reihenfolge; das erste ist das Vorschaubild. */
  images?: string[];
} & Partial<Record<(typeof WERK_FELDER)[number], string>>;

export interface Seite {
  slug: string;
  titel: string;
  kategorie: "Header" | "Footer";
  reihenfolge: number;
  /** Markdown. */
  text: string;
}

/**
 * Die Webversionen eines Originals, erzeugt von der Bildfunktion (gcf/process.js),
 * unter der MD5 des Originals. Dateien: <artist>/<md5>-<breite>.<format> in R2.
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

export interface Katalog {
  kuenstler: Kuenstler;
  werkgruppen: Werkgruppe[];
  werke: Werk[];
  seiten: Seite[];
  /** Webversionen nach Fingerabdruck (MD5). */
  medien: Map<string, Medium>;
  /** Beim Lesen gefundene Datenprobleme; der Build meldet sie. */
  probleme: string[];
}

/** Eine leere Zeichenkette gilt als nicht vorhanden. */
const wert = (v: string | undefined) => (v && v.trim() !== "" ? v : undefined);

/**
 * Läuft mit den Google-Zugangsdaten des Builds, für die die Sicherheitsregeln
 * nicht gelten (das Build-Servicekonto darf nur lesen).
 */
export async function firestoreKatalog(projekt: string, datenbank: string, kuenstlerId: string): Promise<Katalog> {
  const { Firestore } = await import("@google-cloud/firestore");
  const kuenstlerRef = new Firestore({ projectId: projekt, databaseId: datenbank })
    .collection("artists").doc(kuenstlerId);
  const probleme: string[] = [];

  const [k, wg, ws, ss, ms] = await Promise.all([kuenstlerRef.get(),
    ...["werkgruppen", "works", "seiten", "medien"].map(c => kuenstlerRef.collection(c).get())]);
  if (!k.exists) throw new Error(`artist "${kuenstlerId}" not in Firestore`);
  const { titel, websiteTitel, titelZeile1, titelZeile2, copyright } = k.data()!;
  const kuenstler = { titel, websiteTitel, titelZeile1, titelZeile2, copyright };
  const medien = new Map(ms.docs.map(d => [d.id, d.data() as Medium]));

  const werkgruppen: Werkgruppe[] = wg.docs.map(d => {
    const g = d.data();
    return {
      slug: d.id, titel: g.titel, kurztitel: g.kurztitel ?? undefined,
      reihenfolge: g.reihenfolge, cover: g.cover ?? undefined,
    };
  }).sort((a, b) => a.reihenfolge - b.reihenfolge);

  const bekannt = new Set(werkgruppen.map(g => g.slug));
  const werke: Werk[] = [];
  for (const d of ws.docs) {
    const w = d.data();
    if (!bekannt.has(w.werkgruppe)) {
      probleme.push(`work ${d.id}: unknown Werkgruppe "${w.werkgruppe}"`);
      continue;
    }
    if (d.id !== slugify(w.InvNr ?? "", { lower: true })) {
      probleme.push(`work ${d.id}: id does not match its Inv. Nr. "${w.InvNr}"`);
    }
    const felder = Object.fromEntries(WERK_FELDER
      .map(f => [f, wert(w[f])])
      .filter(([, v]) => v !== undefined));
    werke.push({ ...felder, InvNr: w.InvNr, slug: d.id, werkgruppe: w.werkgruppe, images: w.images });
  }

  const seiten: Seite[] = ss.docs.map(d => {
    const s = d.data();
    return { slug: d.id, titel: s.titel, kategorie: s.kategorie, reihenfolge: s.reihenfolge, text: s.text };
  }).sort((a, b) => a.reihenfolge - b.reihenfolge);

  return { kuenstler, werkgruppen, werke, seiten, medien, probleme };
}
