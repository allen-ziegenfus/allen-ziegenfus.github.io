import { React, useEffect, useState } from "react";
import Fuse from "fuse.js";
import { Slider } from "@radix-ui/themes";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import Select from "react-select";

export default function SearchBar({}) {
  const urlParams = new URLSearchParams(window.location.search);
  const search = urlParams.get("search");

  const [searchInput, setSearchInput] = useState(search || "");
  const [displayRows, setDisplayRows] = useState([]);
  const [yearRange, setYearRange] = useState([0, 0]);
  const [records, setRecords] = useState([]);
  const [selectedYearRange, setSelectedYearRange] = useState([0, 0]);
  const [fetched, setFetched] = useState(false);
  const [bildVorhanden, setBildVorhanden] = useState(false);
  const [open, setOpen] = useState(true);
  const [werkgruppen, setWerkgruppen] = useState([]);
  const [selectedWerkgruppe, setSelectedWerkgruppe] = useState();

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
    async function fetchRecords() {
      try {
        const recordsresponse = await fetch("/records.json");
        setRecords(await recordsresponse.json());
        const searchMetadataResponse = await fetch("/searchMetadata.json");
        const searchMetadata = await searchMetadataResponse.json();
        setYearRange([
          Number(searchMetadata.MinYear),
          Number(searchMetadata.MaxYear),
        ]);
        setSelectedYearRange([
          Number(searchMetadata.MinYear),
          Number(searchMetadata.MaxYear),
        ]);
        const options = [];
        const all = { value: "all", label: "Alle" };
        options.push(all);
        options.push(
          ...searchMetadata.Werkgruppen.map((werkgruppe) => ({
            value: werkgruppe.WerkgruppenSlug,
            label: werkgruppe.WerkgruppenTitel,
          }))
        );

        setWerkgruppen(options);
        setSelectedWerkgruppe(all);
        setFetched(true);
      } catch (error) {
        console.log(error);
      }
    }
    fetchRecords();
  }, []);

  useEffect(() => {
    const [minYear, maxYear] = selectedYearRange;
    console.log("checking", selectedWerkgruppe);
    const filteredRecords = records.filter(
      (record) =>
        Number(record.Jahr) >= minYear &&
        Number(record.Jahr) <= maxYear &&
        (bildVorhanden ? !record.Bilder[0].includes("placeholder") : true) &&
        (selectedWerkgruppe.value == "all" ||
          selectedWerkgruppe.value == record.WerkgruppeSlug)
    );

    let recordsToShow = filteredRecords;
    if (searchInput) {
      fuse.setCollection(filteredRecords);

      const searchResults = fuse.search(searchInput);
      if (searchResults) {
        recordsToShow = searchResults.map((result) => result.item);
      }
    }

    setDisplayRows(
      recordsToShow.slice(0, 24).map((record) => ({
        Titel: record.Titel,
        Slug: `/${record.WerkgruppeSlug}/${record.Slug}`,
        Thumbnail: record.Thumbnail,
        InvNr: record.InvNr,
      }))
    );
  }, [
    selectedYearRange,
    records,
    bildVorhanden,
    searchInput,
    selectedWerkgruppe,
  ]);

  const fuse = new Fuse(records, {
    threshold: 0.5,
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
    return (
      <button onClick={() => setOpen(true)}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="icon icon-tabler icon-tabler-search"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          strokeWidth="2"
          stroke="currentColor"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path stroke="none" d="M0 0h24v24H0z" fill="none" />
          <circle cx="10" cy="10" r="7" />
          <line x1="21" y1="21" x2="15" y2="15" />
        </svg>
      </button>
    );
  } else {
    return (
      fetched && (
        <div className="text-white fixed top-0 bottom-0 left-0 right-0 bg-black overflow-scroll z-10">
          <div className="max-w-6xl m-auto">
            <input
              className="text-black flex my-5 mx-auto w-1/2 h-10 rounded-lg p-2"
              placeholder="Suchen"
              value={searchInput}
              onChange={(e) => {
                const searchTerm = e.target.value;
                setSearchInput(searchTerm);
              }}
            ></input>

            <div class="p-6">
              <div class="w-full flex-wrap md:flex border-2  rounded-md p-2 items-center gap-4">
                <div className="p-1 flex-1">
                  <div class="mb-2 text-center">Jahr</div>
                  <Theme>
                    <Slider
                      defaultValue={selectedYearRange}
                      min={Number(yearRange[0])}
                      max={Number(yearRange[1])}
                      onValueChange={(newYearRange) => {
                        setSelectedYearRange(newYearRange);
                      }}
                    ></Slider>
                  </Theme>
                  <div className="text-white text-center">
                    {selectedYearRange[0]} - {selectedYearRange[1]}
                  </div>
                </div>

                <div className="p-1  text-black flex flex-wrap items-center flex-1">
                  <div className="my-1 w-full flex items-center ">
                    <div className="text-white">Werkgruppe:</div>
                    {werkgruppen.length > 0 && (
                      <Select
                        className="m-1 w-full"
                        onChange={(option) => setSelectedWerkgruppe(option)}
                        options={werkgruppen}
                        defaultValue={selectedWerkgruppe}
                      />
                    )}
                  </div>
                  <div className="flex w-full items-center text-white my-1">
                    <input
                      type="checkbox"
                      id="bildvorhanden"
                      onChange={(val) => setBildVorhanden(val.target.checked)}
                    />
                    <label className="ml-2" htmlFor="bildvorhanden">
                      Bild vorhanden?
                    </label>
                  </div>
                </div>
              </div>
            </div>
            {searchInput && (
              <div className="text-center text-white">
                <h2>Ergebnisse für {searchInput}</h2>
              </div>
            )}
            <div className="container text-white p-6 grid grid-cols-2 lg:grid-cols-4 gap-4 ">
              {displayRows.length > 1 &&
                displayRows.map((row) => (
                  <li
                    key={row.InvNr}
                    className="list-none border-2 rounded-lg p-3 text-center hover:border-gray-600"
                  >
                    <a
                      className="flex flex-col"
                      href={`${row.Slug}/?search=${searchInput}`}
                    >
                      <img src={row.Thumbnail} alt={row.Titel} />
                      <h2 className="pt-2 break-words md:break-normal" style={{"hyphens": "auto"}}>{row.Titel}</h2>
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
      )
    );
  }
}
