import { lazy, Suspense, useEffect, useState } from "react";
import { collection, deleteDoc, doc, getDoc, getDocs, runTransaction, serverTimestamp } from "firebase/firestore";
import { slugify } from "../werkverzeichnis/slugify";
import { db } from "./firebaseClient.js";

// The editor is large; load it only once a page is opened.
const MarkdownEditor = lazy(() => import("./MarkdownEditor.jsx"));

/**
 * Content pages (Einführung, Impressum, …) of one artist: a list, and a form
 * with the Markdown editor. firestore.rules enforces the `seiten.edit` permission.
 */
const KATEGORIEN = { Header: "Kopfzeile", Footer: "Fußzeile" };
const button = "px-3 py-1 border rounded disabled:opacity-40";
const toId = s => slugify(s, { lower: true }).replace(/[^a-z0-9-]/g, "").slice(0, 60);
const message = e => e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message;
const order = (a, b) => a.kategorie.localeCompare(b.kategorie) * -1 || a.reihenfolge - b.reihenfolge;

export default function Seiten({ artistId, editable }) {
  const col = collection(db, "artists", artistId, "seiten");
  const [pages, setPages] = useState();
  const [open, setOpen] = useState();   // a page, or { id: "" } for a new one
  const [error, setError] = useState();

  async function load() {
    const snap = await getDocs(col);
    setPages(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort(order));
  }
  useEffect(() => { load().catch(e => setError(message(e))); }, [artistId]);

  if (open) return (
    <Seite col={col} page={open} editable={editable} pages={pages}
           onClose={() => { setOpen(undefined); load(); }} />
  );

  return (
    <div className="pt-4 space-y-2">
      <h3 className="text-lg">Seiten</h3>
      {error && <p className="text-red-700 text-sm">{error}</p>}
      <ul className="divide-y text-sm">
        {(pages ?? []).map(p => (
          <li key={p.id}>
            <button className="w-full text-left py-1 hover:bg-gray-100" onClick={() => setOpen(p)}>
              {p.titel}
              <span className="text-gray-600"> · {KATEGORIEN[p.kategorie]} {p.reihenfolge}</span>
            </button>
          </li>
        ))}
      </ul>
      {editable && <button className={button} onClick={() => setOpen({ id: "" })}>Neue Seite</button>}
    </div>
  );
}

function Seite({ col, page, editable, pages, onClose }) {
  const isNew = page.id === "";
  const [draft, setDraft] = useState(() => isNew
    ? { titel: "", kategorie: "Header", text: "",
        reihenfolge: Math.max(0, ...pages.filter(p => p.kategorie === "Header").map(p => p.reihenfolge)) + 1 }
    : { titel: page.titel, kategorie: page.kategorie, reihenfolge: page.reihenfolge, text: page.text });
  const [loadedAt, setLoadedAt] = useState(page.updatedAt);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState();
  const [notice, setNotice] = useState();
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const id = isNew ? toId(draft.titel) : page.id;

  async function save() {
    setSaving(true); setError(undefined); setNotice(undefined);
    const ref = doc(col, id);
    try {
      await runTransaction(db, async tx => {
        const now = await tx.get(ref);
        if (isNew && now.exists()) throw new Error(`„${id}“ gibt es schon.`);
        // Someone else saved since this form was opened.
        if (!isNew && now.data()?.updatedAt?.toMillis() !== loadedAt?.toMillis()) {
          throw new Error("Inzwischen von jemand anderem geändert. Bitte neu öffnen.");
        }
        tx.set(ref, { ...draft, reihenfolge: Math.trunc(Number(draft.reihenfolge)), updatedAt: serverTimestamp() });
      });
      if (isNew) return onClose();
      const fresh = (await getDoc(ref)).data();
      setLoadedAt(fresh.updatedAt);
      setNotice("Gespeichert.");
    } catch (e) {
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Seite „${page.titel}“ löschen?`)) return;
    try {
      await deleteDoc(doc(col, page.id));
      onClose();
    } catch (e) {
      setError(message(e));
    }
  }

  const field = "border p-1 disabled:bg-gray-100";
  return (
    <div className="pt-4 space-y-3">
      <button className="underline text-sm" onClick={onClose}>← Zurück zu den Seiten</button>
      <div className="flex gap-2 flex-wrap items-end">
        <label className="flex-1 min-w-[12rem]">
          <span className="block text-sm text-gray-600">Titel</span>
          <input className={field + " w-full"} value={draft.titel} disabled={!editable}
                 onChange={e => set("titel", e.target.value)} />
        </label>
        <label>
          <span className="block text-sm text-gray-600">Ort</span>
          <select className={field} value={draft.kategorie} disabled={!editable}
                  onChange={e => set("kategorie", e.target.value)}>
            {Object.entries(KATEGORIEN).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label>
          <span className="block text-sm text-gray-600">Reihe</span>
          <input type="number" className={field + " w-16"} value={draft.reihenfolge} disabled={!editable}
                 onChange={e => set("reihenfolge", e.target.value)} />
        </label>
      </div>
      {isNew && <p className="text-xs text-gray-600 font-mono">/allgemein/{id || "…"}</p>}

      <Suspense fallback={<p className="text-sm text-gray-600">Editor wird geladen…</p>}>
        <MarkdownEditor key={page.id} markdown={draft.text} readOnly={!editable}
                        onChange={text => set("text", text)} />
      </Suspense>

      {editable && (
        <div className="flex gap-2 items-center">
          <button className={button} disabled={saving || !draft.titel.trim() || !id} onClick={save}>
            {saving ? "Speichere…" : isNew ? "Anlegen" : "Speichern"}
          </button>
          {!isNew && <button className={button + " text-red-700"} onClick={remove}>Löschen</button>}
          {notice && <span className="text-green-700 text-sm">{notice}</span>}
          {error && <span className="text-red-700 text-sm">{error}</span>}
        </div>
      )}
    </div>
  );
}
