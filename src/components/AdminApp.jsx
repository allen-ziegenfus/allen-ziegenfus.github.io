import { useEffect, useState } from "react";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import {
  collection, doc, FieldPath, getDocs, query, runTransaction, serverTimestamp, setDoc, updateDoc, where,
} from "firebase/firestore";
import { slugify } from "../werkverzeichnis/slugify";
import { darf, ROLLEN_NAMEN, ROLLEN } from "../werkverzeichnis/permissions.js";
import { auth, db } from "./firebaseClient.js";
import Seiten from "./Seiten.jsx";
import Veroeffentlichen from "./Veroeffentlichen.jsx";

/**
 * Die Verwaltungsseite für mehrere Künstler:innen. Super-Admins legen
 * Künstler:innen an; die Rollen je Künstler:in entscheiden den Rest
 * (permissions.js). firestore.rules setzt alles durch — diese Seite blendet nur
 * aus, was man ohnehin nicht dürfte.
 */

const EINSTELLUNGEN = [
  ["titel", "Name"],
  ["websiteTitel", "Titel der Website"],
  ["titelZeile1", "Titel mobil, Zeile 1"],
  ["titelZeile2", "Titel mobil, Zeile 2"],
  ["copyright", "Copyright"],
];
const LEER = { titel: "", websiteTitel: "", titelZeile1: "", titelZeile2: "", copyright: "",
  roles: {}, active: true };

/** Dasselbe Muster wie in den Regeln: Die Kennung wird ARTIST_ID und Name eines Pages-Projekts. */
const zuKennung = (s, max) => slugify(s, { lower: true }).replace(/[^a-z0-9-]/g, "").slice(0, max);
const istEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const knopf = "px-3 py-1 border rounded disabled:opacity-40";
const meldung = e => e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message;

export default function Verwaltung() {
  const [nutzer, setNutzer] = useState(undefined);  // undefined = wird noch geprüft
  const [istSuper, setIstSuper] = useState(false);
  const [kuenstlerListe, setKuenstlerListe] = useState();
  const [offen, setOffen] = useState();             // Kennung, oder "" für eine neue Künstler:in
  const [fehler, setFehler] = useState();

  useEffect(() => onAuthStateChanged(auth, setNutzer), []);

  async function laden(n = nutzer) {
    setFehler(undefined);
    try {
      // Ein Custom Claim im Anmelde-Token (tools/super_admin.mjs). Eine Änderung
      // wirkt erst nach Ab- und erneutem Anmelden.
      const sup = (await n.getIdTokenResult()).claims.superAdmin === true;
      setIstSuper(sup);
      const sammlung = collection(db, "artists");
      // FieldPath, weil die Punkte einer E-Mail-Adresse sonst als Verschachtelung gelten.
      const snap = await getDocs(sup ? sammlung
        : query(sammlung, where(new FieldPath("roles", n.email), "in", ROLLEN)));
      setKuenstlerListe(snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => a.titel.localeCompare(b.titel)));
    } catch (e) {
      setFehler(meldung(e));
    }
  }

  useEffect(() => { if (nutzer) laden(nutzer); }, [nutzer]);

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
        Angemeldet als {nutzer.email}{istSuper && " (Super-Admin)"} ·{" "}
        <button className="underline" onClick={() => signOut(auth)}>Abmelden</button>
      </p>
      {fehler && <p className="text-red-700">{fehler}</p>}

      {offen === undefined ? (
        <>
          {kuenstlerListe && !kuenstlerListe.length && (
            <p>Kein Zugriff: {nutzer.email} hat bei keiner Künstler:in eine Rolle.</p>
          )}
          <ul className="divide-y">
            {(kuenstlerListe ?? []).map(k => (
              <li key={k.id}>
                <button className="w-full text-left py-2 hover:bg-gray-100" onClick={() => setOffen(k.id)}>
                  {k.titel} <span className="font-mono text-sm text-gray-600">{k.id}</span>
                  {!k.active && <span className="text-sm text-gray-600"> · inaktiv</span>}
                  <span className="text-sm text-gray-600">
                    {" · "}{istSuper ? "Super-Admin" : ROLLEN_NAMEN[k.roles?.[nutzer.email]]}
                    {" · "}{Object.keys(k.roles ?? {}).length} Personen
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {istSuper && <button className={knopf} onClick={() => setOffen("")}>Neue Künstler:in</button>}
        </>
      ) : (
        <Kuenstler id={offen} ich={nutzer.email} istSuper={istSuper}
                   anfang={kuenstlerListe.find(k => k.id === offen)}
                   onSchliessen={() => { setOffen(undefined); laden(); }} />
      )}
    </div>
  );
}

function Kuenstler({ id, ich, istSuper, anfang, onSchliessen }) {
  const istNeu = id === "";
  const wer = { superAdmin: istSuper, rolle: anfang?.roles?.[ich] };
  const [entwurf, setEntwurf] = useState(() => {
    const { id: _, updatedAt, ...daten } = anfang ?? LEER;
    return { ...LEER, ...daten };
  });
  const [neueKennung, setNeueKennung] = useState("");
  const [kennungBearbeitet, setKennungBearbeitet] = useState(false);
  const [speichert, setSpeichert] = useState(false);
  const [fehler, setFehler] = useState();
  const [hinweis, setHinweis] = useState();

  const setze = (k, v) => {
    setEntwurf(e => ({ ...e, [k]: v }));
    if (istNeu && k === "titel" && !kennungBearbeitet) setNeueKennung(zuKennung(v, 40));
  };

  async function speichern() {
    setSpeichert(true); setFehler(undefined); setHinweis(undefined);
    const daten = { ...entwurf, updatedAt: serverTimestamp() };
    try {
      if (istNeu) {
        if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(neueKennung)) throw new Error("Kennung: 2–40 Zeichen, a–z, 0–9 und -.");
        const ref = doc(db, "artists", neueKennung);
        await runTransaction(db, async tx => {
          if ((await tx.get(ref)).exists()) throw new Error(`„${neueKennung}“ gibt es schon.`);
          tx.set(ref, daten);
        });
        onSchliessen();
      } else {
        await setDoc(doc(db, "artists", id), daten);
        setHinweis("Gespeichert.");
      }
    } catch (e) {
      setFehler(meldung(e));
    } finally {
      setSpeichert(false);
    }
  }

  return (
    <div className="space-y-3">
      <button className="underline text-sm" onClick={onSchliessen}>← Zurück zur Liste</button>
      <h2 className="text-xl">{istNeu ? "Neue Künstler:in" : entwurf.titel}</h2>

      {EINSTELLUNGEN.map(([k, beschriftung]) => (
        <label key={k} className="block">
          <span className="text-sm text-gray-600">{beschriftung}</span>
          <input className="border p-1 w-full disabled:bg-gray-100" value={entwurf[k]}
                 disabled={!darf(wer, "einstellungen.bearbeiten")} onChange={e => setze(k, e.target.value)} />
        </label>
      ))}
      <label className="block">
        <span className="text-sm text-gray-600">Kennung (ARTIST_ID, nicht änderbar)</span>
        <input className="border p-1 w-full font-mono disabled:bg-gray-100" disabled={!istNeu}
               value={istNeu ? neueKennung : id}
               onChange={e => { setKennungBearbeitet(true); setNeueKennung(e.target.value); }} />
      </label>
      <label className="flex gap-2 items-center">
        <input type="checkbox" checked={entwurf.active} disabled={!darf(wer, "einstellungen.bearbeiten")}
               onChange={e => setze("active", e.target.checked)} />
        <span>Aktiv (Website wird gebaut)</span>
      </label>

      <Rollen rollen={entwurf.roles} ich={istSuper ? null : ich} onAenderung={v => setze("roles", v)}
              nurLesen={!darf(wer, "rollen.verwalten")} />

      <div className="flex gap-2 items-center">
        <button className={knopf} onClick={speichern}
                disabled={speichert || !entwurf.titel.trim()
                  || !(darf(wer, "einstellungen.bearbeiten") || darf(wer, "rollen.verwalten"))}>
          {speichert ? "Speichere…" : istNeu ? "Anlegen" : "Speichern"}
        </button>
        {hinweis && <span className="text-green-700 text-sm">{hinweis}</span>}
        {fehler && <span className="text-red-700 text-sm">{fehler}</span>}
      </div>

      {!istNeu && <Veroeffentlichen kuenstlerId={id} ich={ich} erlaubt={darf(wer, "veroeffentlichen")} />}
      {!istNeu && <Werkgruppen kuenstlerId={id} bearbeitbar={darf(wer, "werkgruppen.bearbeiten")} />}
      {!istNeu && <Seiten kuenstlerId={id} bearbeitbar={darf(wer, "seiten.bearbeiten")} />}
    </div>
  );
}

/**
 * Wer welche Rolle bei dieser Künstler:in hat. `ich` (null bei Super-Admins)
 * kann den eigenen Eintrag nicht ändern, damit sich ein Admin nicht versehentlich
 * aussperrt.
 */
function Rollen({ rollen, ich, onAenderung, nurLesen }) {
  const [eingabe, setEingabe] = useState("");
  const [rolle, setRolle] = useState("editor");
  const email = eingabe.trim().toLowerCase();
  const gueltig = istEmail(email) && !(email in rollen);
  const hinzufuegen = () => { if (gueltig) { onAenderung({ ...rollen, [email]: rolle }); setEingabe(""); } };
  const ohne = e => Object.fromEntries(Object.entries(rollen).filter(([k]) => k !== e));
  const auswahl = "border p-1 disabled:bg-gray-100";

  return (
    <div>
      <span className="text-sm text-gray-600">Personen und Rollen</span>
      <ul className="text-sm space-y-1">
        {Object.entries(rollen).sort(([a], [b]) => a.localeCompare(b)).map(([e, r]) => (
          <li key={e} className="flex gap-2 items-center">
            <span className="flex-1">{e}</span>
            <select className={auswahl} value={r} disabled={nurLesen || e === ich}
                    onChange={ev => onAenderung({ ...rollen, [e]: ev.target.value })}>
              {ROLLEN.map(x => <option key={x} value={x}>{ROLLEN_NAMEN[x]}</option>)}
            </select>
            {!nurLesen && e !== ich && (
              <button className="text-red-700" title="Entfernen" onClick={() => onAenderung(ohne(e))}>×</button>
            )}
          </li>
        ))}
        {!Object.keys(rollen).length && <li className="text-gray-600">—</li>}
      </ul>
      {!nurLesen && (
        <div className="flex gap-2 pt-1">
          <input className="border p-1 flex-1" placeholder="name@gmail.com" value={eingabe}
                 onChange={e => setEingabe(e.target.value)} onKeyDown={e => e.key === "Enter" && hinzufuegen()} />
          <select className={auswahl} value={rolle} onChange={e => setRolle(e.target.value)}>
            {ROLLEN.map(x => <option key={x} value={x}>{ROLLEN_NAMEN[x]}</option>)}
          </select>
          <button className={knopf} disabled={!gueltig} onClick={hinzufuegen}>Hinzufügen</button>
        </div>
      )}
    </div>
  );
}

function Werkgruppen({ kuenstlerId, bearbeitbar }) {
  const [gruppen, setGruppen] = useState();
  const [titel, setTitel] = useState("");
  const [fehler, setFehler] = useState();
  const sammlung = collection(db, "artists", kuenstlerId, "werkgruppen");

  async function laden() {
    const snap = await getDocs(sammlung);
    setGruppen(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.reihenfolge - b.reihenfolge));
  }
  useEffect(() => { laden().catch(e => setFehler(meldung(e))); }, [kuenstlerId]);

  async function hinzufuegen() {
    setFehler(undefined);
    const id = zuKennung(titel, 60);
    const ref = doc(sammlung, id);
    const reihenfolge = Math.max(0, ...gruppen.map(g => g.reihenfolge)) + 1;
    try {
      await runTransaction(db, async tx => {
        if ((await tx.get(ref)).exists()) throw new Error(`„${id}“ gibt es schon.`);
        tx.set(ref, { titel: titel.trim(), kurztitel: null, reihenfolge });
      });
      setTitel("");
      await laden();
    } catch (e) {
      setFehler(meldung(e));
    }
  }

  async function aendern(g, aenderungen) {
    setFehler(undefined);
    try {
      await updateDoc(doc(sammlung, g.id), aenderungen);
      await laden();
    } catch (e) {
      setFehler(meldung(e));
    }
  }

  return (
    <div className="pt-4 space-y-2">
      <h3 className="text-lg">Werkgruppen</h3>
      {fehler && <p className="text-red-700 text-sm">{fehler}</p>}
      <table className="text-sm w-full">
        <thead>
          <tr className="text-left text-gray-600">
            <th className="w-16">Reihe</th><th>Titel</th><th>Kurztitel</th><th>Kennung</th>
          </tr>
        </thead>
        <tbody>
          {(gruppen ?? []).map(g => (
            <tr key={g.id}>
              <td>
                <input type="number" className="border p-1 w-14 disabled:bg-gray-100" disabled={!bearbeitbar} defaultValue={g.reihenfolge}
                       onBlur={e => Number(e.target.value) !== g.reihenfolge
                         && aendern(g, { reihenfolge: Math.trunc(Number(e.target.value)) })} />
              </td>
              <td>
                <input className="border p-1 w-full disabled:bg-gray-100" disabled={!bearbeitbar} defaultValue={g.titel}
                       onBlur={e => e.target.value.trim() && e.target.value !== g.titel
                         && aendern(g, { titel: e.target.value.trim() })} />
              </td>
              <td>
                <input className="border p-1 w-full disabled:bg-gray-100" disabled={!bearbeitbar} defaultValue={g.kurztitel ?? ""}
                       onBlur={e => e.target.value !== (g.kurztitel ?? "")
                         && aendern(g, { kurztitel: e.target.value.trim() || null })} />
              </td>
              <td className="font-mono text-gray-600">{g.id}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {bearbeitbar && (
        <>
          <p className="text-xs text-gray-600">Änderungen werden beim Verlassen des Feldes gespeichert.</p>
          <div className="flex gap-2">
            <input className="border p-1 flex-1" placeholder="Neue Werkgruppe" value={titel}
                   onChange={e => setTitel(e.target.value)} />
            <button className={knopf} disabled={!gruppen || !zuKennung(titel, 60)} onClick={hinzufuegen}>Hinzufügen</button>
          </div>
        </>
      )}
    </div>
  );
}
