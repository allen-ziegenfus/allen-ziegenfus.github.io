import { React, useEffect, useState } from "react";
import Document from "flexsearch/src/document";
import { filter, stemmer } from "flexsearch/src/lang/de";
import { Slider } from "@radix-ui/themes";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import Select from "react-select";

export default function SearchBar({}) {
  const urlParams = new URLSearchParams(window.location.search);
  const search = urlParams.get("search");
  const DELTA = 24;

  const [searchInput, setSearchInput] = useState(search || "");
  const [displayRows, setDisplayRows] = useState([]);
  const [yearRange, setYearRange] = useState([0, 0]);
  const [records, setRecords] = useState([]);
  const [selectedYearRange, setSelectedYearRange] = useState([0, 0]);
  const [fetched, setFetched] = useState(false);
  const [bildVorhanden, setBildVorhanden] = useState(false);
  const [open, setOpen] = useState(false);
  const [werkgruppen, setWerkgruppen] = useState([]);
  const [selectedWerkgruppe, setSelectedWerkgruppe] = useState();
  const [invNrs, setInvNrs] = useState([]);
  const [page, setPage] = useState(0);
  const [index, setIndex] = useState();
  const [indexedRecords, setIndexedRecords] = useState();

  function createIndex(records) {
    const index = new Document({
      document: {
        id: "InvNr",

        index: [
          { field: "InvNr", tokenize: "strict", minlength: 3 },
          { field: "Titel", tokenize: "full", minlength: 3 },
          { field: "Beschreibung", tokenize: "full", minlength: 3 },
        ],
      },
      language: "de",
      filter,
      stemmer,
    });

    const map = {};
    records.forEach((record) => {
      index.add(record);
      map[record.InvNr] = record;
    });
    return [index, map];
  }

  function openSearch(e) {
    setOpen(true);
  }
  useEffect(() => {
    window.addEventListener("openSearch", openSearch);
    return () => {
      window.removeEventListener("openSearch", openSearch);
    };
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
        const searchDataResponse = await fetch("/searchData.json");
        const searchData = await searchDataResponse.json();
        setRecords(searchData);
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
        setInvNrs(searchMetadata.InvNrs);

        const [index, map] = createIndex(searchData);
        setIndex(index);
        setIndexedRecords(map);
      } catch (error) {
        console.log(error);
      }
    }
    fetchRecords();
  }, []);

  useEffect(() => {
    try {
      const sessionSelectedYearRange = JSON.parse(
        sessionStorage.getItem("selectedYearRange")
      );
      if (sessionSelectedYearRange)
        setSelectedYearRange(sessionSelectedYearRange);
      const sessionSelectedWerkgruppe = JSON.parse(
        sessionStorage.getItem("selectedWerkgruppe")
      );
      if (sessionSelectedWerkgruppe)
        setSelectedWerkgruppe(sessionSelectedWerkgruppe);
      const sessionBildVorhanden = sessionStorage.getItem("bildVorhanden");
      if (sessionBildVorhanden) {
        setBildVorhanden(sessionBildVorhanden === "true");
      }
    } catch (error) {
      sessionStorage.clear();
    }
  }, [fetched, open]);
  useEffect(() => {
    if (!fetched) return;
    const [minYear, maxYear] = selectedYearRange;
    const filteredRecords = records.filter(
      (record) =>
        (record.Jahre.length == 0 ||
          record.Jahre.filter((jahr) => jahr >= minYear && jahr <= maxYear)
            .length > 0) &&
        (bildVorhanden ? !record.Thumbnail.includes("placeholder") : true) &&
        (selectedWerkgruppe.value == "all" ||
          selectedWerkgruppe.value == record.WerkgruppeSlug)
    );

    let recordsToShow = filteredRecords;
    recordsToShow.sort((a, b) => Number(a.Jahr) > Number(b.Jahr));
    if (searchInput && index) {
      const [filteredIndex] = createIndex(filteredRecords);
      const searchResults = filteredIndex.search(searchInput, { enrich: true });

      const rank = { InvNr: 0, Titel: 1, Beschreibung: 2 };

      if (searchResults) {
        searchResults.sort((a, b) => {
          rank[a.field] - rank[b.field];
        });
        const rankedResults = [];
        searchResults.forEach((result) => rankedResults.push(...result.result));
        recordsToShow = rankedResults.map((InvNr) => indexedRecords[InvNr]);
      }
    }

    setPage(0);
    setDisplayRows(
      recordsToShow.map((record) => ({
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
    fetched,
  ]);

  return (
    open &&
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

          <div className="p-6">
            <div className="w-full flex-wrap md:flex border-2  rounded-md p-2 items-center gap-4">
              <div className="p-1 flex-1">
                <div className="mb-2 text-center">Jahr</div>
                <style>
                  {`
                    .rt-SliderTrack {
                        background-color: white;
                    } `}
                </style>
                <Theme>
                  <Slider
                    defaultValue={selectedYearRange}
                    min={Number(yearRange[0])}
                    max={Number(yearRange[1])}
                    onValueChange={(newYearRange) => {
                      setSelectedYearRange(newYearRange);
                      sessionStorage.setItem(
                        "selectedYearRange",
                        JSON.stringify(newYearRange)
                      );
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
                      onChange={(option) => {
                        setSelectedWerkgruppe(option);
                        sessionStorage.setItem(
                          "selectedWerkgruppe",
                          JSON.stringify(option)
                        );
                      }}
                      options={werkgruppen}
                      defaultValue={selectedWerkgruppe}
                    />
                  )}
                </div>
                <div className="flex w-full items-center text-white my-1">
                  <input
                    type="checkbox"
                    id="bildvorhanden"
                    checked={bildVorhanden}
                    onChange={(val) => {
                      setBildVorhanden(val.target.checked);
                      sessionStorage.setItem(
                        "bildVorhanden",
                        val.target.checked
                      );
                    }}
                  />
                  <label className="ml-2" htmlFor="bildvorhanden">
                    Bild vorhanden?
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="text-center text-white">
            <h2>
              Ergebnisse {searchInput && <>für {searchInput}</>} von{" "}
              {selectedYearRange[0]} - {selectedYearRange[1]}{" "}
              {selectedWerkgruppe.value != "all" && (
                <span>in Werkgruppe {selectedWerkgruppe.label}</span>
              )}
              {bildVorhanden && <>&nbsp;wo Bilder vorhanden sind</>}
            </h2>
          </div>

          <div className="p-6 ]ext-center flex items-center justify-evenly gap-2">
            <a
              className="cursor-pointer text-2xl"
              onClick={() => {
                if (page > 0) {
                  setPage(page - 1);
                }
              }}
            >
              &lt;
            </a>
            <div class="text-center">
              {Math.min(page * DELTA + 1, displayRows.length)} -{" "}
              {Math.min(page * DELTA + DELTA, displayRows.length)} von{" "}
              {displayRows.length} werden angezeigt
            </div>
            <a
              className="cursor-pointer text-2xl"
              onClick={() => {
                if (page + 1 < Math.ceil(displayRows.length / DELTA)) {
                  setPage(page + 1);
                }
              }}
            >
              &gt;
            </a>
          </div>
          <div className="container text-white p-6 grid grid-cols-2 lg:grid-cols-4 gap-4 ">
            {displayRows.length > 0 &&
              displayRows
                .slice(page * DELTA, page * DELTA + DELTA)
                .map((row) => (
                  <li
                    key={row.InvNr}
                    className="list-none border-2 rounded-lg p-3 text-center hover:border-gray-600"
                  >
                    <a
                      className="flex flex-col"
                      href={`${row.Slug}/?search=${searchInput}`}
                    >
                      <img src={row.Thumbnail} alt={row.Titel} />
                      <h2
                        className="pt-2 break-words md:break-normal"
                        style={{ hyphens: "auto" }}
                      >
                        {row.Titel}
                      </h2>
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
