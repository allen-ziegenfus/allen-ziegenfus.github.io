import { useEffect, useState } from "react";
import {
  addDoc, collection, limit, onSnapshot, orderBy, query, serverTimestamp, where,
} from "firebase/firestore";
import { db } from "./firebaseClient.js";

/**
 * Edits go live only when someone presses Veröffentlichen: that creates a
 * request, and gcf/publish.js builds and deploys the site (cloudbuild.yaml).
 * The list follows the requests live.
 */

const STATUS = {
  angefordert: "angefordert", wartet: "wartet auf laufenden Build", läuft: "läuft …",
  fertig: "veröffentlicht", fehler: "fehlgeschlagen",
};
const COLOR = { fertig: "text-green-700", fehler: "text-red-700" };
const button = "px-3 py-1 border rounded disabled:opacity-40";
const MAX = 100;
const count = n => n > MAX ? `über ${MAX}` : n;
const when = t => t?.toDate().toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) ?? "…";

export default function Veroeffentlichen({ artistId, me, allowed }) {
  const [list, setList] = useState();
  const [last, setLast] = useState();  // null: never published
  const [changes, setChanges] = useState();
  const [error, setError] = useState();
  const col = collection(db, "artists", artistId, "veroeffentlichungen");

  useEffect(() => onSnapshot(query(col, orderBy("angefordert", "desc"), limit(5)),
    snap => setList(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    e => setError(e.message)), [artistId]);

  // When the last successful build started; on its own, since it can be older
  // than the five requests listed.
  useEffect(() => onSnapshot(query(col, where("status", "==", "fertig"), orderBy("gestartet", "desc"), limit(1)),
    snap => setLast(snap.docs[0]?.get("gestartet") ?? null),
    e => setError(e.message)), [artistId]);

  // Edits since then, live, so saving a page updates them; at most MAX + 1 are
  // read. Werkgruppen carry no timestamp, so their changes are not counted.
  useEffect(() => {
    if (last === undefined) return;
    setChanges({});
    const since = (c, field) => onSnapshot(
      query(collection(db, "artists", artistId, c), ...(last ? [where(field, ">", last)] : []), limit(MAX + 1)),
      snap => setChanges(ch => ({ ...ch, [c]: snap.size })),
      e => setError(e.message));
    const stop = [since("history", "at"), since("seiten", "updatedAt")];
    return () => stop.forEach(f => f());
  }, [artistId, last]);

  const busy = list?.some(v => ["angefordert", "läuft"].includes(v.status));

  async function publish() {
    setError(undefined);
    try {
      await addDoc(col, { von: me, angefordert: serverTimestamp(), status: "angefordert" });
    } catch (e) {
      setError(e.code === "permission-denied" ? "Von den Regeln abgelehnt." : e.message);
    }
  }

  return (
    <div className="pt-4 space-y-2">
      <h3 className="text-lg">Veröffentlichen</h3>
      {changes?.history !== undefined && changes?.seiten !== undefined && (
        <p className="text-sm">
          {last ? `Seit der letzten Veröffentlichung (${when(last)}): ` : "Noch nie veröffentlicht. "}
          {count(changes.history)} Änderung{changes.history === 1 ? "" : "en"} an Werken,{" "}
          {count(changes.seiten)} geänderte Seite{changes.seiten === 1 ? "" : "n"}.
        </p>
      )}
      {allowed && (
        <button className={button} onClick={publish} disabled={!list}>
          {busy ? "Erneut veröffentlichen" : "Veröffentlichen"}
        </button>
      )}
      {error && <p className="text-red-700 text-sm">{error}</p>}
      <ul className="text-sm">
        {(list ?? []).map(v => (
          <li key={v.id}>
            {when(v.angefordert)} · {v.von} ·{" "}
            <span className={COLOR[v.status] ?? ""}>{STATUS[v.status] ?? v.status}</span>
            {v.meldung && <span className="text-red-700"> ({v.meldung})</span>}
            {v.logUrl && <> · <a className="underline" href={v.logUrl} target="_blank" rel="noreferrer">Log</a></>}
          </li>
        ))}
      </ul>
    </div>
  );
}
