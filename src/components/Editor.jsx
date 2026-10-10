import { useEffect, useMemo, useState } from "react";
import { slugify } from "../werkverzeichnis/slugify";
import { invNrProblem } from "../werkverzeichnis/validate";
import {
  DRIVE_SCOPE, clearToken, loadToken, saveProfile, saveToken,
} from "./editorAuth.js";

/**
 * POC: edit works and add new ones straight in the Sheet and Drive, as the signed-in
 * editor. See POC-EDITOR.md.
 *
 * Google enforces access: a token only reads or writes what the editor's own account
 * may. Nothing here is a secret — the client ID and IDs are public by design.
 */

const CLIENT_ID = import.meta.env.PUBLIC_OAUTH_CLIENT_ID;
const SHEET_ID = import.meta.env.PUBLIC_SHEET_ID;
const FOLDER_ID = import.meta.env.PUBLIC_DRIVE_FOLDER_ID;
const SCOPES = `openid email profile https://www.googleapis.com/auth/spreadsheets ${DRIVE_SCOPE}`;
const SHEETS = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const LONG = ["Beschreibung", "Ausstellung", "Literatur", "Bibliographie"];
// What the build can decode — the same list as Form.gs. No .pdf.
const ALLOWED_EXT = ["webp", "jpg", "jpeg", "png", "gif", "tif", "tiff", "webm", "mp4"];

/** A tab name as an A1 range, quoted, so names with spaces or umlauts work. */
const a1 = (tab, cells = "") => `'${tab.replace(/'/g, "''")}'${cells ? "!" + cells : ""}`;
const range = (tab, cells) => encodeURIComponent(a1(tab, cells));

/** A string inside a Drive query. */
const q = (s) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

/** 0 -> A, 25 -> Z, 26 -> AA. */
function column(i) {
  let s = "";
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
  return s;
}

function extensionOf(name) {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m && ALLOWED_EXT.includes(m[1]) ? m[1] : null;
}

const pad = (n) => String(n).padStart(2, "0");

function loadGis() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Google-Anmeldung konnte nicht geladen werden."));
    document.head.appendChild(s);
  });
}

export default function Editor() {
  if (!CLIENT_ID || !SHEET_ID || !FOLDER_ID) {
    return <p className="text-red-700">
      PUBLIC_OAUTH_CLIENT_ID, PUBLIC_SHEET_ID und PUBLIC_DRIVE_FOLDER_ID müssen in .env stehen.
    </p>;
  }
  return <SignedInEditor />;
}

function SignedInEditor() {
  const stored = loadToken();
  const [token, setToken] = useState(stored?.access_token);
  const [scope, setScope] = useState(stored?.scope ?? "");
  const [email, setEmail] = useState();
  const [state, setState] = useState("signedOut"); // signedOut | checking | denied | ready
  const [error, setError] = useState();
  const [tokenClient, setTokenClient] = useState();

  const [groups, setGroups] = useState([]);    // [{Tab, Titel, Slug}]
  const [tab, setTab] = useState();
  const [sheet, setSheet] = useState();        // {header, height, rows: [{line, values}]}
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("list");    // list | edit | new
  const [work, setWork] = useState();          // the row being edited, as loaded
  const [draft, setDraft] = useState({});
  const [files, setFiles] = useState([]);      // new work's images, in upload order
  const [progress, setProgress] = useState();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState();

  const canUpload = scope.split(" ").includes(DRIVE_SCOPE);

  useEffect(() => {
    loadGis().then(() => {
      setTokenClient(window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (res) => {
          if (res.error) { setError(res.error_description || res.error); return; }
          saveToken(res);
          setScope(res.scope);
          setToken(res.access_token);
        },
      }));
    }).catch(e => setError(e.message));
  }, []);

  function signIn(options) {
    setError(undefined);
    tokenClient.requestAccessToken(options);
  }

  function expired() {
    clearToken();
    setToken(undefined);
    setState("signedOut");
    return new Error("Anmeldung abgelaufen, bitte neu anmelden.");
  }

  async function api(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (res.status === 401) throw expired();
    const body = await res.json();
    if (!res.ok) {
      const e = new Error(body.error?.message || `HTTP ${res.status}`);
      e.status = res.status;
      throw e;
    }
    return body;
  }

  async function readTab(name) {
    const { values = [] } = await api(`${SHEETS}/values/${range(name)}`);
    const header = values[0] || [];
    const rows = [];
    for (let i = 1; i < values.length; i++) {
      const v = values[i];
      if (!v.some(x => String(x).trim())) continue;
      rows.push({ line: i + 1, values: Object.fromEntries(header.map((h, c) => [h, v[c] ?? ""])) });
    }
    // `height` is the last row holding anything — values.get stops there.
    return { header, height: values.length, rows };
  }

  // After sign-in: who is this, and can they read the Sheet at all?
  useEffect(() => {
    if (!token) return;
    setState("checking");
    (async () => {
      try {
        const me = await api("https://www.googleapis.com/oauth2/v3/userinfo");
        setEmail(me.email);
        saveProfile(me);
        const overview = await readTab("_Übersicht");
        const gs = overview.rows.map(r => r.values).filter(g => g.Tab)
          .sort((a, b) => Number(a.Reihenfolge) - Number(b.Reihenfolge));
        setGroups(gs);
        setState("ready");

        const p = new URLSearchParams(location.search);
        const g = gs.find(g => g.Slug === p.get("gruppe"));
        if (g) setTab(g.Tab);
      } catch (e) {
        if (e.status === 403 || e.status === 404) setState("denied");
        else setError(e.message);
      }
    })();
  }, [token]);

  useEffect(() => {
    if (!tab) return;
    setSheet(undefined); setMode("list"); setNotice(undefined);
    readTab(tab).then(s => {
      setSheet(s);
      // ?werk= is the Inv. Nr. — exact match only, no guessing.
      const inv = new URLSearchParams(location.search).get("werk");
      const hit = inv && s.rows.find(r => r.values["Inv. Nr."] === inv);
      if (hit) openWork(hit);
    }).catch(e => setError(e.message));
  }, [tab]);

  function openWork(row) {
    setWork(row);
    setDraft({ ...row.values });
    setNotice(undefined); setError(undefined);
    setMode("edit");
  }

  function newWork() {
    // Prefill Werkgruppe with what the tab's rows mostly say, since it repeats per row.
    const counts = {};
    for (const r of sheet.rows) {
      const w = r.values.Werkgruppe;
      if (w) counts[w] = (counts[w] || 0) + 1;
    }
    const common = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    setWork(undefined);
    setDraft(Object.fromEntries(sheet.header.map(h => [h, h === "Werkgruppe" ? common : ""])));
    setFiles([]);
    setNotice(undefined); setError(undefined);
    setMode("new");
  }

  const changed = useMemo(() =>
    mode === "edit" ? sheet.header.filter(h => (draft[h] ?? "") !== (work.values[h] ?? "")) : [],
    [draft, work, sheet, mode]);

  const matches = useMemo(() => {
    if (!sheet) return [];
    const needle = query.trim().toLowerCase();
    return sheet.rows.filter(r => !needle ||
      String(r.values["Inv. Nr."]).toLowerCase().includes(needle) ||
      String(r.values.Titel ?? "").toLowerCase().includes(needle)).slice(0, 50);
  }, [sheet, query]);

  async function save() {
    setSaving(true); setError(undefined); setNotice(undefined);
    try {
      // No LockService in a browser. Re-read the row and refuse if it moved or
      // changed since the form loaded, rather than overwrite someone else's edit.
      const last = column(sheet.header.length - 1);
      const { values = [[]] } = await api(
        `${SHEETS}/values/${range(tab, `A${work.line}:${last}${work.line}`)}`);
      const now = Object.fromEntries(sheet.header.map((h, c) => [h, values[0]?.[c] ?? ""]));
      const moved = sheet.header.filter(h => now[h] !== (work.values[h] ?? ""));
      if (moved.length) {
        throw new Error(`Zeile ${work.line} wurde inzwischen geändert (${moved.join(", ")}). ` +
                        `Bitte neu laden.`);
      }

      // Only the changed cells, and RAW so "G0001" stays text.
      await api(`${SHEETS}/values:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({
          valueInputOption: "RAW",
          data: changed.map(h => ({
            range: a1(tab, `${column(sheet.header.indexOf(h))}${work.line}`),
            values: [[draft[h]]],
          })),
        }),
      });

      const saved = { ...work, values: { ...draft } };
      setSheet(s => ({ ...s, rows: s.rows.map(r => r.line === work.line ? saved : r) }));
      setWork(saved);
      setNotice(`Gespeichert (${changed.join(", ")}). Erscheint nach dem nächsten Build.`);
    } catch (e) {
      setError(e.status === 403 ? "Keine Schreibrechte für diese Tabelle." : e.message);
    } finally {
      setSaving(false);
    }
  }

  /** The Werkgruppe's image folder: a subfolder of the root, named like the tab. */
  async function subfolder() {
    const query = `${q(FOLDER_ID)} in parents and name = ${q(tab)} and ` +
      `mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const { files } = await api(`${DRIVE}?${new URLSearchParams({
      q: query, fields: "files(id,name)",
      supportsAllDrives: "true", includeItemsFromAllDrives: "true",
    })}`);
    if (!files.length) throw new Error(`Drive-Unterordner "${tab}" fehlt.`);
    return files[0].id;
  }

  /** Files already named <slug>-…, e.g. left behind by an earlier failed attempt. */
  async function existingImages(folderId, slug) {
    const { files } = await api(`${DRIVE}?${new URLSearchParams({
      q: `${q(folderId)} in parents and name contains ${q(slug)} and trashed = false`,
      fields: "files(name)", pageSize: "100",
      supportsAllDrives: "true", includeItemsFromAllDrives: "true",
    })}`);
    return files.map(f => f.name).filter(n => n.startsWith(slug + "-"));
  }

  /**
   * Resumable upload: one request for a session URL, then the bytes. Resumable
   * because raw files can be ~100 MB; XHR for the PUT because fetch reports no
   * upload progress.
   */
  async function upload(file, name, folderId, onProgress) {
    const init = await fetch(`${UPLOAD}?uploadType=resumable&supportsAllDrives=true`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": file.type || "application/octet-stream",
        "X-Upload-Content-Length": String(file.size),
      },
      body: JSON.stringify({ name, parents: [folderId] }),
    });
    if (init.status === 401) throw expired();
    if (!init.ok) {
      const body = await init.json().catch(() => ({}));
      throw new Error(`Upload von ${file.name}: ${body.error?.message || init.status}`);
    }
    const session = init.headers.get("Location");
    if (!session) throw new Error("Upload-Adresse nicht lesbar.");

    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", session);
      xhr.upload.onprogress = e => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => xhr.status < 300 ? resolve()
        : reject(new Error(`Upload von ${file.name}: HTTP ${xhr.status}`));
      xhr.onerror = () => reject(new Error(`Upload von ${file.name} abgebrochen.`));
      xhr.send(file);
    });
  }

  /**
   * The same order as addWork() in Form.gs: validate against a fresh read, upload,
   * then write the row. A failed upload leaves no row; a failed row write leaves
   * images the build reports as orphans.
   */
  async function create() {
    setSaving(true); setError(undefined); setNotice(undefined);
    const uploaded = [];
    try {
      const inv = (draft["Inv. Nr."] || "").trim();
      if (!inv) throw new Error("Inv. Nr. fehlt.");
      const fresh = await readTab(tab);
      const problem = invNrProblem(inv, fresh.rows.map(r => r.values["Inv. Nr."]));
      if (problem) throw new Error(problem);

      const slug = slugify(inv, { lower: true });
      for (const f of files) {
        if (!extensionOf(f.name)) throw new Error(`Dateityp nicht unterstützt: "${f.name}"`);
      }

      if (files.length) {
        if (!canUpload) throw new Error("Für Bilder fehlt der Drive-Zugriff.");
        const folderId = await subfolder();
        const clash = await existingImages(folderId, slug);
        if (clash.length) {
          throw new Error(`Im Ordner liegen schon Bilder für "${slug}": ${clash.join(", ")}`);
        }
        for (let i = 0; i < files.length; i++) {
          const name = `${slug}-${pad(i + 1)}.${extensionOf(files[i].name)}`;
          await upload(files[i], name, folderId,
            p => setProgress(`${name}: ${Math.round(p * 100)} %`));
          uploaded.push(name);
        }
        setProgress(undefined);
      }

      // Append after the last row holding anything. INSERT_ROWS grows the grid
      // when the tab is full, where a plain update past the end would fail.
      const last = column(fresh.header.length - 1);
      const res = await api(
        `${SHEETS}/values/${range(tab, `A${fresh.height}:${last}${fresh.height}`)}:append?` +
        new URLSearchParams({ valueInputOption: "RAW", insertDataOption: "INSERT_ROWS" }), {
          method: "POST",
          body: JSON.stringify({ values: [fresh.header.map(h => draft[h] ?? "")] }),
        });

      const gruppe = groups.find(g => g.Tab === tab)?.Slug ?? tab;
      setSheet(await readTab(tab));
      setMode("list");
      setNotice(`„${inv}" angelegt (${res.updates?.updatedRange ?? "neue Zeile"}` +
        `${uploaded.length ? `, ${uploaded.length} Bild(er)` : ""}). ` +
        `Nach dem nächsten Build unter /${gruppe}/${slug}/.`);
    } catch (e) {
      setProgress(undefined);
      const done = uploaded.length ? ` Schon hochgeladen: ${uploaded.join(", ")}.` : "";
      setError((e.status === 403 ? "Keine Schreibrechte." : e.message) + done);
    } finally {
      setSaving(false);
    }
  }

  function moveFile(i, by) {
    const next = [...files];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    setFiles(next);
  }

  function signOut() {
    if (token) window.google.accounts.oauth2.revoke(token, () => {});
    clearToken();
    setToken(undefined); setEmail(undefined); setScope(""); setState("signedOut");
    setTab(undefined); setSheet(undefined); setMode("list");
  }

  const button = "px-3 py-1 border rounded disabled:opacity-40";
  const slug = draft["Inv. Nr."]?.trim() ? slugify(draft["Inv. Nr."].trim(), { lower: true }) : "";

  const fields = sheet && sheet.header.filter(h => h).map(h => (
    <label key={h} className="block">
      <span className="text-sm text-gray-600">{h}</span>
      {h === "Inv. Nr." && mode === "edit" ? (
        <input className="border p-1 w-full bg-gray-100" value={draft[h]} readOnly />
      ) : LONG.includes(h) || String(draft[h] ?? "").length > 80 ? (
        <textarea className="border p-1 w-full" rows={4} value={draft[h] ?? ""}
                  onChange={e => setDraft({ ...draft, [h]: e.target.value })} />
      ) : (
        <input className="border p-1 w-full" value={draft[h] ?? ""}
               onChange={e => setDraft({ ...draft, [h]: e.target.value })} />
      )}
    </label>
  ));

  return (
    <div className="space-y-4">
      {error && <p className="text-red-700">{error}</p>}

      {state === "signedOut" && (
        <button className={button} disabled={!tokenClient} onClick={() => signIn()}>
          Mit Google anmelden
        </button>
      )}

      {state === "checking" && <p>Zugriff wird geprüft…</p>}

      {state === "denied" && (
        <div className="space-y-2">
          <p>Kein Zugriff mit {email}.</p>
          <button className={button} onClick={() => signIn({ prompt: "select_account" })}>
            Anderes Konto
          </button>
        </div>
      )}

      {state === "ready" && (
        <>
          <p className="text-sm">
            Angemeldet als {email} · <button className="underline" onClick={signOut}>Abmelden</button>
          </p>

          <select className="border p-1 w-full" value={tab ?? ""}
                  onChange={e => setTab(e.target.value || undefined)}>
            <option value="">Werkgruppe wählen…</option>
            {groups.map(g => <option key={g.Tab} value={g.Tab}>{g.Titel || g.Tab}</option>)}
          </select>

          {tab && !sheet && <p>Lade {tab}…</p>}

          {sheet && mode === "list" && (
            <>
              {notice && <p className="text-green-700">{notice}</p>}
              <div className="flex gap-2">
                <input className="border p-1 flex-1" placeholder="Inv. Nr. oder Titel"
                       value={query} onChange={e => setQuery(e.target.value)} />
                <button className={button} onClick={newWork}>Neues Werk</button>
              </div>
              <ul className="divide-y">
                {matches.map(r => (
                  <li key={r.line}>
                    <button className="w-full text-left py-1 hover:bg-gray-100" onClick={() => openWork(r)}>
                      <span className="font-mono">{r.values["Inv. Nr."]}</span> {r.values.Titel}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {sheet && mode === "edit" && (
            <div className="space-y-3">
              <button className="underline text-sm" onClick={() => setMode("list")}>← Zurück zur Liste</button>
              {fields}
              <div className="flex gap-2 items-center">
                <button className={button} disabled={!changed.length || saving} onClick={save}>
                  {saving ? "Speichere…" : "Speichern"}
                </button>
                <button className={button} disabled={!changed.length || saving}
                        onClick={() => setDraft({ ...work.values })}>
                  Verwerfen
                </button>
                {notice && <span className="text-green-700 text-sm">{notice}</span>}
              </div>
            </div>
          )}

          {sheet && mode === "new" && (
            <div className="space-y-3">
              <button className="underline text-sm" onClick={() => setMode("list")}>← Zurück zur Liste</button>
              <h2 className="text-xl">Neues Werk in {tab}</h2>
              {fields}

              <div className="space-y-2">
                <span className="text-sm text-gray-600">Bilder</span>
                {canUpload ? (
                  <input type="file" multiple
                         accept={ALLOWED_EXT.map(e => "." + e).join(",")}
                         onChange={e => setFiles([...files, ...e.target.files])} />
                ) : (
                  <p className="text-sm">
                    Zum Hochladen braucht der Editor Zugriff auf Google Drive.{" "}
                    <button className="underline" onClick={() => signIn({ prompt: "consent" })}>
                      Zugriff erteilen
                    </button>
                  </p>
                )}
                <ol className="text-sm">
                  {files.map((f, i) => (
                    <li key={i} className="flex gap-2 items-center">
                      <span className="font-mono">
                        {slug ? `${slug}-${pad(i + 1)}.${extensionOf(f.name) ?? "?"}` : `#${i + 1}`}
                      </span>
                      <span className="text-gray-600">← {f.name}</span>
                      {!extensionOf(f.name) && <span className="text-red-700">Typ nicht unterstützt</span>}
                      <button disabled={i === 0} className="disabled:opacity-30" onClick={() => moveFile(i, -1)}>↑</button>
                      <button disabled={i === files.length - 1} className="disabled:opacity-30" onClick={() => moveFile(i, 1)}>↓</button>
                      <button className="text-red-700" onClick={() => setFiles(files.filter((_, j) => j !== i))}>✕</button>
                    </li>
                  ))}
                </ol>
                {files.length > 0 && <p className="text-xs text-gray-600">Das erste Bild wird das Vorschaubild.</p>}
              </div>

              <div className="flex gap-2 items-center">
                <button className={button} disabled={!slug || saving} onClick={create}>
                  {saving ? "Lege an…" : "Anlegen"}
                </button>
                {progress && <span className="text-sm">{progress}</span>}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
