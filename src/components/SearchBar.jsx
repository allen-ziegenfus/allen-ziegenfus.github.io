import { React, useEffect, useState } from "react";
import Fuse from "fuse.js";

export default function SearchBar({}) {
  const urlParams = new URLSearchParams(window.location.search);
  const search = urlParams.get("search");

  const [searchInput, setSearchInput] = useState(search || "");
  const [displayRows, setDisplayRows] = useState([]);
  const [records, setRecords] = useState([]);
  const [open, setOpen] = useState(false);

  function openSearch(e) {
    setOpen(true);
  }
  useEffect(() => {
    window.addEventListener("openSearch", openSearch);
    return () => window.removeEventListener("openSearch", openSearch);
  }, []);

  useEffect(() => {
    if (open) {
      document.body.classList.add("overflow-hidden");
    } else {
      document.body.classList.remove("overflow-hidden");
    }
  }, [open]);

  useEffect(() => {
    function performSearch() {
      const searchResults = fuse.search(searchInput);
      if (searchResults) {
        setDisplayRows(
          searchResults.slice(0, 8).map((searchResult) => ({
            Titel: searchResult.item.Titel,
            Slug: `/${searchResult.item.WerkgruppeSlug}/${searchResult.item.Slug}`,
            Thumbnail: searchResult.item.Thumbnail,
            InvNr: searchResult.item.InvNr,
          }))
        );
      }
    }
    performSearch();
  }, [searchInput, records]);
  useEffect(() => {
    async function fetchRecords() {
      try {
        const recordsresponse = await fetch("/records.json");
        setRecords(await recordsresponse.json());
      } catch (error) {
        console.log(error);
      }
    }
    fetchRecords();
  }, []);

  const fuse = new Fuse(records, {
    threshold: 0.4,
    minMatchCharLength: 2,
    keys: [
      { name: "Titel", weight: 10 },
      { name: "Auflage", weight: 1 },
      { name: "InvNr", weight: 10 },
      { name: "Jahr", weight: 5 },
      { name: "Beschreibung", weight: 8 },
      { name: "Material", weight: 4 },
    ],
  });

  if (!open) {
    return <button onClick={() => setOpen(true)}>🔍</button>;
  } else {
    return (
      <div className="fixed top-0 bottom-0 left-0 right-0 bg-black overflow-scroll z-10">
        <div className="max-w-6xl m-auto">
          <input
            className="flex my-5 mx-auto w-1/2 h-10 rounded-lg p-2"
            placeholder="Suchen"
            value={searchInput}
            onChange={(e) => {
              const searchTerm = e.target.value;
              setSearchInput(searchTerm);
              if (searchTerm) {
                performSearch();
              } else {
                setDisplayRows([]);
                setSearchInput("");
              }
            }}
          ></input>
          {searchInput && (
            <div className="text-center text-white">
              <h2>Ergebnisse für {searchInput}</h2>
            </div>
          )}
          <div className="container text-white p-6 grid grid-cols-2 lg:grid-cols-4 gap-4 ">
            {displayRows.length > 1 &&
              displayRows.map((row) => (
                <li className="list-none border-2 rounded-lg p-3 text-center hover:border-gray-600">
                  <a
                    className="flex flex-col"
                    href={`${row.Slug}/?search=${searchInput}`}
                  >
                    <img src={row.Thumbnail} alt={row.Titel} />
                    <h2 className="pt-2">{row.Titel}</h2>
                    <h3 className="pt-2">{row.InvNr}</h3>
                  </a>
                </li>
              ))}
          </div>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="absolute right-0 top-0 text-white m-5 text-2xl"
        >
          X
        </button>
      </div>
    );
  }
}
