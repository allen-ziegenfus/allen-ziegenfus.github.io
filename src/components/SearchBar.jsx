import { React, useState } from "react";
import Fuse from "fuse.js";

export default function SearchBar({ fuseData }) {
  const [searchInput, setSearchInput] = useState();
  const [displayRows, setDisplayRows] = useState([]);
  const [open, setOpen] = useState(false);

  const fuse = new Fuse(fuseData, {
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
    return <button onClick={() => setOpen(true)}>Suchen</button>;
  } else {
    return (
      <div className="fixed top-0 bottom-0 left-0 right-0 bg-black">
        <div className="max-w-6xl m-auto">
          <input
            className="flex my-5 mx-auto w-1/2 h-10 rounded-lg p-2"
            placeholder="Suchen"
            onChange={(e) => {
              const searchTerm = e.target.value;
              setSearchInput(searchTerm);
              if (searchTerm) {
                const searchResults = fuse.search(searchTerm);
                console.log(searchResults);
                setSearchInput(searchTerm);
                if (searchResults) {
                  setDisplayRows(
                    searchResults.slice(0, 8).map((searchResult) => ({
                      Titel: searchResult.item.Titel,
                      Slug: searchResult.item.Slug,
                      Thumbnail: searchResult.item.Thumbnail,
                      InvNr: searchResult.item.InvNr,
                    }))
                  );
                }
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
          <div className="container text-white  p-6 grid grid-cols-4 gap-4">
            {displayRows.length > 1 &&
              displayRows.map((row) => (
                <li className="list-none border-2 rounded-lg p-3 text-center hover:border-gray-600">
                  <a className="flex flex-col" href={row.Slug}>
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
