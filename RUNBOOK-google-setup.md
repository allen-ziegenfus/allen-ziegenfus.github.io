# Runbook — moving the Werkverzeichnis onto Google Sheets + Drive

One-time setup to switch the data source from Airtable to a Google Sheet, with images in
Drive, built by GitHub Actions with no stored credentials.

Everything below the Google plumbing is already built and verified: `sheets.ts` reads flat
rows and produces byte-identical output to the Airtable path (37,250 fields compared across
2,142 records, zero differences). What remains is creating the Sheet, filling Drive, and
letting the Action authenticate.

**Time:** about 90 minutes, most of it waiting on the Drive upload.
**Cost:** $0. Sheets, Drive (within the free 15 GB) and Workload Identity Federation are
all free at this size.

---

## Before you start

- A Google account. The Sheet and Drive folder will live in *its* Drive, so use the one
  that should own this data long-term — ideally not a personal account that might lapse.
- A GCP project. Free; no billable service is used. `gcloud` installed and logged in.
- The verified archive, `werkverzeichnis-export/`, checked out next to this repo.

Set these once in your shell — later steps reuse them:

```bash
export PROJECT_ID=werkverzeichnis          # or whatever you name it
export REPO=allen-ziegenfus/allen-ziegenfus.github.io
export SA=werkverzeichnis-build@$PROJECT_ID.iam.gserviceaccount.com
```

---

## 1. Generate the tab data

```bash
python3 tools/make_sheets_csv.py [path/to/werkverzeichnis-export]
```

Writes to `werkverzeichnis-export/sheets/`:

| file | contents |
|---|---|
| `<werkgruppe>.csv` × 12 | 2,144 works, 18 columns |
| `_Übersicht.csv` | the 12 groups, order, cover image |
| `_Seiten.csv` | which prose tabs are published |
| `seite_*.csv` × 6 | the prose itself |

~780 KB, ~38,000 cells. Sheets' ceiling is 10 million, so there is room to grow by two
orders of magnitude.

## 2. Create the Sheet

1. New Google Sheet, named e.g. **Werkverzeichnis Vollrad Kutscher**.
2. For each CSV: **File → Import → Upload**, choose **Insert new sheet**.
3. Rename each tab to match the CSV basename exactly — `objekte`, `grafik`, `_Übersicht`,
   `seite_Biografie`, and so on. **The adapter looks tabs up by name**, so a typo here is
   the single most likely thing to break the build.
4. Delete the default empty `Sheet1`.
5. Note the Sheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/`**`<THIS PART>`**`/edit`

   Keep it out of this repo — it goes in the `SHEET_ID` repo variable in step 8. It is
   not a credential, but it is the whole address of the data, and this repo is public.

Import is manual and tedious once. If you would rather script it, do this step *after*
step 5 and use the service account.

> **Set `Inv. Nr.` and `Jahr` to plain text format** before importing, or Sheets will
> helpfully turn `G0001` into a number and `1990 - 1993` into a date. Select the columns →
> **Format → Number → Plain text**.

## 3. Upload the images to Drive

```
Werkverzeichnis Bilder/          ← share this folder with the service account
  objekte/         g0001-01.webp …
  grafik/
  …
  _covers/         objekte-01.png …
```

Mirror `werkverzeichnis-export/originals/` exactly — one folder per Werkgruppe plus
`_covers`, and the folder names must equal the tab names.

There is no image column in the Sheet. Images are found by convention: `<slug>-NN.<ext>`
in the Werkgruppe's folder, where `<slug>` is the site's slugify of the inventory number.
So adding an image is "drop a correctly named file in the folder", with no edit to the
Sheet at all — and a misnamed file is simply not found. `sheets.ts` reports images that
match no row, and refuses to guess when one slug is a filename prefix of another.

3,105 files, ~810 MB. Drag-and-drop of the folders works; `rclone` is faster and resumable
if the browser upload stalls.

Skip `_unpublished/` unless you intend to publish `Zeit-Werke`.

## 4. Enable the APIs

```bash
gcloud config set project "$PROJECT_ID"
gcloud services enable sheets.googleapis.com drive.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com
```

## 5. Create the service account — with no roles

```bash
gcloud iam service-accounts create werkverzeichnis-build \
  --display-name="Werkverzeichnis build"
```

Deliberately grant it **no project roles**. Its entire access comes from the two Drive
shares in the next step, which is what keeps the blast radius at "can read one spreadsheet
and one folder".

## 6. Share the data with it

In the Google UI, share **both** with `$SA` (print it with `echo $SA`) as **Viewer**:

- the Sheet
- the `Werkverzeichnis Bilder` folder

Viewer, not Editor. The build only ever reads.

## 7. Workload Identity Federation

This is what makes the setup keyless. GitHub issues the workflow a short-lived OIDC token;
GCP trades it for a one-hour access token. Nothing long-lived is stored anywhere.

```bash
export PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

gcloud iam workload-identity-pools create github \
  --location=global --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc repo \
  --location=global --workload-identity-pool=github \
  --display-name="$REPO" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository == '$REPO'"

gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"
```

> ### The one thing you must not get wrong
>
> `--attribute-condition` pins the provider to this repository. **Without it, any GitHub
> repository on the internet can exchange its own OIDC token for your service account.**
> It is a complete authentication bypass and it fails silently — everything works, and the
> door is simply open. This is the classic WIF misconfiguration.
>
> Verify after creating:
>
> ```bash
> gcloud iam workload-identity-pools providers describe repo \
>   --location=global --workload-identity-pool=github \
>   --format='value(attributeCondition)'
> ```
>
> If that prints nothing, stop and fix it before going further.

Note the provider resource path uses the project **number**, not the ID:

```bash
echo "projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/repo"
```

## 8. Point the workflow at it

`.github/workflows/deploy.yml` on this branch already has the `auth` step, the image
cache and `STRICT=1`. What it does not have — deliberately — is any of your identifiers.
Set them as repo variables:

```bash
gh variable set SHEET_ID        --body "<sheet id from step 2>"
gh variable set DRIVE_FOLDER_ID --body "<folder id from the Drive URL>"
gh variable set PROJECT_NUMBER  --body "$PROJECT_NUMBER"
gh variable set SA              --body "$SA"
```

The workflow builds the provider path from `PROJECT_NUMBER`.

The `auth` action writes credentials to disk and exports
`GOOGLE_APPLICATION_CREDENTIALS`, which is what `GoogleAuth` looks for. Nothing
long-lived is stored.

Once this works, **delete the `ACCESS_TOKEN` secret** and revoke the Airtable PAT.

### Building somewhere other than GitHub Actions

A host with no OIDC federation to Google (Vercel, Netlify, a laptop) has nowhere to put
a credentials *file*. For those, `source.ts` also accepts the service account JSON
inline:

```
GOOGLE_CREDENTIALS_JSON={"type":"service_account",...}
```

That is a real, long-lived key — the thing WIF exists to avoid. Create it only for the
host that needs it, put it in that host's secret store, and delete the key when the test
is over. Locally, prefer `gcloud auth application-default login` and set no variable
at all.

## 9. The adapter

Already written — `src/werkverzeichnis/source.ts`, wired into `sheets.ts`. Two
implementations of one interface:

| `ROW_SOURCE` | rows | images |
|---|---|---|
| `google` (default when `SHEET_ID` is set) | Sheets tabs | Drive folders, cached in `.cache/originals` |
| `csv` | `sheets/*.csv` in the archive | `originals/` in the archive |

Nothing below `source` differs between them, which is what makes step 10 a real test
rather than a comparison of two code paths.

Tabs are read as `FORMATTED_VALUE` — the displayed string, not Sheets' interpretation of
it. With the columns set to plain text (step 2) that is what the editor typed, which is
the defence against `G0001` coming back as the number 1.

## 10. Verify before you cut over

Do not trust a clean build. Build from the Sheet, then from the archive, and diff:

```bash
SHEET_ID=... DRIVE_FOLDER_ID=... yarn sheets-assets
cp public/werkgruppen.json /tmp/from-sheet.json

ROW_SOURCE=csv EXPORT_DIR=../werkverzeichnis-export yarn sheets-assets
python3 tools/diff_artifacts.py /tmp/from-sheet.json public/werkgruppen.json
```

Expect **zero** field differences. Anything else means a tab name, a column header or a
filename does not line up.

The archive side of that diff has been run and matches the Airtable-derived artifact
exactly: 2,142 records, 37,250 fields, zero differences, and exactly two fewer records —
the imported header rows `sheets.ts` correctly rejects. The Sheet side has never been
run. Step 10 is where this design is first actually tested.

Then build and look at it:

```bash
yarn astro build && yarn astro preview
```

Check the homepage first: all 12 cards should show real cover images. That single view is
what caught the missing-covers bug that an automated check had declared clean.

## 11. Cut over

1. `build` in `package.json` already runs `sheets-assets`.
2. `STRICT=1` is already set in the workflow, so bad data fails the build.
3. Push, watch the run, confirm the live site.
4. Keep Airtable read-only for a month as a fallback, then export once more and close it.
   The Airtable adapter is not on this branch; it is on `datasource-adapter` if the
   fallback is ever needed.

---

## Failure modes, and what they look like

| symptom | cause |
|---|---|
| `tab "objekte" is empty or misnamed` | tab renamed, or the CSV imported into the wrong sheet |
| every image is a placeholder | Drive folder not shared with `$SA`, or `DRIVE_FOLDER_ID` wrong |
| one group's images are placeholders | subfolder name does not match the tab name |
| `Inv. Nr.` becomes `1` | column not set to plain text before import — step 2 |
| `1990 - 1993` becomes a date | same |
| `permission denied` on the Sheet | shared with the wrong address; `echo $SA` |
| `unable to acquire impersonated credentials` | attribute condition does not match the repo |
| build succeeds, output is subtly wrong | run step 10 — this is why step 10 exists |

## What this does not solve

The images in Drive are the same web-grade `.gif.webp` re-encodes that are in Airtable
today, at ~130 KB average. Migrating them preserves the problem. If the original
photography surfaces, load *that* into Drive instead — keeping the `<slug>-NN.<ext>`
names, the only thing the build looks for, it needs no code change and no Sheet edit.
