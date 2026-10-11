import { useEffect, useMemo, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import {
  collection, doc, getDoc, getDocs, query, runTransaction, serverTimestamp, where,
} from "firebase/firestore";
import { kuenstler, auth, db } from "./firebaseClient.js";

/**
 * Der Werk-Editor (Firestore). Nur bearbeiten, eine Künstler:in.
 *
 * Wer was darf, entscheidet firestore.rules, nicht diese Datei: die Berechtigung
 * werke.bearbeiten, die Inv. Nr. bleibt, und jede Änderung muss ihren
 * Verlaufseintrag mitbringen.
 */

// Die Felder, die der Editor zeigt, in dieser Reihenfolge. Alles andere am
// Dokument (werkgruppe, images, updatedAt, lastChange) wird verwaltet, nicht bearbeitet.
const FELDER = ["InvNr", "Titel", "Werkgruppe", "Jahr", "Maße", "Material", "Technik",
  "Beschreibung", "Zustand", "Standort", "Signatur", "Auflage", "Anzahl", "Foto",
  "Ausstellung", "Literatur", "Bibliographie"];
const LANG = ["Beschreibung", "Ausstellung", "Literatur", "Bibliographie", "Material"];

export default function WerkEditor() {
  const [nutzer, setNutzer] = useState(undefined);  // undefined = wird noch geprüft
  const [fehler, setFehler] = useState();
  const [gruppen, setGruppen] = useState();
  const [gruppe, setGruppe] = useState("");
  const [werke, setWerke] = useState();
  const [suche, setSuche] = useState("");
  const [werk, setWerk] = useState();               // {id, data} wie geladen
  const [entwurf, setEntwurf] = useState({});
  const [verlauf, setVerlauf] = useState([]);
  const [speichert, setSpeichert] = useState(false);
  const [hinweis, setHinweis] = useState();

  // Firebase behält die Sitzung selbst (IndexedDB), nach dem Neuladen bleibt man angemeldet.
  useEffect(() => onAuthStateChanged(auth, setNutzer), []);

  useEffect(() => {
    if (!nutzer) return;
    setFehler(undefined);
    getDocs(collection(kuenstler, "werkgruppen"))
      .then(s => setGruppen(s.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(e => setFehler(e.code === "permission-denied"
        ? `Kein Zugriff mit ${nutzer.email}.` : e.message));
  }, [nutzer]);

  useEffect(() => {
    if (!gruppe) return;
    setWerke(undefined); setWerk(undefined);
    getDocs(query(collection(kuenstler, "works"), where("werkgruppe", "==", gruppe)))
      .then(s => setWerke(s.docs.map(d => ({ id: d.id, data: d.data() }))
        .sort((a, b) => Number(a.data.InvNr.replace(/\D/g, "")) - Number(b.data.InvNr.replace(/\D/g, "")))))
      .catch(e => setFehler(e.message));
  }, [gruppe]);

  async function oeffnen(w) {
    setWerk(w); setEntwurf({ ...w.data }); setHinweis(undefined); setFehler(undefined);
    const v = await getDocs(query(collection(kuenstler, "history"), where("work", "==", w.id)));
    setVerlauf(v.docs.map(d => d.data()).sort((a, b) => b.at?.toMillis() - a.at?.toMillis()));
  }

  const geaendert = useMemo(() => werk
    ? FELDER.filter(f => (entwurf[f] ?? "") !== (werk.data[f] ?? "")) : [], [entwurf, werk]);

  async function speichern() {
    setSpeichert(true); setFehler(undefined); setHinweis(undefined);
    const ref = doc(kuenstler, "works", werk.id);
    const eintrag = doc(collection(kuenstler, "history"));
    try {
      await runTransaction(db, async (tx) => {
        // Eine echte Konfliktprüfung ohne Sperre: Die Transaktion wiederholt sich
        // oder scheitert, wenn sich das Dokument darunter ändert, und updatedAt
        // zeigt, ob jemand gespeichert hat, seit dieses Formular geöffnet wurde.
        const jetzt = await tx.get(ref);
        if (jetzt.data().updatedAt?.toMillis() !== werk.data.updatedAt?.toMillis()) {
          throw new Error("Inzwischen von jemand anderem geändert. Bitte neu öffnen.");
        }
        const changes = Object.fromEntries(geaendert.map(f =>
          [f, { from: werk.data[f] ?? null, to: entwurf[f] ?? null }]));
        tx.set(eintrag, { work: werk.id, by: nutzer.email, at: serverTimestamp(), changes });
        tx.update(ref, {
          ...Object.fromEntries(geaendert.map(f => [f, entwurf[f]])),
          updatedAt: serverTimestamp(),
          lastChange: eintrag.id,
        });
      });
      const frisch = await getDoc(ref);
      const w = { id: werk.id, data: frisch.data() };
      setWerke(ws => ws.map(x => x.id === w.id ? w : x));
      await oeffnen(w);
      setHinweis(`Gespeichert (${geaendert.join(", ")}).`);
    } catch (e) {
      setFehler(e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message);
    } finally {
      setSpeichert(false);
    }
  }

  const treffer = (werke ?? []).filter(w => {
    const q = suche.trim().toLowerCase();
    return !q || w.data.InvNr.toLowerCase().includes(q) || (w.data.Titel ?? "").toLowerCase().includes(q);
  }).slice(0, 50);

  const knopf = "px-3 py-1 border rounded disabled:opacity-40";

  if (nutzer === undefined) return <p>…</p>;

  if (!nutzer) return (
    <div className="space-y-2">
      {fehler && <p className="text-red-700">{fehler}</p>}
      <button className={knopf} onClick={() =>
        signInWithPopup(auth, new GoogleAuthProvider()).catch(e => setFehler(e.message))}>
        Mit Google anmelden (Firebase)
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm">
        Angemeldet als {nutzer.email} ·{" "}
        <button className="underline" onClick={() => signOut(auth)}>Abmelden</button>
      </p>
      {fehler && <p className="text-red-700">{fehler}</p>}

      {gruppen && (
        <select className="border p-1 w-full" value={gruppe} onChange={e => setGruppe(e.target.value)}>
          <option value="">Werkgruppe wählen…</option>
          {gruppen.map(g => <option key={g.id} value={g.id}>{g.titel}</option>)}
        </select>
      )}

      {werke && !werk && (
        <>
          <input className="border p-1 w-full" placeholder="Inv. Nr. oder Titel"
                 value={suche} onChange={e => setSuche(e.target.value)} />
          <ul className="divide-y">
            {treffer.map(w => (
              <li key={w.id}>
                <button className="w-full text-left py-1 hover:bg-gray-100" onClick={() => oeffnen(w)}>
                  <span className="font-mono">{w.data.InvNr}</span> {w.data.Titel}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {werk && (
        <div className="space-y-3">
          <button className="underline text-sm" onClick={() => setWerk(undefined)}>← Zurück zur Liste</button>
          {FELDER.map(f => (
            <label key={f} className="block">
              <span className="text-sm text-gray-600">{f}</span>
              {f === "InvNr" ? (
                <input className="border p-1 w-full bg-gray-100" value={entwurf[f] ?? ""} readOnly />
              ) : LANG.includes(f) || String(entwurf[f] ?? "").length > 80 ? (
                <textarea className="border p-1 w-full" rows={3} value={entwurf[f] ?? ""}
                          onChange={e => setEntwurf({ ...entwurf, [f]: e.target.value })} />
              ) : (
                <input className="border p-1 w-full" value={entwurf[f] ?? ""}
                       onChange={e => setEntwurf({ ...entwurf, [f]: e.target.value })} />
              )}
            </label>
          ))}
          <div className="flex gap-2 items-center">
            <button className={knopf} disabled={!geaendert.length || speichert} onClick={speichern}>
              {speichert ? "Speichere…" : "Speichern"}
            </button>
            <button className={knopf} disabled={!geaendert.length || speichert}
                    onClick={() => setEntwurf({ ...werk.data })}>Verwerfen</button>
            {hinweis && <span className="text-green-700 text-sm">{hinweis}</span>}
          </div>

          <h3 className="text-lg pt-4">Verlauf</h3>
          {verlauf.length === 0 && <p className="text-sm text-gray-600">Noch keine Änderungen.</p>}
          <ul className="text-sm space-y-2">
            {verlauf.map((v, i) => (
              <li key={i}>
                <span className="text-gray-600">{v.at?.toDate().toLocaleString("de-DE")} · {v.by}</span>
                {Object.entries(v.changes).map(([f, c]) => (
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
