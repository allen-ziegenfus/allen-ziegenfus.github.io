import { useEffect, useMemo, useState } from "react";
import Document from "flexsearch/src/document";
import { filter, stemmer } from "flexsearch/src/lang/de";
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup } from "firebase/auth";
import { documentMatches, execute, score } from "firebase/firestore/pipelines";
import { auth, db, ARTIST } from "./firebaseClient.js";

/**
 * Firestore test (FIRESTORE.md): the site's browser search next to Firestore's
 * full-text search, on the same Werkgruppe.
 *
 * Left is exactly what SearchBar.jsx does today (FlexSearch, German stemmer, over
 * InvNr/Titel/Beschreibung from searchData.json). Right searches the German text
 * index on artists/<ARTIST>/works, which also covers Material, Technik, Standort,
 * Werkgruppe, Ausstellung and Literatur. The security rules apply, so sign in.
 */
const GROUP = "objekte";

/** SearchBar.jsx's ranking: matches in order of field, deduplicated. */
function flexSearch(index, records, q) {
  const byField = index.search(q, { enrich: true });
  const ids = [...new Set(byField.flatMap(r => r.result))];
  return ids.map(id => records[id]);
}

export default function SearchCompare() {
  const [user, setUser] = useState(undefined);
  const [q, setQ] = useState("");
  const [index, setIndex] = useState();
  const [records, setRecords] = useState({});
  const [remote, setRemote] = useState({ results: [], ms: 0 });
  const [error, setError] = useState();

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    fetch("/searchData.json").then(r => r.json()).then(data => {
      const mine = data.filter(r => r.WerkgruppeSlug === GROUP);
      const idx = new Document({
        document: {
          id: "InvNr",
          index: [
            { field: "InvNr", tokenize: "strict", minlength: 3 },
            { field: "Titel", tokenize: "full", minlength: 3 },
            { field: "Beschreibung", tokenize: "full", minlength: 3 },
          ],
        },
        language: "de", filter, stemmer,
      });
      mine.forEach(r => idx.add(r));
      setIndex(idx);
      setRecords(Object.fromEntries(mine.map(r => [r.InvNr, r])));
    });
  }, []);

  const local = useMemo(() => {
    if (!index || !q.trim()) return { results: [], ms: 0 };
    const t = performance.now();
    const results = flexSearch(index, records, q);
    return { results, ms: performance.now() - t };
  }, [index, records, q]);

  // Debounced: every Firestore search is a network round trip and costs reads.
  useEffect(() => {
    if (!user || !q.trim()) { setRemote({ results: [], ms: 0 }); return; }
    const timer = setTimeout(async () => {
      setError(undefined);
      const t = performance.now();
      try {
        const pipeline = db.pipeline()
          .collection(`artists/${ARTIST}/works`)
          .search({ query: documentMatches(q), sort: score().descending() })
          .limit(30);
        const { results } = await execute(pipeline);
        setRemote({ results: results.map(r => r.data()), ms: performance.now() - t });
      } catch (e) {
        setError(e.message);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [q, user]);

  if (user === undefined) return <p>…</p>;
  if (!user) return (
    <button className="px-3 py-1 border rounded"
            onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}>
      Mit Google anmelden (Firebase)
    </button>
  );

  const column = (title, note, { results, ms }) => (
    <div className="flex-1 min-w-0">
      <h2 className="text-lg">{title}</h2>
      <p className="text-xs text-gray-600">{note}</p>
      <p className="text-sm py-1">{q.trim() ? `${results.length} Treffer · ${ms.toFixed(0)} ms` : ""}</p>
      <ol className="text-sm list-decimal pl-5">
        {results.map(r => (
          <li key={r.InvNr}>
            <a className="text-blue-800" href={`/${GROUP}/${records[r.InvNr]?.Slug ?? ""}`}>
              <span className="font-mono">{r.InvNr}</span>
            </a>{" "}
            {r.Titel}
          </li>
        ))}
      </ol>
    </div>
  );

  return (
    <div className="space-y-4">
      <input className="border p-2 w-full" autoFocus placeholder="Suchbegriff, z. B. Skulpturen, Holz, rot …"
             value={q} onChange={e => setQ(e.target.value)} />
      {error && <p className="text-red-700 text-sm">{error}</p>}
      <div className="flex flex-col md:flex-row gap-6">
        {column("Heute (Browser)", "FlexSearch, deutscher Stemmer · Inv. Nr., Titel, Beschreibung", local)}
        {column("Firestore", "Volltextindex (de) · plus Material, Technik, Standort, Werkgruppe, Ausstellung, Literatur", remote)}
      </div>
    </div>
  );
}
