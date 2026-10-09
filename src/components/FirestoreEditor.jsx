import { useEffect, useMemo, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import {
  collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where,
} from "firebase/firestore";
import { artist, auth, db } from "./firebaseClient.js";

/**
 * Firestore test (FIRESTORE.md): the /bearbeiten/ editor's edit flow against
 * Firestore instead of the Sheet. Edit only, one artist.
 *
 * Who may do what is decided by firestore.rules, not here: listed editors only,
 * Inv. Nr. fixed, and every edit must carry its history entry.
 */

// Fields the editor shows, in the Sheet's column order. Everything else on the
// document (werkgruppe, images, updatedAt, lastChange) is managed, not edited.
const FIELDS = ["InvNr", "Titel", "Werkgruppe", "Jahr", "Maße", "Material", "Technik",
  "Beschreibung", "Zustand", "Standort", "Signatur", "Auflage", "Anzahl", "Foto",
  "Ausstellung", "Literatur", "Bibliographie"];
const LONG = ["Beschreibung", "Ausstellung", "Literatur", "Bibliographie", "Material"];

export default function FirestoreEditor() {
  const [user, setUser] = useState(undefined);  // undefined = still checking
  const [error, setError] = useState();
  const [groups, setGroups] = useState();
  const [group, setGroup] = useState("");
  const [works, setWorks] = useState();
  const [queryText, setQueryText] = useState("");
  const [work, setWork] = useState();           // {id, data} as loaded
  const [draft, setDraft] = useState({});
  const [history, setHistory] = useState([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState();

  // Firebase keeps the session itself (IndexedDB), so a reload stays signed in.
  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user) return;
    setError(undefined);
    getDocs(collection(artist, "werkgruppen"))
      .then(s => setGroups(s.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(e => setError(e.code === "permission-denied"
        ? `Kein Zugriff mit ${user.email}.` : e.message));
  }, [user]);

  useEffect(() => {
    if (!group) return;
    setWorks(undefined); setWork(undefined);
    getDocs(query(collection(artist, "works"), where("werkgruppe", "==", group)))
      .then(s => setWorks(s.docs.map(d => ({ id: d.id, data: d.data() }))
        .sort((a, b) => Number(a.data.InvNr.replace(/\D/g, "")) - Number(b.data.InvNr.replace(/\D/g, "")))))
      .catch(e => setError(e.message));
  }, [group]);

  async function open(w) {
    setWork(w); setDraft({ ...w.data }); setNotice(undefined); setError(undefined);
    const h = await getDocs(query(collection(artist, "history"), where("work", "==", w.id)));
    setHistory(h.docs.map(d => d.data()).sort((a, b) => b.at?.toMillis() - a.at?.toMillis()));
  }

  const changed = useMemo(() => work
    ? FIELDS.filter(f => (draft[f] ?? "") !== (work.data[f] ?? "")) : [], [draft, work]);

  async function save() {
    setSaving(true); setError(undefined); setNotice(undefined);
    const ref = doc(artist, "works", work.id);
    const entry = doc(collection(artist, "history"));
    try {
      await runTransaction(db, async (tx) => {
        // A real lock-free conflict check: the transaction retries or fails if the
        // document changes underneath it, and updatedAt tells us someone saved
        // since this form was opened.
        const now = await tx.get(ref);
        if (now.data().updatedAt?.toMillis() !== work.data.updatedAt?.toMillis()) {
          throw new Error("Inzwischen von jemand anderem geändert. Bitte neu öffnen.");
        }
        const changes = Object.fromEntries(changed.map(f =>
          [f, { from: work.data[f] ?? null, to: draft[f] ?? null }]));
        tx.set(entry, { work: work.id, by: user.email, at: serverTimestamp(), changes });
        tx.update(ref, {
          ...Object.fromEntries(changed.map(f => [f, draft[f]])),
          updatedAt: serverTimestamp(),
          lastChange: entry.id,
        });
      });
      const fresh = await getDoc(ref);
      const w = { id: work.id, data: fresh.data() };
      setWorks(ws => ws.map(x => x.id === w.id ? w : x));
      await open(w);
      setNotice(`Gespeichert (${changed.join(", ")}).`);
    } catch (e) {
      setError(e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message);
    } finally {
      setSaving(false);
    }
  }

  const matches = (works ?? []).filter(w => {
    const q = queryText.trim().toLowerCase();
    return !q || w.data.InvNr.toLowerCase().includes(q) || (w.data.Titel ?? "").toLowerCase().includes(q);
  }).slice(0, 50);

  const button = "px-3 py-1 border rounded disabled:opacity-40";

  if (user === undefined) return <p>…</p>;

  if (!user) return (
    <div className="space-y-2">
      {error && <p className="text-red-700">{error}</p>}
      <button className={button} onClick={() =>
        signInWithPopup(auth, new GoogleAuthProvider()).catch(e => setError(e.message))}>
        Mit Google anmelden (Firebase)
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm">
        Angemeldet als {user.email} ·{" "}
        <button className="underline" onClick={() => signOut(auth)}>Abmelden</button>
      </p>
      {error && <p className="text-red-700">{error}</p>}

      {groups && (
        <select className="border p-1 w-full" value={group} onChange={e => setGroup(e.target.value)}>
          <option value="">Werkgruppe wählen…</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.titel}</option>)}
        </select>
      )}

      {works && !work && (
        <>
          <input className="border p-1 w-full" placeholder="Inv. Nr. oder Titel"
                 value={queryText} onChange={e => setQueryText(e.target.value)} />
          <ul className="divide-y">
            {matches.map(w => (
              <li key={w.id}>
                <button className="w-full text-left py-1 hover:bg-gray-100" onClick={() => open(w)}>
                  <span className="font-mono">{w.data.InvNr}</span> {w.data.Titel}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {work && (
        <div className="space-y-3">
          <button className="underline text-sm" onClick={() => setWork(undefined)}>← Zurück zur Liste</button>
          {FIELDS.map(f => (
            <label key={f} className="block">
              <span className="text-sm text-gray-600">{f}</span>
              {f === "InvNr" ? (
                <input className="border p-1 w-full bg-gray-100" value={draft[f] ?? ""} readOnly />
              ) : LONG.includes(f) || String(draft[f] ?? "").length > 80 ? (
                <textarea className="border p-1 w-full" rows={3} value={draft[f] ?? ""}
                          onChange={e => setDraft({ ...draft, [f]: e.target.value })} />
              ) : (
                <input className="border p-1 w-full" value={draft[f] ?? ""}
                       onChange={e => setDraft({ ...draft, [f]: e.target.value })} />
              )}
            </label>
          ))}
          <div className="flex gap-2 items-center">
            <button className={button} disabled={!changed.length || saving} onClick={save}>
              {saving ? "Speichere…" : "Speichern"}
            </button>
            <button className={button} disabled={!changed.length || saving}
                    onClick={() => setDraft({ ...work.data })}>Verwerfen</button>
            {notice && <span className="text-green-700 text-sm">{notice}</span>}
          </div>

          <h3 className="text-lg pt-4">Verlauf</h3>
          {history.length === 0 && <p className="text-sm text-gray-600">Noch keine Änderungen.</p>}
          <ul className="text-sm space-y-2">
            {history.map((h, i) => (
              <li key={i}>
                <span className="text-gray-600">{h.at?.toDate().toLocaleString("de-DE")} · {h.by}</span>
                {Object.entries(h.changes).map(([f, c]) => (
                  <div key={f} className="pl-3">
                    <b>{f}</b>: <s className="text-gray-500">{c.from || "∅"}</s> → {c.to || "∅"}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
