# Werkverzeichnis mit Astro

Static site for the Werkverzeichnis, rendered by Astro from Firestore. One artist's
data lives under `artists/{artist}`: the site settings on the document itself, and
the Werkgruppen, works, pages and image records in its collections
(`src/werkverzeichnis/catalog.ts`). `src/werkverzeichnis/build_data.ts` turns that
into `public/*.json`, which the pages read.

Images: originals go into the project's Firebase bucket; the image function
(`gcf/`) makes their web versions into R2, and the site serves them at `/bilder/*`
(`functions/bilder`). The build only links to them.

## Build

```bash
yarn install
gcloud auth application-default login
FIRESTORE_PROJECT=vollrad-werkverzeichnis FIRESTORE_DATABASE=werkverzeichnis ARTIST_ID=kutscher yarn build
```

`yarn data` runs just the data step; `yarn build` runs that and then `astro build`
into `dist/`. `STRICT=1` turns data problems (an image not in the bucket, web
versions not made yet, a work in no Werkgruppe) into a failed build.

## Editing and publishing

- `/firestore-test/admin/`: artists, roles, Werkgruppen, pages, Veröffentlichen
- `/firestore-test/bearbeiten/`: works

Who may do what is `firestore.rules` (tested by `tools/rules_test.mjs`, deployed by
`tools/rules_deploy.mjs`); super-admins are set with `tools/super_admin.mjs`.

## Deploying

Cloud Build (`cloudbuild.yaml`) builds a site and deploys it to Cloudflare Pages: on
a push to the site's branch, and when someone presses Veröffentlichen. The
infrastructure, including the trigger, is Terraform in `infra/` (`infra/BOOTSTRAP.md`).
The functions are deployed with `firebase deploy --only functions`.
