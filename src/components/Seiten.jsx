import { lazy, Suspense, useEffect, useState } from "react";
import { collection, deleteDoc, doc, getDoc, getDocs, runTransaction, serverTimestamp } from "firebase/firestore";
import { slugify } from "../werkverzeichnis/slugify";
import { db } from "./firebaseClient.js";

// Der Editor ist groß; erst laden, wenn eine Seite geöffnet wird.
const MarkdownEditor = lazy(() => import("./MarkdownEditor.jsx"));

/**
 * Die Inhaltsseiten (Einführung, Impressum, …) einer Künstler:in: eine Liste und
 * ein Formular mit dem Markdown-Editor. firestore.rules setzt die Berechtigung
 * `seiten.bearbeiten` durch.
 */
const KATEGORIEN = { Header: "Kopfzeile", Footer: "Fußzeile" };
const knopf = "px-3 py-1 border rounded disabled:opacity-40";
const zuKennung = s => slugify(s, { lower: true }).replace(/[^a-z0-9-]/g, "").slice(0, 60);
const meldung = e => e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message;
const ordnung = (a, b) => a.kategorie.localeCompare(b.kategorie) * -1 || a.reihenfolge - b.reihenfolge;

export default function Seiten({ kuenstlerId, bearbeitbar }) {
  const sammlung = collection(db, "artists", kuenstlerId, "seiten");
  const [seiten, setSeiten] = useState();
  const [offen, setOffen] = useState();   // eine Seite, oder { id: "" } für eine neue
  const [fehler, setFehler] = useState();

  async function laden() {
    const snap = await getDocs(sammlung);
    setSeiten(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort(ordnung));
  }
  useEffect(() => { laden().catch(e => setFehler(meldung(e))); }, [kuenstlerId]);

  if (offen) return (
    <Seite sammlung={sammlung} seite={offen} bearbeitbar={bearbeitbar} seiten={seiten}
           onSchliessen={() => { setOffen(undefined); laden(); }} />
  );

  return (
    <div className="pt-4 space-y-2">
      <h3 className="text-lg">Seiten</h3>
      {fehler && <p className="text-red-700 text-sm">{fehler}</p>}
      <ul className="divide-y text-sm">
        {(seiten ?? []).map(s => (
          <li key={s.id}>
            <button className="w-full text-left py-1 hover:bg-gray-100" onClick={() => setOffen(s)}>
              {s.titel}
              <span className="text-gray-600"> · {KATEGORIEN[s.kategorie]} {s.reihenfolge}</span>
            </button>
          </li>
        ))}
      </ul>
      {bearbeitbar && <button className={knopf} onClick={() => setOffen({ id: "" })}>Neue Seite</button>}
    </div>
  );
}

function Seite({ sammlung, seite, bearbeitbar, seiten, onSchliessen }) {
  const istNeu = seite.id === "";
  const [entwurf, setEntwurf] = useState(() => istNeu
    ? { titel: "", kategorie: "Header", text: "",
        reihenfolge: Math.max(0, ...seiten.filter(s => s.kategorie === "Header").map(s => s.reihenfolge)) + 1 }
    : { titel: seite.titel, kategorie: seite.kategorie, reihenfolge: seite.reihenfolge, text: seite.text });
  const [geladenAm, setGeladenAm] = useState(seite.updatedAt);
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState();
  const [hinweis, setHinweis] = useState();
  const setze = (k, v) => setEntwurf(e => ({ ...e, [k]: v }));
  const id = istNeu ? zuKennung(entwurf.titel) : seite.id;

  async function speichern() {
    setSpeichert(true); setFehler(undefined); setHinweis(undefined);
    const ref = doc(sammlung, id);
    try {
      await runTransaction(db, async tx => {
        const jetzt = await tx.get(ref);
        if (istNeu && jetzt.exists()) throw new Error(`„${id}“ gibt es schon.`);
        // Jemand anderes hat gespeichert, seit dieses Formular geöffnet wurde.
        if (!istNeu && jetzt.data()?.updatedAt?.toMillis() !== geladenAm?.toMillis()) {
          throw new Error("Inzwischen von jemand anderem geändert. Bitte neu öffnen.");
        }
        tx.set(ref, { ...entwurf, reihenfolge: Math.trunc(Number(entwurf.reihenfolge)), updatedAt: serverTimestamp() });
      });
      if (istNeu) return onSchliessen();
      const frisch = (await getDoc(ref)).data();
      setGeladenAm(frisch.updatedAt);
      setHinweis("Gespeichert.");
    } catch (e) {
      setFehler(meldung(e));
    } finally {
      setSpeichert(false);
    }
  }

  async function loeschen() {
    if (!confirm(`Seite „${seite.titel}“ löschen?`)) return;
    try {
      await deleteDoc(doc(sammlung, seite.id));
      onSchliessen();
    } catch (e) {
      setFehler(meldung(e));
    }
  }

  const feld = "border p-1 disabled:bg-gray-100";
  return (
    <div className="pt-4 space-y-3">
      <button className="underline text-sm" onClick={onSchliessen}>← Zurück zu den Seiten</button>
      <div className="flex gap-2 flex-wrap items-end">
        <label className="flex-1 min-w-[12rem]">
          <span className="block text-sm text-gray-600">Titel</span>
          <input className={feld + " w-full"} value={entwurf.titel} disabled={!bearbeitbar}
                 onChange={e => setze("titel", e.target.value)} />
        </label>
        <label>
          <span className="block text-sm text-gray-600">Ort</span>
          <select className={feld} value={entwurf.kategorie} disabled={!bearbeitbar}
                  onChange={e => setze("kategorie", e.target.value)}>
            {Object.entries(KATEGORIEN).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label>
          <span className="block text-sm text-gray-600">Reihe</span>
          <input type="number" className={feld + " w-16"} value={entwurf.reihenfolge} disabled={!bearbeitbar}
                 onChange={e => setze("reihenfolge", e.target.value)} />
        </label>
      </div>
      {istNeu && <p className="text-xs text-gray-600 font-mono">/allgemein/{id || "…"}</p>}

      <Suspense fallback={<p className="text-sm text-gray-600">Editor wird geladen…</p>}>
        <MarkdownEditor key={seite.id} markdown={entwurf.text} nurLesen={!bearbeitbar}
                        onAenderung={text => setze("text", text)} />
      </Suspense>

      {bearbeitbar && (
        <div className="flex gap-2 items-center">
          <button className={knopf} disabled={speichert || !entwurf.titel.trim() || !id} onClick={speichern}>
            {speichert ? "Speichere…" : istNeu ? "Anlegen" : "Speichern"}
          </button>
          {!istNeu && <button className={knopf + " text-red-700"} onClick={loeschen}>Löschen</button>}
          {hinweis && <span className="text-green-700 text-sm">{hinweis}</span>}
          {fehler && <span className="text-red-700 text-sm">{fehler}</span>}
        </div>
      )}
    </div>
  );
}
