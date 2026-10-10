export function sucheOeffnen() {
  window.dispatchEvent(new CustomEvent("openSearch"));
}

/** „Zurück zu Suchergebnissen“, wenn das Werk aus der Suche geöffnet wurde (?search=…). */
export default function SuchNavigation() {
  const parameter = new URLSearchParams(window.location.search);

  const suche = parameter.get("search");
  return (
    suche !== null && (
      <div class="my-3">
        <a class="cursor-pointer" onClick={sucheOeffnen}>
          ← Zurück zu Suchergebnissen {suche && <>für {suche}</>}
        </a>
      </div>
    )
  );
}
