import { useEffect, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import {
  collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, setDoc, updateDoc, where,
} from "firebase/firestore";
import { slugify } from "../werkverzeichnis/slugify";
import { auth, db } from "./firebaseClient.js";

/**
 * Firestore test (FIRESTORE.md): the multi-tenant admin page. Super-admins
 * create artists and name their admins; artist admins edit settings, editors
 * and Werkgruppen. firestore.rules enforces all of it — this page only hides
 * what you couldn't do anyway.
 */

const SETTINGS = [
  ["titel", "Name"],
  ["websiteTitel", "Titel der Website"],
  ["titelZeile1", "Titel mobil, Zeile 1"],
  ["titelZeile2", "Titel mobil, Zeile 2"],
  ["copyright", "Copyright"],
];
const EMPTY = { titel: "", websiteTitel: "", titelZeile1: "", titelZeile2: "", copyright: "",
  editors: [], admins: [], active: true };

/** Same pattern as the rules: the id becomes ARTIST_ID and a Pages project name. */
const toId = (s, max) => slugify(s, { lower: true }).replace(/[^a-z0-9-]/g, "").slice(0, max);
const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const button = "px-3 py-1 border rounded disabled:opacity-40";
const permission = e => e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message;

export default function AdminApp() {
  const [user, setUser] = useState(undefined);  // undefined = still checking
  const [isSuper, setIsSuper] = useState(false);
  const [artists, setArtists] = useState();
  const [open, setOpen] = useState();           // artist id, or "" for a new one
  const [error, setError] = useState();

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  async function load(u = user) {
    setError(undefined);
    try {
      const sup = (await getDoc(doc(db, "admins", u.email))).exists();
      setIsSuper(sup);
      const artistsRef = collection(db, "artists");
      const snap = await getDocs(sup ? artistsRef
        : query(artistsRef, where("admins", "array-contains", u.email)));
      setArtists(snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => a.titel.localeCompare(b.titel)));
    } catch (e) {
      setError(permission(e));
    }
  }

  useEffect(() => { if (user) load(user); }, [user]);

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
        Angemeldet als {user.email}{isSuper && " (Super-Admin)"} ·{" "}
        <button className="underline" onClick={() => signOut(auth)}>Abmelden</button>
      </p>
      {error && <p className="text-red-700">{error}</p>}

      {open === undefined ? (
        <>
          {artists && !artists.length && (
            <p>Kein Zugriff: {user.email} ist für keine Künstler:in als Admin eingetragen.</p>
          )}
          <ul className="divide-y">
            {(artists ?? []).map(a => (
              <li key={a.id}>
                <button className="w-full text-left py-2 hover:bg-gray-100" onClick={() => setOpen(a.id)}>
                  {a.titel} <span className="font-mono text-sm text-gray-600">{a.id}</span>
                  {!a.active && <span className="text-sm text-gray-600"> · inaktiv</span>}
                  <span className="text-sm text-gray-600"> · {a.editors.length} Bearbeiter:innen</span>
                </button>
              </li>
            ))}
          </ul>
          {isSuper && <button className={button} onClick={() => setOpen("")}>Neue Künstler:in</button>}
        </>
      ) : (
        <Artist id={open} isSuper={isSuper}
                initial={artists.find(a => a.id === open)}
                onClose={() => { setOpen(undefined); load(); }} />
      )}
    </div>
  );
}

function Artist({ id, isSuper, initial, onClose }) {
  const isNew = id === "";
  const [draft, setDraft] = useState(() => {
    const { id: _, updatedAt, ...data } = initial ?? EMPTY;
    return { ...EMPTY, ...data };
  });
  const [newId, setNewId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState();
  const [notice, setNotice] = useState();

  const set = (k, v) => {
    setDraft(d => ({ ...d, [k]: v }));
    if (isNew && k === "titel" && !idTouched) setNewId(toId(v, 40));
  };

  async function save() {
    setSaving(true); setError(undefined); setNotice(undefined);
    const data = { ...draft, updatedAt: serverTimestamp() };
    try {
      if (isNew) {
        if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(newId)) throw new Error("Kennung: 2–40 Zeichen, a–z, 0–9 und -.");
        const ref = doc(db, "artists", newId);
        await runTransaction(db, async tx => {
          if ((await tx.get(ref)).exists()) throw new Error(`„${newId}“ gibt es schon.`);
          tx.set(ref, data);
        });
        onClose();
      } else {
        await setDoc(doc(db, "artists", id), data);
        setNotice("Gespeichert.");
      }
    } catch (e) {
      setError(permission(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      <button className="underline text-sm" onClick={onClose}>← Zurück zur Liste</button>
      <h2 className="text-xl">{isNew ? "Neue Künstler:in" : draft.titel}</h2>

      {SETTINGS.map(([k, label]) => (
        <label key={k} className="block">
          <span className="text-sm text-gray-600">{label}</span>
          <input className="border p-1 w-full" value={draft[k]} onChange={e => set(k, e.target.value)} />
        </label>
      ))}
      <label className="block">
        <span className="text-sm text-gray-600">Kennung (ARTIST_ID, nicht änderbar)</span>
        <input className="border p-1 w-full font-mono disabled:bg-gray-100" disabled={!isNew}
               value={isNew ? newId : id}
               onChange={e => { setIdTouched(true); setNewId(e.target.value); }} />
      </label>
      <label className="flex gap-2 items-center">
        <input type="checkbox" checked={draft.active} onChange={e => set("active", e.target.checked)} />
        <span>Aktiv (Website wird gebaut)</span>
      </label>

      <Emails label="Admins (Einstellungen, Bearbeiter:innen, Werkgruppen)"
              list={draft.admins} onChange={v => set("admins", v)} readOnly={!isSuper} />
      <Emails label="Bearbeiter:innen (Werke bearbeiten)"
              list={draft.editors} onChange={v => set("editors", v)} />

      <div className="flex gap-2 items-center">
        <button className={button} disabled={saving || !draft.titel.trim()} onClick={save}>
          {saving ? "Speichere…" : isNew ? "Anlegen" : "Speichern"}
        </button>
        {notice && <span className="text-green-700 text-sm">{notice}</span>}
        {error && <span className="text-red-700 text-sm">{error}</span>}
      </div>

      {!isNew && <Werkgruppen artistId={id} />}
    </div>
  );
}

function Emails({ label, list, onChange, readOnly }) {
  const [input, setInput] = useState("");
  const email = input.trim().toLowerCase();
  const valid = isEmail(email) && !list.includes(email);
  const add = () => { if (valid) { onChange([...list, email]); setInput(""); } };

  return (
    <div>
      <span className="text-sm text-gray-600">{label}</span>
      <ul className="text-sm">
        {list.map(e => (
          <li key={e}>
            {e}{" "}
            {!readOnly && (
              <button className="text-red-700" title="Entfernen"
                      onClick={() => onChange(list.filter(x => x !== e))}>×</button>
            )}
          </li>
        ))}
        {!list.length && <li className="text-gray-600">—</li>}
      </ul>
      {!readOnly && (
        <div className="flex gap-2 pt-1">
          <input className="border p-1 flex-1" placeholder="name@gmail.com" value={input}
                 onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} />
          <button className={button} disabled={!valid} onClick={add}>Hinzufügen</button>
        </div>
      )}
    </div>
  );
}

function Werkgruppen({ artistId }) {
  const [groups, setGroups] = useState();
  const [titel, setTitel] = useState("");
  const [error, setError] = useState();
  const col = collection(db, "artists", artistId, "werkgruppen");

  async function load() {
    const snap = await getDocs(col);
    setGroups(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.reihenfolge - b.reihenfolge));
  }
  useEffect(() => { load().catch(e => setError(permission(e))); }, [artistId]);

  async function add() {
    setError(undefined);
    const id = toId(titel, 60);
    const ref = doc(col, id);
    const reihenfolge = Math.max(0, ...groups.map(g => g.reihenfolge)) + 1;
    try {
      await runTransaction(db, async tx => {
        if ((await tx.get(ref)).exists()) throw new Error(`„${id}“ gibt es schon.`);
        tx.set(ref, { titel: titel.trim(), kurztitel: null, reihenfolge });
      });
      setTitel("");
      await load();
    } catch (e) {
      setError(permission(e));
    }
  }

  async function update(g, changes) {
    setError(undefined);
    try {
      await updateDoc(doc(col, g.id), changes);
      await load();
    } catch (e) {
      setError(permission(e));
    }
  }

  return (
    <div className="pt-4 space-y-2">
      <h3 className="text-lg">Werkgruppen</h3>
      {error && <p className="text-red-700 text-sm">{error}</p>}
      <table className="text-sm w-full">
        <thead>
          <tr className="text-left text-gray-600">
            <th className="w-16">Reihe</th><th>Titel</th><th>Kurztitel</th><th>Kennung</th>
          </tr>
        </thead>
        <tbody>
          {(groups ?? []).map(g => (
            <tr key={g.id}>
              <td>
                <input type="number" className="border p-1 w-14" defaultValue={g.reihenfolge}
                       onBlur={e => Number(e.target.value) !== g.reihenfolge
                         && update(g, { reihenfolge: Math.trunc(Number(e.target.value)) })} />
              </td>
              <td>
                <input className="border p-1 w-full" defaultValue={g.titel}
                       onBlur={e => e.target.value.trim() && e.target.value !== g.titel
                         && update(g, { titel: e.target.value.trim() })} />
              </td>
              <td>
                <input className="border p-1 w-full" defaultValue={g.kurztitel ?? ""}
                       onBlur={e => e.target.value !== (g.kurztitel ?? "")
                         && update(g, { kurztitel: e.target.value.trim() || null })} />
              </td>
              <td className="font-mono text-gray-600">{g.id}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-gray-600">Änderungen werden beim Verlassen des Feldes gespeichert.</p>
      <div className="flex gap-2">
        <input className="border p-1 flex-1" placeholder="Neue Werkgruppe" value={titel}
               onChange={e => setTitel(e.target.value)} />
        <button className={button} disabled={!groups || !toId(titel, 60)} onClick={add}>Hinzufügen</button>
      </div>
    </div>
  );
}
