import { useEffect, useState } from "react";
import Document from "flexsearch/src/document";
import { filter, stemmer } from "flexsearch/src/lang/de";
import { Slider } from "@radix-ui/themes";
import { Theme } from "@radix-ui/themes";
import "@radix-ui/themes/styles.css";
import Select from "react-select";

/** Die Suche über alle Werke, als Überlagerung; geöffnet über das Ereignis "openSearch". */
export default function Suche() {
  const parameter = new URLSearchParams(window.location.search);
  const suche = parameter.get("search");
  const JE_SEITE = 24;

  const [suchbegriff, setSuchbegriff] = useState(suche || "");
  const [zeilen, setZeilen] = useState([]);
  const [jahresSpanne, setJahresSpanne] = useState([0, 0]);
  const [eintraege, setEintraege] = useState([]);
  const [gewaehlteJahre, setGewaehlteJahre] = useState([0, 0]);
  const [geladen, setGeladen] = useState(false);
  const [bildVorhanden, setBildVorhanden] = useState(false);
  const [offen, setOffen] = useState(false);
  const [werkgruppen, setWerkgruppen] = useState([]);
  const [gewaehlteWerkgruppe, setGewaehlteWerkgruppe] = useState();
  const [seite, setSeite] = useState(0);
  const [index, setIndex] = useState();
  const [nachInvNr, setNachInvNr] = useState();

  function indexAnlegen(eintraege) {
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

    const zuordnung = {};
    eintraege.forEach((eintrag) => {
      index.add(eintrag);
      zuordnung[eintrag.InvNr] = eintrag;
    });
    return [index, zuordnung];
  }

  function oeffnen() {
    setOffen(true);
  }
  useEffect(() => {
    window.addEventListener("openSearch", oeffnen);
    return () => {
      window.removeEventListener("openSearch", oeffnen);
    };
  }, []);

  useEffect(() => {
    if (offen) {
      document.body.classList.add("overflow-hidden");
    } else {
      document.body.classList.remove("overflow-hidden");
    }
  }, [offen]);

  useEffect(() => {
    async function eintraegeLaden() {
      try {
        const suchDaten = await (await fetch("/searchData.json")).json();
        setEintraege(suchDaten);
        const suchMetadaten = await (await fetch("/searchMetadata.json")).json();
        setJahresSpanne([
          Number(suchMetadaten.MinYear),
          Number(suchMetadaten.MaxYear),
        ]);
        setGewaehlteJahre([
          Number(suchMetadaten.MinYear),
          Number(suchMetadaten.MaxYear),
        ]);
        const alle = { value: "all", label: "Alle" };
        setWerkgruppen([
          alle,
          ...suchMetadaten.Werkgruppen.map((werkgruppe) => ({
            value: werkgruppe.WerkgruppenSlug,
            label: werkgruppe.WerkgruppenTitel,
          })),
        ]);
        setGewaehlteWerkgruppe(alle);
        setGeladen(true);

        const [index, zuordnung] = indexAnlegen(suchDaten);
        setIndex(index);
        setNachInvNr(zuordnung);
      } catch (fehler) {
        console.log(fehler);
      }
    }
    eintraegeLaden();
  }, []);

  useEffect(() => {
    try {
      const jahre = JSON.parse(sessionStorage.getItem("gewaehlteJahre"));
      if (jahre) setGewaehlteJahre(jahre);
      const werkgruppe = JSON.parse(sessionStorage.getItem("gewaehlteWerkgruppe"));
      if (werkgruppe) setGewaehlteWerkgruppe(werkgruppe);
      const bild = sessionStorage.getItem("bildVorhanden");
      if (bild) {
        setBildVorhanden(bild === "true");
      }
    } catch (fehler) {
      sessionStorage.clear();
    }
  }, [geladen, offen]);

  useEffect(() => {
    if (!geladen) return;
    const [vonJahr, bisJahr] = gewaehlteJahre;
    const gefiltert = eintraege.filter(
      (eintrag) =>
        (eintrag.Jahre.length == 0 ||
          eintrag.Jahre.filter((jahr) => jahr >= vonJahr && jahr <= bisJahr)
            .length > 0) &&
        (bildVorhanden ? !eintrag.Thumbnail.includes("placeholder") : true) &&
        (gewaehlteWerkgruppe.value == "all" ||
          gewaehlteWerkgruppe.value == eintrag.WerkgruppeSlug)
    );

    let anzuzeigen = gefiltert;
    anzuzeigen.sort((a, b) => Number(a.Jahr) > Number(b.Jahr));
    if (suchbegriff && index) {
      const [gefilterterIndex] = indexAnlegen(gefiltert);
      const ergebnisse = gefilterterIndex.search(suchbegriff, { enrich: true });

      const rang = { InvNr: 0, Titel: 1, Beschreibung: 2 };

      if (ergebnisse) {
        ergebnisse.sort((a, b) => {
          rang[a.field] - rang[b.field];
        });
        const sortiert = [];
        ergebnisse.forEach((ergebnis) => sortiert.push(...ergebnis.result));
        const eindeutig = sortiert.filter((invNr, pos) => sortiert.indexOf(invNr) == pos);
        anzuzeigen = eindeutig.map((invNr) => nachInvNr[invNr]);
      }
    }

    setSeite(0);
    setZeilen(
      anzuzeigen.map((eintrag) => ({
        Titel: eintrag.Titel,
        Slug: `/${eintrag.WerkgruppeSlug}/${eintrag.Slug}`,
        Thumbnail: eintrag.Thumbnail,
        InvNr: eintrag.InvNr,
      }))
    );
  }, [
    gewaehlteJahre,
    eintraege,
    bildVorhanden,
    suchbegriff,
    gewaehlteWerkgruppe,
    geladen,
  ]);

  return (
    offen &&
    geladen && (
      <div className="text-white fixed top-0 bottom-0 left-0 right-0 bg-black overflow-scroll z-10">
        <div className="max-w-6xl m-auto">
          <input
            className="text-black flex my-5 mx-auto w-1/2 h-10 rounded-lg p-2"
            placeholder="Suchen"
            value={suchbegriff}
            onChange={(e) => setSuchbegriff(e.target.value)}
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
                    defaultValue={gewaehlteJahre}
                    min={Number(jahresSpanne[0])}
                    max={Number(jahresSpanne[1])}
                    onValueChange={(neueJahre) => {
                      setGewaehlteJahre(neueJahre);
                      sessionStorage.setItem("gewaehlteJahre", JSON.stringify(neueJahre));
                    }}
                  ></Slider>
                </Theme>
                <div className="text-white text-center">
                  {gewaehlteJahre[0]} - {gewaehlteJahre[1]}
                </div>
              </div>

              <div className="p-1  text-black flex flex-wrap items-center flex-1">
                <div className="my-1 w-full flex items-center ">
                  <div className="text-white">Werkgruppe:</div>
                  {werkgruppen.length > 0 && (
                    <Select
                      className="m-1 w-full"
                      onChange={(option) => {
                        setGewaehlteWerkgruppe(option);
                        sessionStorage.setItem("gewaehlteWerkgruppe", JSON.stringify(option));
                      }}
                      options={werkgruppen}
                      defaultValue={gewaehlteWerkgruppe}
                    />
                  )}
                </div>
                <div className="flex w-full items-center text-white my-1">
                  <input
                    type="checkbox"
                    id="bildvorhanden"
                    checked={bildVorhanden}
                    onChange={(e) => {
                      setBildVorhanden(e.target.checked);
                      sessionStorage.setItem("bildVorhanden", e.target.checked);
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
              Ergebnisse {suchbegriff && <>für {suchbegriff}</>} von{" "}
              {gewaehlteJahre[0]} - {gewaehlteJahre[1]}{" "}
              {gewaehlteWerkgruppe.value != "all" && (
                <span>in Werkgruppe {gewaehlteWerkgruppe.label}</span>
              )}
              {bildVorhanden && <>&nbsp;wo Bilder vorhanden sind</>}
            </h2>
          </div>

          <div className="p-6 ]ext-center flex items-center justify-evenly gap-2">
            <a
              className="cursor-pointer text-2xl"
              onClick={() => {
                if (seite > 0) {
                  setSeite(seite - 1);
                }
              }}
            >
              &lt;
            </a>
            <div class="text-center">
              {Math.min(seite * JE_SEITE + 1, zeilen.length)} -{" "}
              {Math.min(seite * JE_SEITE + JE_SEITE, zeilen.length)} von{" "}
              {zeilen.length} werden angezeigt
            </div>
            <a
              className="cursor-pointer text-2xl"
              onClick={() => {
                if (seite + 1 < Math.ceil(zeilen.length / JE_SEITE)) {
                  setSeite(seite + 1);
                }
              }}
            >
              &gt;
            </a>
          </div>
          <div className="container text-white p-6 grid grid-cols-2 lg:grid-cols-4 gap-4 ">
            {zeilen.length > 0 &&
              zeilen
                .slice(seite * JE_SEITE, seite * JE_SEITE + JE_SEITE)
                .map((zeile) => (
                  <li
                    key={zeile.InvNr}
                    className="list-none border-2 rounded-lg p-3 text-center hover:border-gray-600"
                  >
                    <a
                      className="flex flex-col"
                      href={`${zeile.Slug}/?search=${suchbegriff}`}
                    >
                      <img src={zeile.Thumbnail} alt={zeile.Titel} />
                      <h2
                        className="pt-2 break-words md:break-normal"
                        style={{ hyphens: "auto" }}
                      >
                        {zeile.Titel}
                      </h2>
                      <h3 className="pt-2">{zeile.InvNr}</h3>
                    </a>
                  </li>
                ))}
          </div>
        </div>
        <button
          onClick={() => setOffen(false)}
          className="absolute right-0 top-0 text-white m-5 text-2xl"
        >
          X
        </button>
      </div>
    )
  );
}
