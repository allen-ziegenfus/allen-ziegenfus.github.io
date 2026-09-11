# Sheet-side data checks

`Validate.gs` re-runs most of `sheets.ts`'s validation inside the Sheet, so a bad row
is caught while someone is looking at it rather than half an hour later in a failed
build. It reads only the Sheet, writes only a generated `_Prüfung` tab, and changes
nothing in the data.

`sheets.ts` stays authoritative — it is what blocks a publish under `STRICT=1`. If the
two disagree, `sheets.ts` is right and this is stale.

## Install

1. In the Sheet: **Extensions → Apps Script**.
2. Paste `Slugify.gs` and `Validate.gs` in as two files of those names.
3. Save, reload the Sheet.
4. A **Werkverzeichnis** menu appears → **Daten prüfen**.

First run asks for authorisation; it only needs access to this spreadsheet.

`Slugify.gs` is `src/werkverzeichnis/slugify.ts` with its one TypeScript line removed,
so the URLs it computes are identical to the site's. Re-derive it with:

```bash
sed -e 's/^    export function slugify (string : string, options: any) {/function slugify(string, options) {/' \
    -e 's/^    //' src/werkverzeichnis/slugify.ts > apps-script/Slugify.gs
```

## What it does not check

Both need the Drive folder, which the script does not read:

- images that match no row
- a row whose image is missing or cannot be decoded — the 14 `.pdf`-only works

Those still surface only in the build log.
