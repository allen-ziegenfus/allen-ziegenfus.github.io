/**
 * Firestore -> build artifacts (public/*.json).
 *
 *   FIRESTORE_PROJECT=... FIRESTORE_DATABASE=... ARTIST_ID=... yarn data
 *
 * Works list their images as paths in the originals bucket (BUCKET, by default
 * the project's Firebase bucket). The image function has already made their web
 * versions, served from BILDER_URL; the build only links to them, by the
 * original's MD5, which the bucket listing gives without downloading anything.
 */
import * as fs from "fs";
import { marked } from "marked";
import { Storage } from "@google-cloud/storage";
import { firestoreCatalog, WORK_FIELDS, type Medium } from "./catalog.js";

const PUBLIC = "./public";

const env = process.env;

function required(name: string): string {
  const v = env[name];
  if (!v) throw new Error(`${name} must be set`);
  return v;
}

const PROJECT = required("FIRESTORE_PROJECT");
const DATABASE = env.FIRESTORE_DATABASE ?? "werkverzeichnis";
const ARTIST = required("ARTIST_ID");
const BUCKET = env.BUCKET ?? `${PROJECT}.firebasestorage.app`;
const BILDER_URL = env.BILDER_URL ?? "/bilder";

/**
 * One image as the pages need it. `src` always works on its own; the srcsets
 * (avif, webp), size and preview are there when the image function made them.
 */
interface Bild {
  src: string;
  /** ~400 px, for thumbnails and lists. */
  klein?: string;
  /** The largest version, for the lightbox. */
  gross?: string;
  breite?: number;
  hoehe?: number;
  avif?: string;
  webp?: string;
  vorschau?: string;
  /** MIME type, for videos. */
  video?: string;
}

const PLACEHOLDER: Bild = { src: "/placeholder.png" };

function fromMedium(md5: string, m: Medium): Bild {
  const base = `${BILDER_URL}/${ARTIST}/${md5}`;
  if (m.art === "video") return { src: `${base}.${m.formate![0]}`, video: `video/${m.formate![0]}` };
  if (m.art !== "bild") return PLACEHOLDER;              // PDFs, unreadable files
  const widths = m.breiten!;
  const pick = (target: number) => widths.find(w => w >= target) ?? widths.at(-1)!;
  const srcset = (fmt: string) => widths.map(w => `${base}-${w}.${fmt} ${w}w`).join(", ");
  return {
    src: `${base}-${pick(800)}.webp`, klein: `${base}-${pick(400)}.webp`,
    gross: `${base}-${widths.at(-1)}.webp`, breite: m.breite, hoehe: m.hoehe,
    avif: m.formate!.includes("avif") ? srcset("avif") : undefined, webp: srcset("webp"),
    vorschau: m.vorschau,
  };
}

function expandYears(jahr?: string): number[] {
  if (!jahr) return [];
  const years: number[] = [];
  for (const part of String(jahr).split(",")) {
    const [min, max] = part.split("-").map(s => Number(s.trim()));
    if (!min) continue;
    if (!max) { years.push(min); continue; }
    for (let y = min; y <= max; y++) years.push(y);
  }
  return years;
}

/** The artist's originals: object path -> MD5 (hex). */
async function fingerprints(): Promise<Map<string, string>> {
  const [files] = await new Storage({ projectId: PROJECT }).bucket(BUCKET)
    .getFiles({ prefix: `artists/${ARTIST}/` });
  return new Map(files.map(f => [f.name, Buffer.from(f.metadata.md5Hash!, "base64").toString("hex")]));
}

/** Validation is the price of a schemaless source. Fail loud, never render a gap. */
const problems: string[] = [];

async function build() {
  const [catalog, md5s] = await Promise.all([firestoreCatalog(PROJECT, DATABASE, ARTIST), fingerprints()]);
  problems.push(...catalog.problems);

  /**
   * A listed image as a Bild. Not in the bucket, or no web versions yet, is a
   * data problem rather than a gap to render.
   */
  function webBild(p: string, owner: string): Bild | null {
    const md5 = md5s.get(p);
    if (md5 === undefined) { problems.push(`${owner}: image ${p} not in the bucket`); return null; }
    const m = catalog.medien.get(md5);
    if (!m) { problems.push(`${owner}: web versions of ${p} not made yet`); return null; }
    if (m.art === "fehler") console.warn(`  ${owner}: ${p} unreadable: ${m.fehler}`);
    return fromMedium(md5, m);
  }

  // Ties broken by slug, so the order never depends on read order.
  const bySlug = (a: { slug: string }, b: { slug: string }) => a.slug.localeCompare(b.slug);
  const groups = [...catalog.werkgruppen].sort((a, b) => a.reihenfolge - b.reihenfolge || bySlug(a, b));
  const thumbnail = (b: Bild) => b.video ? "/placeholder.png" : b.klein ?? b.src;

  const werkgruppen = [];
  const searchMetadata = {
    MinYear: Number.MAX_VALUE, MaxYear: Number.MIN_VALUE,
    Werkgruppen: [] as any[], InvNrs: [] as string[],
  };

  for (const group of groups) {
    const works = catalog.works.filter(w => w.werkgruppe === group.slug);
    const records = [];

    for (const work of works) {
      // The work's own image paths, in order; the first is the thumbnail.
      const bilder = (work.images ?? []).map(p => webBild(p, work.slug)).filter((b): b is Bild => b !== null);
      if (!bilder.length) bilder.push(PLACEHOLDER);

      const year = Number(work.Jahr);
      if (year) {
        searchMetadata.MinYear = Math.min(searchMetadata.MinYear, year);
        searchMetadata.MaxYear = Math.max(searchMetadata.MaxYear, year);
      }

      records.push({
        InvNr: work.InvNr,
        InventoryNumber: work.InvNr.replaceAll(/[^0-9]/g, ""),
        Slug: work.slug,
        WerkgruppeSlug: group.slug,
        ...Object.fromEntries(WORK_FIELDS.filter(f => f !== "InvNr").map(f => [f, work[f]])),
        Bilder: bilder,
        Thumbnail: thumbnail(bilder[0]),
      });
    }

    records.sort((a, b) =>
      Number(a.InventoryNumber) - Number(b.InventoryNumber) || a.Slug.localeCompare(b.Slug));
    searchMetadata.InvNrs.push(...records.map(r => r.InvNr));

    if (!group.cover) problems.push(`no cover image for Werkgruppe ${group.slug}`);
    const titelbild = group.cover ? webBild(group.cover, group.slug) ?? PLACEHOLDER : PLACEHOLDER;

    werkgruppen.push({
      Titel: group.titel,
      Slug: group.slug,
      Thumbnail: thumbnail(titelbild),
      Titelbild: titelbild,
      Count: records.length,
      Records: records,
      Reihenfolge: group.reihenfolge,
      Kurztitel: group.kurztitel,
    });
    searchMetadata.Werkgruppen.push({
      WerkgruppenSlug: group.slug, WerkgruppenTitel: group.titel,
    });
    console.log(`  ${group.slug.padEnd(22)} ${records.length} works`);
  }

  const orphanWorks = catalog.works.filter(w => !groups.some(g => g.slug === w.werkgruppe));
  if (orphanWorks.length) problems.push(`${orphanWorks.length} work(s) in no Werkgruppe`);

  const pages = [...catalog.seiten]
    .sort((a, b) => a.reihenfolge - b.reihenfolge || bySlug(a, b))
    .map(p => ({
      Name: p.titel, Slug: p.slug, Html: marked.parse(p.text),
      Reihenfolge: p.reihenfolge, Kategorie: p.kategorie,
    }));

  const works = werkgruppen.reduce((n, w) => n + w.Records.length, 0);
  console.log(`\n${werkgruppen.length} Werkgruppen, ${works} works, ${pages.length} pages`);

  if (problems.length) {
    console.error(`\n${problems.length} problem(s) in the data:`);
    for (const p of problems.slice(0, 40)) console.error(`  ! ${p}`);
    if (env.STRICT === "1") process.exit(1);
  }

  const searchData = werkgruppen.flatMap(w => w.Records.map((r: any) => ({
    InvNr: r.InvNr, Beschreibung: r.Beschreibung, Jahr: r.Jahr,
    Jahre: expandYears(r.Jahr), Slug: r.Slug, Titel: r.Titel,
    Werkgruppe: r.Werkgruppe, WerkgruppeSlug: r.WerkgruppeSlug, Thumbnail: r.Thumbnail,
  })));

  fs.writeFileSync(`${PUBLIC}/site.json`, JSON.stringify(catalog.artist));
  fs.writeFileSync(`${PUBLIC}/werkgruppen.json`, JSON.stringify(werkgruppen));
  fs.writeFileSync(`${PUBLIC}/searchData.json`, JSON.stringify(searchData));
  fs.writeFileSync(`${PUBLIC}/searchMetadata.json`, JSON.stringify(searchMetadata));
  fs.writeFileSync(`${PUBLIC}/pages.json`, JSON.stringify(pages));
  fs.writeFileSync(`${PUBLIC}/robots.txt`,
    `User-agent: *\nAllow: /\n\nSitemap: ${env.SITE}/sitemap-index.xml\n`);
}

await build();
