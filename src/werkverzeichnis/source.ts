/**
 * Where flat rows and image bytes come from.
 *
 * Two implementations behind one interface:
 *
 *   google   Sheets tabs and Drive folders — what the deployed build reads
 *   csv      the offline archive on disk    — development, and the diff baseline
 *
 * `sheets.ts` cannot tell them apart, so a csv run and a google run that disagree
 * mean the Sheet and the archive disagree, not that two code paths drifted.
 */
import * as fs from "fs";
import * as path from "path";
import { google } from "googleapis";

export type Row = Record<string, string>;

export interface Source {
  /** One tab, as objects keyed by its header row. */
  rows(tab: string): Promise<Row[]>;
  /** Filenames in one image folder, sorted. Only valid for a dir passed to `warm`. */
  listing(dir: string): string[];
  /** Read the folders `listing` will be asked about. Keeps the lookups synchronous. */
  warm(dirs: string[]): Promise<void>;
  /** A local path to one image's bytes, or null when the folder has no such file. */
  original(dir: string, filename: string): Promise<string | null>;
}

/** RFC4180 parser. Fields may be quoted and contain commas and newlines. */
function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter(r => r.length > 1 || r[0] !== "");
  return body.map(r => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

/** The archive produced by `tools/make_sheets_csv.py`: sheets/*.csv and originals/. */
export function csvSource(exportDir: string): Source {
  const sheets = path.join(exportDir, "sheets");
  const originals = path.join(exportDir, "originals");
  const listings = new Map<string, string[]>();

  return {
    async rows(tab) {
      return parseCsv(fs.readFileSync(path.join(sheets, tab + ".csv"), "utf8"));
    },
    listing(dir) {
      return listings.get(dir) ?? [];
    },
    async warm(dirs) {
      for (const dir of dirs) {
        const p = path.join(originals, dir);
        listings.set(dir, fs.existsSync(p) ? fs.readdirSync(p).sort() : []);
      }
    },
    async original(dir, filename) {
      const p = path.join(originals, dir, filename);
      return fs.existsSync(p) ? p : null;
    },
  };
}

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];

/**
 * Application Default Credentials, so nothing long-lived is stored anywhere:
 * `google-github-actions/auth` writes them from an OIDC exchange on GitHub Actions,
 * and `gcloud auth application-default login` supplies them locally. Hosts with
 * nowhere to put a credentials file pass the service account JSON in an env var
 * instead — that one is a real key, so it belongs in the host's secret store.
 */
function credentials() {
  const inline = process.env.GOOGLE_CREDENTIALS_JSON;
  return new google.auth.GoogleAuth(
    inline ? { credentials: JSON.parse(inline), scopes: SCOPES } : { scopes: SCOPES });
}

/**
 * The Sheet holds the rows; the Drive folder holds the images, one subfolder per
 * Werkgruppe plus `_covers`, mirroring the archive exactly.
 *
 * Downloads land in `cacheDir` and are never fetched twice. Restoring that directory
 * between runs is not an optimisation — a cold build pulls ~3,100 files and roughly
 * 810 MB, which is slow enough to matter and large enough to run into Drive's quota.
 */
export function googleSource(sheetId: string, folderId: string, cacheDir: string): Source {
  const auth = credentials();
  const sheets = google.sheets({ version: "v4", auth });
  const drive = google.drive({ version: "v3", auth });

  const listings = new Map<string, string[]>();
  const fileIds = new Map<string, string>();          // "<dir>/<filename>" -> file id

  async function children(parent: string, foldersOnly = false) {
    const out: { id: string; name: string }[] = [];
    let pageToken: string | undefined;
    do {
      const res: any = await drive.files.list({
        q: `'${parent}' in parents and trashed = false`
          + (foldersOnly ? " and mimeType = 'application/vnd.google-apps.folder'" : ""),
        fields: "nextPageToken, files(id, name)",
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      for (const f of res.data.files ?? []) {
        if (f.id && f.name) out.push({ id: f.id, name: f.name });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return out;
  }

  return {
    async rows(tab) {
      // Quoted, because tab names contain hyphens and umlauts that A1 notation
      // would otherwise read as part of the range.
      const range = `'${tab.replace(/'/g, "''")}'!A:Z`;
      let res: any;
      try {
        res = await sheets.spreadsheets.values.get({
          spreadsheetId: sheetId,
          range,
          // The displayed string, not Sheets' interpretation of it. With the
          // columns set to plain text this is what the editor typed — which is
          // the whole defence against `G0001` arriving as the number 1.
          valueRenderOption: "FORMATTED_VALUE",
        });
      } catch (e: any) {
        if (e?.code === 400) throw new Error(`tab "${tab}" is missing or misnamed`);
        throw e;
      }
      const values: string[][] = res.data.values ?? [];
      const [header, ...body] = values;
      if (!header) throw new Error(`tab "${tab}" is empty or misnamed`);
      return body
        .filter(r => r.length > 1 || (r[0] ?? "") !== "")
        .map(r => Object.fromEntries(header.map((h, i) => [h, String(r[i] ?? "")])));
    },

    listing(dir) {
      return listings.get(dir) ?? [];
    },

    async warm(dirs) {
      const folders = new Map(
        (await children(folderId, true)).map(f => [f.name, f.id] as const));
      for (const dir of dirs) {
        const id = folders.get(dir);
        if (!id) { listings.set(dir, []); continue; }
        const files = await children(id);
        for (const f of files) fileIds.set(`${dir}/${f.name}`, f.id);
        listings.set(dir, files.map(f => f.name).sort());
      }
    },

    async original(dir, filename) {
      const id = fileIds.get(`${dir}/${filename}`);
      if (!id) return null;
      const dest = path.join(cacheDir, dir, filename);
      if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const res: any = await drive.files.get(
        { fileId: id, alt: "media", supportsAllDrives: true },
        { responseType: "arraybuffer" });
      fs.writeFileSync(dest, Buffer.from(res.data as ArrayBuffer));
      return dest;
    },
  };
}
