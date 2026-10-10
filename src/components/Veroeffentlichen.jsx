import { useEffect, useState } from "react";
import {
  addDoc, collection, limit, onSnapshot, orderBy, query, serverTimestamp, where,
} from "firebase/firestore";
import { db } from "./firebaseClient.js";

/**
 * Änderungen gehen erst online, wenn jemand auf Veröffentlichen drückt: Das legt
 * eine Anfrage an, und gcf/publish.js baut und deployt die Seite (cloudbuild.yaml).
 * Die Liste folgt den Anfragen live.
 */

const STATUS = {
  angefordert: "angefordert", wartet: "wartet auf laufenden Build", läuft: "läuft …",
  fertig: "veröffentlicht", fehler: "fehlgeschlagen",
};
const FARBE = { fertig: "text-green-700", fehler: "text-red-700" };
const knopf = "px-3 py-1 border rounded disabled:opacity-40";
const HOECHSTENS = 100;
const anzahl = n => n > HOECHSTENS ? `über ${HOECHSTENS}` : n;
const wann = t => t?.toDate().toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) ?? "…";

export default function Veroeffentlichen({ kuenstlerId, ich, erlaubt }) {
  const [liste, setListe] = useState();
  const [zuletzt, setZuletzt] = useState();  // null: nie veröffentlicht
  const [aenderungen, setAenderungen] = useState();
  const [fehler, setFehler] = useState();
  const sammlung = collection(db, "artists", kuenstlerId, "veroeffentlichungen");

  useEffect(() => onSnapshot(query(sammlung, orderBy("angefordert", "desc"), limit(5)),
    snap => setListe(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    e => setFehler(e.message)), [kuenstlerId]);

  // Wann der letzte erfolgreiche Build gestartet ist; eigens abgefragt, denn er
  // kann älter sein als die fünf gelisteten Anfragen.
  useEffect(() => onSnapshot(query(sammlung, where("status", "==", "fertig"), orderBy("gestartet", "desc"), limit(1)),
    snap => setZuletzt(snap.docs[0]?.get("gestartet") ?? null),
    e => setFehler(e.message)), [kuenstlerId]);

  // Änderungen seitdem, live, damit das Speichern einer Seite sie aktualisiert;
  // höchstens HOECHSTENS + 1 werden gelesen. Werkgruppen haben keinen
  // Zeitstempel, ihre Änderungen zählen nicht mit.
  useEffect(() => {
    if (zuletzt === undefined) return;
    setAenderungen({});
    const seit = (c, feld) => onSnapshot(
      query(collection(db, "artists", kuenstlerId, c), ...(zuletzt ? [where(feld, ">", zuletzt)] : []), limit(HOECHSTENS + 1)),
      snap => setAenderungen(a => ({ ...a, [c]: snap.size })),
      e => setFehler(e.message));
    const beenden = [seit("history", "at"), seit("seiten", "updatedAt")];
    return () => beenden.forEach(f => f());
  }, [kuenstlerId, zuletzt]);

  const beschaeftigt = liste?.some(v => ["angefordert", "läuft"].includes(v.status));

  async function veroeffentlichen() {
    setFehler(undefined);
    try {
      await addDoc(sammlung, { von: ich, angefordert: serverTimestamp(), status: "angefordert" });
    } catch (e) {
      setFehler(e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message);
    }
  }

  return (
    <div className="pt-4 space-y-2">
      <h3 className="text-lg">Veröffentlichen</h3>
      {aenderungen?.history !== undefined && aenderungen?.seiten !== undefined && (
        <p className="text-sm">
          {zuletzt ? `Seit der letzten Veröffentlichung (${wann(zuletzt)}): ` : "Noch nie veröffentlicht. "}
          {anzahl(aenderungen.history)} Änderung{aenderungen.history === 1 ? "" : "en"} an Werken,{" "}
          {anzahl(aenderungen.seiten)} geänderte Seite{aenderungen.seiten === 1 ? "" : "n"}.
        </p>
      )}
      {erlaubt && (
        <button className={knopf} onClick={veroeffentlichen} disabled={!liste}>
          {beschaeftigt ? "Erneut veröffentlichen" : "Veröffentlichen"}
        </button>
      )}
      {fehler && <p className="text-red-700 text-sm">{fehler}</p>}
      <ul className="text-sm">
        {(liste ?? []).map(v => (
          <li key={v.id}>
            {wann(v.angefordert)} · {v.von} ·{" "}
            <span className={FARBE[v.status] ?? ""}>{STATUS[v.status] ?? v.status}</span>
            {v.meldung && <span className="text-red-700"> ({v.meldung})</span>}
            {v.logUrl && <> · <a className="underline" href={v.logUrl} target="_blank" rel="noreferrer">Log</a></>}
          </li>
        ))}
      </ul>
    </div>
  );
}
