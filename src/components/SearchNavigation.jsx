import { React, useEffect, useState } from "react";

export function setSearchState() {
  const event = new CustomEvent("openSearch");
  window.dispatchEvent(event);
}

export default function SearchNavigation({}) {
  const urlParams = new URLSearchParams(window.location.search);

  const search = urlParams.get("search");
  return (
    search !== null && (
      <div class="my-3">
        <a class="cursor-pointer" onClick={setSearchState}>
          ← Zurück zu Suchergebnissen {search && <>für {search}</>}
        </a>
      </div>
    )
  );
}
