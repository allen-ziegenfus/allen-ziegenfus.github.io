# Werkverzeichnis mit Astro

Statische Seite für das Werkverzeichnis, mit Astro aus Firestore gebaut. Die Daten
einer Künstler:in liegen unter `artists/{artist}`: die Einstellungen der Seite am
Dokument selbst, Werkgruppen, Werke, Seiten und Bildeinträge in seinen Sammlungen
(`src/werkverzeichnis/catalog.ts`). `src/werkverzeichnis/build_data.ts` macht daraus
`public/*.json`, das die Seiten lesen.

Bilder: Originale kommen in den Firebase-Bucket des Projekts; die Bildfunktion
(`gcf/`) erzeugt daraus Webversionen in R2, und die Seite liefert sie unter
`/bilder/*` aus (`functions/bilder`). Der Build verlinkt sie nur.

## Bauen

```bash
yarn install
gcloud auth application-default login
FIRESTORE_PROJECT=vollrad-werkverzeichnis FIRESTORE_DATABASE=werkverzeichnis ARTIST_ID=kutscher yarn build
```

`yarn data` führt nur den Datenschritt aus; `yarn build` den und danach `astro build`
nach `dist/`. Mit `STRICT=1` lassen Datenprobleme (ein Bild fehlt im Bucket,
Webversionen gibt es noch nicht, ein Werk ohne Werkgruppe) den Build scheitern.

## Bearbeiten und veröffentlichen

- `/firestore-test/admin/`: Künstler:innen, Rollen, Werkgruppen, Seiten, Veröffentlichen
- `/firestore-test/bearbeiten/`: Werke

Wer was darf, steht in `firestore.rules` (getestet mit `tools/rules_test.mjs`,
deployt mit `tools/rules_deploy.mjs`); Super-Admins setzt `tools/super_admin.mjs`.

## Deployen

Cloud Build (`cloudbuild.yaml`) baut eine Seite und deployt sie auf Cloudflare Pages:
bei einem Push auf den Branch der Seite und wenn jemand auf Veröffentlichen drückt.
Die Infrastruktur samt Trigger ist Terraform in `infra/` (`infra/BOOTSTRAP.md`). Die
Funktionen werden mit `firebase deploy --only functions` deployt.
