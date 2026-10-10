/**
 * The Werkverzeichnis data model, and the two places it can be read from.
 *
 * Firestore holds this model as is (artists/{artist}/werkgruppen, works, seiten).
 * The Sheet is mapped into it: its column headers become the field names below,
 * its page tabs become Markdown. The build only ever sees a Catalog, so a Sheet
 * build and a Firestore build of the same data produce identical output — which
 * is how the switch to Firestore is verified, and how the Sheet is imported.
 */
import { slugify } from "./slugify.js";
import type { Row, Source } from "./source.js";

export interface Werkgruppe {
  slug: string;
  titel: string;
  kurztitel?: string;
  reihenfolge: number;
  /** Image folder name (in Drive: the Sheet tab's name). */
  ordner: string;
  /** Cover image filename in the _covers folder. */
  bild?: string;
  /** Cover image in Cloud Storage (object path), once uploaded. */
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
  werkgruppen: Werkgruppe[];
  works: Work[];
  seiten: Seite[];
  /** Web versions by fingerprint; Firestore only. */
  medien?: Map<string, Medium>;
  /** Data problems found while reading; the build reports them. */
  problems: string[];
}

/** A spreadsheet cannot hold null, so an empty cell must read back as absent. */
const cell = (v: string | undefined) => (v && v.trim() !== "" ? v : undefined);
const byOrder = (a: Row, b: Row) => Number(a.Reihenfolge) - Number(b.Reihenfolge);

/** Sheet column header for each work field, where they differ. */
const COLUMN: Record<string, string> = { InvNr: "Inv. Nr." };

/**
 * One page from its Sheet tab: rows joined in order into one Markdown text.
 * Table tabs (Spalte1/Spalte2, i.e. Biografie) become a Markdown table with an
 * empty header row, which the site hides.
 */
export function pageMarkdown(rows: Row[]): string {
  const kept = rows.filter(r => r.Reihenfolge).sort(byOrder);
  const tableCell = (s = "") => s.trim().replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
  if (kept.some(r => r.Spalte1 !== undefined)) {
    return ["|  |  |", "| --- | --- |",
      ...kept.map(r => `| ${tableCell(r.Spalte1)} | ${tableCell(r.Spalte2)} |`)].join("\n") + "\n";
  }
  return kept.map(r => (r.Text ?? "").trim()).filter(Boolean).join("\n\n") + "\n";
}

/** The Sheet (or the archive's CSV copy of it), read through `Source`. */
export async function sheetCatalog(source: Source): Promise<Catalog> {
  const problems: string[] = [];
  const groups = (await source.rows("_Übersicht")).sort(byOrder);

  const werkgruppen: Werkgruppe[] = groups.map(g => ({
    slug: g.Slug,
    titel: g.Titel,
    kurztitel: cell(g.Kurztitel),
    reihenfolge: Number(g.Reihenfolge),
    ordner: g.Tab,
    bild: cell(g.Bild),
  }));

  const works: Work[] = [];
  for (const g of groups) {
    const seen = new Set<string>();
    for (const row of await source.rows(g.Tab)) {
      const invNr = cell(row["Inv. Nr."]);
      if (!invNr) { problems.push(`${g.Tab}: row with no Inv. Nr.`); continue; }

      // an imported spreadsheet header row: values equal their own column names
      const headerish = Object.entries(row).filter(([k, v]) => v && v.trim() === k.trim()).length;
      if (headerish >= 3) {
        problems.push(`${g.Tab}: "${invNr}" looks like an imported header row`);
        continue;
      }

      const slug = slugify(invNr, { lower: true });
      if (seen.has(slug)) problems.push(`${g.Tab}: duplicate slug "${slug}"`);
      seen.add(slug);

      const fields = Object.fromEntries(WORK_FIELDS
        .map(f => [f, cell(row[COLUMN[f] ?? f])])
        .filter(([, v]) => v !== undefined));
      works.push({ ...fields, InvNr: invNr, slug, werkgruppe: g.Slug });
    }
  }

  const seiten: Seite[] = [];
  for (const p of (await source.rows("_Seiten")).sort(byOrder)) {
    seiten.push({
      slug: slugify(p.Tab, { lower: true }),
      titel: p.Tab,
      kategorie: p.Kategorie as Seite["kategorie"],
      reihenfolge: Number(p.Reihenfolge),
      text: pageMarkdown(await source.rows(`seite_${p.Tab.replace(/\//g, "_")}`)),
    });
  }

  return { werkgruppen, works, seiten, problems };
}

/**
 * Firestore, as stored by the admin page and editor. Runs with the build's
 * Google credentials, which bypass the security rules (read access is all the
 * build service account has).
 */
export async function firestoreCatalog(project: string, databaseId: string, artistId: string): Promise<Catalog> {
  const { Firestore } = await import("@google-cloud/firestore");
  const artist = new Firestore({ projectId: project, databaseId }).collection("artists").doc(artistId);
  const problems: string[] = [];

  const [wg, ws, ss, ms] = await Promise.all(
    ["werkgruppen", "works", "seiten", "medien"].map(c => artist.collection(c).get()));
  const medien = new Map(ms.docs.map(d => [d.id, d.data() as Medium]));

  const werkgruppen: Werkgruppe[] = wg.docs.map(d => {
    const g = d.data();
    return {
      slug: d.id, titel: g.titel, kurztitel: g.kurztitel ?? undefined,
      reihenfolge: g.reihenfolge, ordner: g.ordner, bild: g.bild ?? undefined,
      cover: g.cover ?? undefined,
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

  return { werkgruppen, works, seiten, medien, problems };
}
