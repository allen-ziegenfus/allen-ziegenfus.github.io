/**
 * Catalog -> build artifacts (public/*.json and public/images/).
 *
 * The data comes from one of three places, all read into the same Catalog
 * (catalog.ts), so the rest of this file cannot tell them apart:
 *
 *   firestore   Firestore (FIRESTORE_PROJECT, FIRESTORE_DATABASE, ARTIST_ID)
 *   google      the Sheet (SHEET_ID)
 *   csv         the offline archive (EXPORT_DIR)
 *
 * ROW_SOURCE picks one; by default the first that is configured, in that order.
 *
 * IMAGE_SOURCE picks where the image bytes come from:
 *
 *   gcs      Cloud Storage (BUCKET); each work lists its images. Default with Firestore.
 *   google   Drive (DRIVE_FOLDER_ID), found by filename convention.
 *   csv      the archive, by filename convention.
 *
 *   yarn data                                         # whatever is configured
 *   ROW_SOURCE=csv IMAGE_SOURCE=csv EXPORT_DIR=... yarn data
 */
import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";
import { marked } from "marked";
import { firestoreCatalog, sheetCatalog, WORK_FIELDS, type Catalog, type Medium } from "./catalog.js";
import { csvSource, gcsSource, googleSource, type Source } from "./source.js";

const PUBLIC = "./public";
const IMAGES = path.join(PUBLIC, "images");

const env = process.env;

function required(name: string): string {
  const v = env[name];
  if (!v) throw new Error(`${name} must be set`);
  return v;
}

const archive = () => csvSource(env.EXPORT_DIR ?? "../werkverzeichnis-export");
const drive = () => googleSource(env.SHEET_ID ?? "", required("DRIVE_FOLDER_ID"),
                                 env.CACHE_DIR ?? ".cache/originals");

const ROW_SOURCE = env.ROW_SOURCE
  ?? (env.FIRESTORE_PROJECT ? "firestore" : env.SHEET_ID ? "google" : "csv");

const IMAGE_SOURCE = env.IMAGE_SOURCE
  ?? (ROW_SOURCE === "firestore" ? "gcs" : env.DRIVE_FOLDER_ID ? "google" : "csv");
const ARTIST = env.ARTIST_ID ?? "kutscher";

/** Where image bytes come from. */
const source: Source =
  IMAGE_SOURCE === "gcs" ? gcsSource(required("FIRESTORE_PROJECT"),
    env.BUCKET ?? `${env.FIRESTORE_PROJECT}.firebasestorage.app`, env.CACHE_DIR ?? ".cache/originals")
  : IMAGE_SOURCE === "google" ? drive() : archive();

/**
 * In gcs mode works carry their image paths and the image function has made
 * the web versions, served from BILDER_URL; the build converts nothing.
 * Otherwise images are found by filename and converted here into public/images.
 */
const listed = IMAGE_SOURCE === "gcs";
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

const videoType = (src: string) =>
  src.endsWith(".webm") ? "video/webm" : src.endsWith(".mp4") ? "video/mp4" : undefined;

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

async function readCatalog(): Promise<Catalog> {
  switch (ROW_SOURCE) {
    case "firestore":
      return firestoreCatalog(required("FIRESTORE_PROJECT"),
        env.FIRESTORE_DATABASE ?? "(default)", ARTIST);
    case "google":
      required("SHEET_ID");
      return sheetCatalog(drive());
    case "csv":
      return sheetCatalog(archive());
    default:
      throw new Error(`ROW_SOURCE must be firestore, google or csv, not "${ROW_SOURCE}"`);
  }
}

/**
 * Resolve one image by filename and emit /images/<slug>-NN.webp.
 * `dir` is where the bytes live — a Werkgruppe folder, or _covers.
 */
async function materialise(filename: string, dir: string, slug: string, index: number) {
  const src = await source.original(dir, filename);
  if (!src) {
    console.warn(`  missing image: ${dir}/${filename}`);
    return "/placeholder.png";
  }
  const base = `${slug}-${String(index).padStart(2, "0")}`;
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".webm" || ext === ".mp4") {
    const dest = path.join(IMAGES, base + ext);
    if (stale(dest, src)) fs.copyFileSync(src, dest);
    return `/images/${base}${ext}`;
  }
  const dest = path.join(IMAGES, `${base}.webp`);
  if (stale(dest, src)) {
    try { await sharp(src).webp().toFile(dest); }
    catch (e) { console.warn(`  convert failed ${filename}: ${e}`); return "/placeholder.png"; }
  }
  return `/images/${base}.webp`;
}

/**
 * Is the output missing, empty, or older than its source?
 *
 * The mtime comparison is what makes a replaced image propagate. Skipping purely
 * on existence means a corrected original is converted once and then never again,
 * and the site keeps serving the old picture with nothing reporting it.
 */
function stale(dest: string, src: string): boolean {
  if (!fs.existsSync(dest)) return true;
  const out = fs.statSync(dest);
  if (out.size === 0) return true;
  return fs.statSync(src).mtimeMs > out.mtimeMs;
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

/** Validation is the price of a schemaless source. Fail loud, never render a gap. */
const problems: string[] = [];

/** Filenames in one image folder. Read once per folder by `source.warm`. */
const listing = (dir: string): string[] => source.listing(dir);

/**
 * Every image belonging to one work, by convention.
 *
 * Safe only while no slug is a prefix of another — otherwise `gf1053-*` would also
 * sweep up the images of `GF1053 - 1069`. Measured as zero collisions across all
 * 2,144 works today, but new inventory numbers could introduce one, so
 * `checkPrefixCollisions` runs every build rather than trusting that measurement.
 */
function imagesFor(dir: string, slug: string): string[] {
  return listing(dir).filter(f => {
    if (!f.startsWith(slug + "-")) return false;
    const rest = f.slice(slug.length + 1);
    return /^\d+\.[A-Za-z0-9]+$/.test(rest);      // exactly "-NN.ext", nothing deeper
  });
}

/** A slug that prefixes another silently over-attaches images. Refuse to guess. */
function checkPrefixCollisions(slugs: string[], where: string) {
  const sorted = [...slugs].sort();
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startsWith(sorted[i - 1] + "-")) {
      problems.push(
        `${where}: "${sorted[i - 1]}" is a filename prefix of "${sorted[i]}" — ` +
        `image lookup by convention is ambiguous for these two`);
    }
  }
}

/**
 * Run `jobs` with at most `n` in flight. Downloads wait on the network and sharp
 * has its own threads, so a handful at once is most of the gain.
 */
async function pool(n: number, jobs: (() => Promise<void>)[]) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, async () => {
    while (next < jobs.length) await jobs[next++]();
  }));
}

const IMAGE_CONCURRENCY = Number(process.env.IMAGE_CONCURRENCY ?? 8);

async function build() {
  fs.mkdirSync(IMAGES, { recursive: true });

  const catalog = await readCatalog();
  problems.push(...catalog.problems);
  console.log(`data from ${ROW_SOURCE}, images from ${IMAGE_SOURCE}`);

  // Image work is queued while the data is assembled and run only after the
  // checks, so a bad row fails the build in a minute rather than after every
  // image has been fetched.
  const imageJobs: (() => Promise<void>)[] = [];

  // Ties broken by slug, so every source yields the same order.
  const bySlug = (a: { slug: string }, b: { slug: string }) => a.slug.localeCompare(b.slug);
  const groups = [...catalog.werkgruppen].sort((a, b) => a.reihenfolge - b.reihenfolge || bySlug(a, b));

  // One listing up front, so image lookup stays a map hit.
  await source.warm(listed ? [`artists/${ARTIST}`] : [...groups.map(g => g.ordner), "_covers"]);

  /**
   * A listed image as a Bild. Not in the bucket, or no web versions yet, is a
   * data problem rather than a gap to render.
   */
  function webBild(p: string, owner: string): Bild | null {
    const md5 = source.fingerprint!(path.dirname(p), path.basename(p));
    if (md5 === undefined) { problems.push(`${owner}: image ${p} not in the bucket`); return null; }
    const m = catalog.medien?.get(md5);
    if (!m) { problems.push(`${owner}: web versions of ${p} not made yet`); return null; }
    if (m.art === "fehler") console.warn(`  ${owner}: ${p} unreadable: ${m.fehler}`);
    return fromMedium(md5, m);
  }

  /** Converted here, by convention mode: src is filled in once the job has run. */
  function localBild(file: string, dir: string, slug: string, index: number): Bild {
    const bild: Bild = { src: "/placeholder.png" };
    imageJobs.push(async () => {
      bild.src = await materialise(file, dir, slug, index);
      bild.video = videoType(bild.src);
    });
    return bild;
  }

  const werkgruppen = [];
  const searchMetadata = {
    MinYear: Number.MAX_VALUE, MaxYear: Number.MIN_VALUE,
    Werkgruppen: [] as any[], InvNrs: [] as string[],
  };

  for (const group of groups) {
    const works = catalog.works.filter(w => w.werkgruppe === group.slug);
    const records = [];

    for (const work of works) {
      // Listed: the work's own image paths, in order. Otherwise by convention,
      // <slug>-NN.<ext> in the Werkgruppe's folder, where sorting by filename
      // is the order. Either way the first image becomes the thumbnail.
      const bilder: Bild[] = listed
        ? (work.images ?? []).map(p => webBild(p, work.slug)).filter((b): b is Bild => b !== null)
        : imagesFor(group.ordner, work.slug).map((f, i) => localBild(f, group.ordner, work.slug, i + 1));
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
        Thumbnail: "/placeholder.png",   // set once the images exist
      });
    }

    records.sort((a, b) =>
      Number(a.InventoryNumber) - Number(b.InventoryNumber) || a.Slug.localeCompare(b.Slug));
    searchMetadata.InvNrs.push(...records.map(r => r.InvNr));

    if (!listed) {
      checkPrefixCollisions(records.map(r => r.Slug), group.ordner);

      // an image in the folder that no work claims is a work missing from the data
      const claimed = new Set(records.flatMap(r => imagesFor(group.ordner, r.Slug)));
      const orphans = listing(group.ordner).filter(f => !claimed.has(f));
      if (orphans.length) {
        problems.push(`${group.ordner}: ${orphans.length} image(s) match no work, ` +
                      `e.g. ${orphans.slice(0, 3).join(", ")}`);
      }
    }

    const cover = listed ? group.cover : group.bild;
    if (!cover) problems.push(`no cover image for Werkgruppe ${group.slug}`);
    const titelbild = !cover ? PLACEHOLDER
      : listed ? webBild(cover, group.slug) ?? PLACEHOLDER
      : localBild(cover, "_covers", group.slug, 1);

    const werkgruppe = {
      Titel: group.titel,
      Slug: group.slug,
      Thumbnail: "/placeholder.png",   // set once the images exist
      Titelbild: titelbild,
      Count: records.length,
      Records: records,
      Reihenfolge: group.reihenfolge,
      Kurztitel: group.kurztitel,
    };
    werkgruppen.push(werkgruppe);
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
    console.error(`\n${problems.length} problem(s) in the source data:`);
    for (const p of problems.slice(0, 40)) console.error(`  ! ${p}`);
    if (process.env.STRICT === "1") process.exit(1);
  }

  const started = Date.now();
  await pool(IMAGE_CONCURRENCY, imageJobs);
  console.log(`${imageJobs.length} images in ${Math.round((Date.now() - started) / 1000)} s`);

  const thumbnail = (b: Bild) => b.video ? "/placeholder.png" : b.klein ?? b.src;
  for (const w of werkgruppen) {
    w.Thumbnail = thumbnail(w.Titelbild);
    for (const r of w.Records) r.Thumbnail = thumbnail(r.Bilder[0]);
  }

  // public/images is restored from the CI cache, so the images of a removed work
  // would otherwise stay published. (In gcs mode nothing in it is used at all.)
  const used = new Set(werkgruppen.flatMap(w => [w.Titelbild, ...w.Records.flatMap(r => r.Bilder)])
    .map(b => b.src).filter(src => src.startsWith("/images/")).map(src => path.basename(src)));
  for (const f of fs.readdirSync(IMAGES)) {
    if (!used.has(f)) fs.rmSync(path.join(IMAGES, f));
  }
  const searchData = werkgruppen.flatMap(w => w.Records.map((r: any) => ({
    InvNr: r.InvNr, Beschreibung: r.Beschreibung, Jahr: r.Jahr,
    Jahre: expandYears(r.Jahr), Slug: r.Slug, Titel: r.Titel,
    Werkgruppe: r.Werkgruppe, WerkgruppeSlug: r.WerkgruppeSlug, Thumbnail: r.Thumbnail,
  })));

  fs.writeFileSync(`${PUBLIC}/werkgruppen.json`, JSON.stringify(werkgruppen));
  fs.writeFileSync(`${PUBLIC}/searchData.json`, JSON.stringify(searchData));
  fs.writeFileSync(`${PUBLIC}/searchMetadata.json`, JSON.stringify(searchMetadata));

  fs.writeFileSync(`${PUBLIC}/pages.json`, JSON.stringify(pages));
  fs.writeFileSync(`${PUBLIC}/robots.txt`,
    `User-agent: *\nAllow: /\n\nSitemap: ${process.env.SITE}/sitemap-index.xml\n`);
}

await build();
