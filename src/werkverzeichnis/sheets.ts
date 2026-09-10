/**
 * Flat rows -> build artifacts.
 *
 * The Google Sheets adapter. Rows and images arrive through `Source`, which has a
 * second implementation over the offline archive, so the risky part — flattening
 * Airtable's nested records into spreadsheet cells and resolving images by filename
 * instead of by embedded attachment object — stays provable without credentials.
 * Everything below `source` runs identically either way.
 *
 *   SHEET_ID=... DRIVE_FOLDER_ID=... yarn sheets-assets    # the Sheet
 *   ROW_SOURCE=csv EXPORT_DIR=... yarn sheets-assets       # the archive
 */
import * as fs from "fs";
import * as path from "path";
import sharp from "sharp";
import { marked } from "marked";
import { slugify } from "./slugify.js";
import { csvSource, googleSource, type Source } from "./source.js";

const PUBLIC = "./public";
const IMAGES = path.join(PUBLIC, "images");

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set to build from the Sheet`);
  return v;
}

/**
 * The Sheet when one is configured, the archive otherwise. Setting ROW_SOURCE
 * forces the choice, which is what makes an archive-vs-Sheet diff possible.
 */
function chooseSource(): Source {
  const mode = process.env.ROW_SOURCE ?? (process.env.SHEET_ID ? "google" : "csv");
  if (mode === "google") {
    return googleSource(
      required("SHEET_ID"),
      required("DRIVE_FOLDER_ID"),
      process.env.CACHE_DIR ?? ".cache/originals");
  }
  return csvSource(process.env.EXPORT_DIR ?? "../werkverzeichnis-export");
}

const source = chooseSource();

/** A spreadsheet cannot hold null, so an empty cell must read back as absent. */
const cell = (v: string | undefined) => (v && v.trim() !== "" ? v : undefined);

const isVideo = (p: string) => p.endsWith(".webm") || p.endsWith(".mp4");

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
    if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
    return `/images/${base}${ext}`;
  }
  const dest = path.join(IMAGES, `${base}.webp`);
  if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
    try { await sharp(src).webp().toFile(dest); }
    catch (e) { console.warn(`  convert failed ${filename}: ${e}`); return "/placeholder.png"; }
  }
  return `/images/${base}.webp`;
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

async function build() {
  fs.mkdirSync(IMAGES, { recursive: true });

  const groups = (await source.rows("_Übersicht"))
    .sort((a, b) => Number(a.Reihenfolge) - Number(b.Reihenfolge));

  // One folder listing per Werkgruppe, up front, so image lookup stays a map hit.
  await source.warm([...groups.map(g => g.Tab), "_covers"]);

  const werkgruppen = [];
  const searchMetadata = {
    MinYear: Number.MAX_VALUE, MaxYear: Number.MIN_VALUE,
    Werkgruppen: [] as any[], InvNrs: [] as string[],
  };

  for (const group of groups) {
    const rows = await source.rows(group.Tab);
    const records = [];
    const seen = new Set<string>();

    for (const row of rows) {
      const invNr = cell(row["Inv. Nr."]);
      if (!invNr) { problems.push(`${group.Tab}: row with no Inv. Nr.`); continue; }

      // an imported spreadsheet header row: values equal their own column names
      const headerish = Object.entries(row)
        .filter(([k, v]) => v && v.trim() === k.trim()).length;
      if (headerish >= 3) {
        problems.push(`${group.Tab}: "${invNr}" looks like an imported header row`);
        continue;
      }

      const slug = slugify(invNr, { lower: true });
      if (seen.has(slug)) problems.push(`${group.Tab}: duplicate slug "${slug}"`);
      seen.add(slug);

      // Images are found by convention: <slug>-NN.<ext> in the Werkgruppe's folder.
      // Sorting by filename is what orders them, so -01 becomes the thumbnail.
      const files = imagesFor(group.Tab, slug);
      let bilder: string[] = [];
      let i = 1;
      for (const f of files) bilder.push(await materialise(f, group.Tab, slug, i++));
      if (!bilder.length) bilder = ["/placeholder.png"];

      const year = Number(cell(row.Jahr));
      if (year) {
        searchMetadata.MinYear = Math.min(searchMetadata.MinYear, year);
        searchMetadata.MaxYear = Math.max(searchMetadata.MaxYear, year);
      }
      searchMetadata.InvNrs.push(invNr);

      records.push({
        InvNr: invNr,
        InventoryNumber: invNr.replaceAll(/[^0-9]/g, ""),
        Slug: slug,
        WerkgruppeSlug: group.Slug,
        Anzahl: cell(row.Anzahl), Werkgruppe: cell(row.Werkgruppe),
        "Maße": cell(row["Maße"]), Material: cell(row.Material),
        Beschreibung: cell(row.Beschreibung), Jahr: cell(row.Jahr),
        Zustand: cell(row.Zustand), Standort: cell(row.Standort),
        Titel: cell(row.Titel), Technik: cell(row.Technik),
        Auflage: cell(row.Auflage), Signatur: cell(row.Signatur),
        Foto: cell(row.Foto), Ausstellung: cell(row.Ausstellung),
        Literatur: cell(row.Literatur), Bibliographie: cell(row.Bibliographie),
        Bilder: bilder,
        Thumbnail: isVideo(bilder[0]) ? "/placeholder.png" : bilder[0],
      });
    }

    records.sort((a, b) => Number(a.InventoryNumber) - Number(b.InventoryNumber));

    checkPrefixCollisions(records.map(r => r.Slug), group.Tab);

    // an image in the folder that no row claims is a work missing from the sheet
    const claimed = new Set(records.flatMap(r => imagesFor(group.Tab, r.Slug)));
    const orphans = listing(group.Tab).filter(f => !claimed.has(f));
    if (orphans.length) {
      problems.push(`${group.Tab}: ${orphans.length} image(s) match no row, ` +
                    `e.g. ${orphans.slice(0, 3).join(", ")}`);
    }

    if (!cell(group.Bild)) problems.push(`Übersicht: no cover image for ${group.Slug}`);

    werkgruppen.push({
      Titel: group.Titel,
      Slug: group.Slug,
      Thumbnail: cell(group.Bild)
        ? await materialise(group.Bild, "_covers", group.Slug, 1)
        : "/placeholder.png",
      Count: rows.length,
      Records: records,
      Reihenfolge: group.Reihenfolge,
      Kurztitel: cell(group.Kurztitel),
    });
    searchMetadata.Werkgruppen.push({
      WerkgruppenSlug: group.Slug, WerkgruppenTitel: group.Titel,
    });
    console.log(`  ${group.Slug.padEnd(22)} ${records.length} works`);
  }

  const searchData = werkgruppen.flatMap(w => w.Records.map((r: any) => ({
    InvNr: r.InvNr, Beschreibung: r.Beschreibung, Jahr: r.Jahr,
    Jahre: expandYears(r.Jahr), Slug: r.Slug, Titel: r.Titel,
    Werkgruppe: r.Werkgruppe, WerkgruppeSlug: r.WerkgruppeSlug, Thumbnail: r.Thumbnail,
  })));

  fs.writeFileSync(`${PUBLIC}/werkgruppen.json`, JSON.stringify(werkgruppen));
  fs.writeFileSync(`${PUBLIC}/searchData.json`, JSON.stringify(searchData));
  fs.writeFileSync(`${PUBLIC}/searchMetadata.json`, JSON.stringify(searchMetadata));

  const pageIndex = (await source.rows("_Seiten"))
    .sort((a, b) => Number(a.Reihenfolge) - Number(b.Reihenfolge));
  const pages = [];
  for (const p of pageIndex) {
    const rows = (await source.rows(`seite_${p.Tab.replace(/\//g, "_")}`))
      .map(r => Object.fromEntries(Object.entries(r).map(
        ([k, v]) => [k, k === "Text" ? marked.parse(v) : v])) as any)
      .filter(r => r.Reihenfolge)
      .sort((a, b) => Number(a.Reihenfolge) - Number(b.Reihenfolge));
    pages.push({
      Name: p.Tab, Records: rows, Slug: slugify(p.Tab, { lower: true }),
      isTable: rows.some(r => r.Spalte1 !== undefined),
      Reihenfolge: p.Reihenfolge, Kategorie: p.Kategorie,
    });
  }
  fs.writeFileSync(`${PUBLIC}/pages.json`, JSON.stringify(pages));
  fs.writeFileSync(`${PUBLIC}/robots.txt`,
    `User-agent: *\nAllow: /\n\nSitemap: ${process.env.SITE}/sitemap-index.xml\n`);

  const works = werkgruppen.reduce((n, w) => n + w.Records.length, 0);
  console.log(`\n${werkgruppen.length} Werkgruppen, ${works} works, ${pages.length} pages`);

  if (problems.length) {
    console.error(`\n${problems.length} problem(s) in the source data:`);
    for (const p of problems.slice(0, 40)) console.error(`  ! ${p}`);
    if (process.env.STRICT === "1") process.exit(1);
  }
}

await build();
