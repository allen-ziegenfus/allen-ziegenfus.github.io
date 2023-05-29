import { React, useEffect, useState } from "react";

function setSearchState(search) {
  const event = new Event("openSearch");
  window.dispatchEvent(event);
}

export default function SearchNavigation({}) {
  const urlParams = new URLSearchParams(window.location.search);

  const search = urlParams.get("search");
  return (
    search && (
      <div class="my-3">
        <a class="cursor-pointer" onClick={setSearchState}>
          ← Zurück zu Suchergebnissen für {search}
        </a>
      </div>
    )
  );
}
