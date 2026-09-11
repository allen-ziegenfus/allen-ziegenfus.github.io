# Sheet-side tooling

Two things, both reached from a **Werkverzeichnis** menu in the Sheet.

## Neues Werk (`Form.gs` + `Form.html`)

A sidebar that adds a work and uploads its images. It derives the filenames
(`<slug>-NN.<ext>`) from the Inv. Nr., which is the one rule an editor cannot see and
cannot easily get right by hand.

Before writing anything it applies the build's own uniqueness rules — duplicate URL,
and one slug being a filename prefix of another — so a rejected work leaves the Sheet
and Drive untouched. Only image types the build can decode are accepted; `.pdf` is
refused, which is how the existing 14 image-less works came about.

It runs as **the editor**, so that person needs Editor access to the Drive folder.
The build's service account stays Viewer.

Set the folder once: **Werkverzeichnis → Bilder-Ordner festlegen** (the ID from the
Drive folder URL). New works appear on the site after the next build.

## Daten prüfen (`Validate.gs`)

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
