# Werkverzeichnis: Infrastruktur einrichten

Alles, was eine Seite in Google Cloud und Cloudflare braucht, ist Terraform in
`infra/`, ausgeführt von Infrastructure Manager (das den State hält):

- `infra/gcp`: das Google-Cloud-Projekt einer Seite (Firestore, Bucket der
  Originale, Servicekonten und Rollen, Secrets, Cloud-Build-Trigger)
- `infra/cloudflare`: ihr Pages-Projekt und ihr R2-Bucket
- `infra/sites/<seite>/`: die Eingaben der Seite (`gcp.tfvars`, `cloudflare.tfvars`)
  und einmalige Importe dessen, was es vor Terraform schon gab

Ein **Infra-Projekt** hält die Deployments, das Terraform-Servicekonto und das
Cloudflare-Token für Terraform; jede Seite hat ihr eigenes Projekt. Diese Anleitung
erledigt die wenigen Schritte, die Terraform nicht kann. In der Cloud Shell öffnen:

```
https://shell.cloud.google.com/cloudshell/editor?cloudshell_git_repo=https://github.com/allen-ziegenfus/allen-ziegenfus.github.io&cloudshell_git_branch=firestore-build&cloudshell_tutorial=infra/BOOTSTRAP.md
```

## 1. Das Infra-Projekt

Eine Projekt-ID wählen (weltweit eindeutig), das Rechnungskonto heraussuchen und
das Bootstrap starten. Es legt das Projekt an, falls nötig, schaltet
Infrastructure Manager ein, legt das Servicekonto `infra-manager@` und das Secret
`cloudflare-terraform-token` an und fragt nach dessen Wert (leer überspringt;
siehe Schritt 2).

```sh
gcloud billing accounts list
export INFRA_PROJECT=werkverzeichnis-infra
infra/bootstrap.sh infra $INFRA_PROJECT <rechnungskonto-id>
```

## 2. Das Cloudflare-Token für Terraform

Cloudflare-Dashboard → My Profile → API Tokens → Create Token → Custom token:

- Account · Cloudflare Pages · Edit
- Account · Workers R2 Storage · Edit
- Account resources: das Konto, in dem die Seiten liegen

Speichern (oder Schritt 1 wiederholen, der fragt, solange es keine Version gibt):

```sh
read -rs T && printf %s "$T" | gcloud secrets versions add cloudflare-terraform-token \
  --project=$INFRA_PROJECT --data-file=- && unset T
```

Das ist ein anderes Token als `cloudflare-pages-token` des Builds (nur Pages
deployen), das im Projekt der Seite liegt.

## 3. Ein Seiten-Projekt

Bei einem **vorhandenen** Projekt (vollrad-werkverzeichnis) direkt zum letzten
Befehl. Für eine **neue** Seite einmal von Hand, in der Konsole:

1. Das Projekt anlegen und das Rechnungskonto verknüpfen.
2. Firebase-Konsole → Projekt hinzufügen → es auswählen. Authentication →
   Sign-in method → Google. Eine Web-App hinzufügen; ihre Konfiguration kommt in
   `src/components/firebaseClient.js`.
3. Cloud Build → Repositories (2nd gen) → Create host connection: GitHub, Region
   europe-west3, die App nur für das Repository installieren. Das Repository nicht
   verknüpfen; das macht Terraform.
4. `infra/sites/kutscher` nach `infra/sites/<seite>` kopieren, beide `.tfvars`
   anpassen, die `*-imports.tf` löschen.

Dann übernimmt Terraform:

```sh
infra/bootstrap.sh add-site $INFRA_PROJECT <seiten-projekt>
```

## 4. Anwenden

Erst die Vorschau; der Plan steht im Cloud-Build-Log der Vorschau (Link `logs`).

```sh
infra/apply.sh preview gcp kutscher
infra/apply.sh apply gcp kutscher
```

Falls Infrastructure Manager in europe-west3 nicht angeboten wird,
`INFRA_LOCATION=europe-west1` davorsetzen (betrifft nur, wo der State liegt; die
Ressourcen bleiben, wo die tfvars sagen).

Dann die Werte der Secrets, im Projekt der Seite (nach einem neuen Apply leer):

```sh
P=<seiten-projekt>
for s in r2-access-key-id r2-secret-access-key cloudflare-pages-token; do
  read -rsp "$s: " T; echo; printf %s "$T" | gcloud secrets versions add $s --project=$P --data-file=-
done; unset T
```

Und Cloudflare, sobald sein Token gespeichert ist:

```sh
infra/apply.sh preview cloudflare kutscher
infra/apply.sh apply cloudflare kutscher
```

## 5. Die Anwendung deployen

Aus dem Repo, mit den eigenen Zugangsdaten:

```sh
node tools/rules_deploy.mjs                     # Firestore-Regeln (vorher die Tests)
(cd gcf && npm ci) && firebase deploy --only functions --project <seiten-projekt>
node tools/super_admin.mjs grant <deine-email>  # dann die Künstler:in in /firestore-test/admin anlegen
```

Ein Push auf den Branch der Seite baut und deployt sie; Veröffentlichen ebenso.

## Noch nicht je Seite

Diese Stellen nennen noch die Kutscher-Seite im Code: `gcf/index.js` und
`gcf/publish.js` (Projekt, Trigger), `src/components/firebaseClient.js` und die
Vorgaben in `tools/*`.
