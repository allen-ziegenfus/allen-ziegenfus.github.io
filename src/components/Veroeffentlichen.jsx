import { useEffect, useState } from "react";
import {
  addDoc, collection, getCountFromServer, limit, onSnapshot, orderBy, query, serverTimestamp, where,
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
const when = t => t?.toDate().toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) ?? "…";

export default function Veroeffentlichen({ artistId, me, allowed }) {
  const [list, setList] = useState();
  const [changes, setChanges] = useState();
  const [error, setError] = useState();
  const col = collection(db, "artists", artistId, "veroeffentlichungen");

  useEffect(() => onSnapshot(query(col, orderBy("angefordert", "desc"), limit(5)),
    snap => setList(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    e => setError(e.message)), [artistId]);

  // Edits since the last successful build started. Werkgruppen carry no
  // timestamp, so their changes are not counted.
  const last = list?.find(v => v.status === "fertig")?.gestartet;
  useEffect(() => {
    if (!list) return;
    const artist = ["artists", artistId];
    const since = (c, field) => getCountFromServer(last
      ? query(collection(db, ...artist, c), where(field, ">", last))
      : collection(db, ...artist, c)).then(s => s.data().count);
    Promise.all([since("history", "at"), since("seiten", "updatedAt")])
      .then(([werke, seiten]) => setChanges({ werke, seiten }))
      .catch(e => setError(e.message));
  }, [artistId, last?.toMillis(), list?.length]);

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
      {changes && (
        <p className="text-sm">
          {last ? `Seit der letzten Veröffentlichung (${when(last)}): ` : "Noch nie veröffentlicht. "}
          {changes.werke} Änderung{changes.werke === 1 ? "" : "en"} an Werken,{" "}
          {changes.seiten} geänderte Seite{changes.seiten === 1 ? "" : "n"}.
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
