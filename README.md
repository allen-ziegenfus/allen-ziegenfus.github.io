# Werkverzeichnis mit Astro

Static site for the Werkverzeichnis, built from a Google Sheet (the rows) and a Google
Drive folder (the images) by `src/werkverzeichnis/sheets.ts`, rendered by Astro.

- Setting up the Sheet, Drive and Google auth: `RUNBOOK-google-setup.md`
- The editor's menu inside the Sheet: `apps-script/README.md`

## Build

```bash
yarn install

# from the Sheet
SHEET_ID=... DRIVE_FOLDER_ID=... yarn build

# from the offline archive, no credentials needed
ROW_SOURCE=csv EXPORT_DIR=../werkverzeichnis-export yarn build
```

`yarn sheets-assets` runs just the data step and writes `public/*.json` and
`public/images/`; `yarn build` runs that and then `astro build` into `dist/`.

Locally, authenticate with `gcloud auth application-default login`. `STRICT=1` turns
data problems into a failed build instead of a published gap.

Drive downloads are cached in `.cache/originals`. A cold build pulls ~3,100 files and
~810 MB, so keep that directory between runs.

## Deploying

Two targets, both from GitHub Actions.

**GitHub Pages** — `.github/workflows/deploy.yml`, on push to `master` plus a nightly
cron. This is production and it uses the `SITE` repo variable.

**Cloudflare Pages** — `.github/workflows/cloudflare.yml`, manual dispatch only. It
takes a `source_ref` input, so any branch can be built and deployed without merging it
first, and a `site` input that overrides `SITE` for that one run.

> Set `site` when dispatching, rather than changing the `SITE` variable. `SITE` is
> shared with the production Pages build — repointing it at a `pages.dev` host would
> put the wrong canonical URLs and sitemap into the real site.

### Creating the Cloudflare project

Needed once. `wrangler` is a devDependency, so `npx wrangler` works after `yarn install`.

```bash
npx wrangler login                    # or set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID

npx wrangler pages project create werkverzeichnis --production-branch=sheets-build
```

The hostname is assigned and need not match the project name — `werkverzeichnis`
became `https://werkverzeichnis-c25.pages.dev/`. The workflow refers to the *project*
name:

```bash
gh variable set CLOUDFLARE_PROJECT_NAME --body "werkverzeichnis"
```

`--production-branch` matters. The workflow deploys with `--branch=<source_ref>`, and
Cloudflare treats any branch that is not the production branch as a *preview* deploy on
its own URL. If production is `master` while you deploy `sheets-build`, the main
`pages.dev` address stays empty and the deploy looks like it failed. Change it when the
branch that should be production changes.

```bash
npx wrangler pages project list
npx wrangler pages deployment list --project-name=werkverzeichnis
```

### Repo configuration

Variables (`gh variable list`):

| name | used for |
|---|---|
| `SITE`, `WEBSITE_TITLE`, `WEBSITE_TITLE_MOBILE_LINE_1/2`, `COPYRIGHT_AUTHOR` | site chrome |
| `SHEET_ID`, `DRIVE_FOLDER_ID` | where the data is |
| `PROJECT_NUMBER`, `SA` | keyless Google auth, see runbook §7–8 |
| `CLOUDFLARE_PROJECT_NAME` | which Pages project to deploy to |

Secrets (`gh secret list`): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

`ACCESS_TOKEN`, `BASE_ID`, `TABLE_NAME` and `WORKSPACE_ID` are leftovers from Airtable
and can go once the migration is finished.
