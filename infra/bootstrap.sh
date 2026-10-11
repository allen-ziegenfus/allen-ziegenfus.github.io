#!/usr/bin/env bash
# Der Teil, den Infrastructure Manager nicht selbst erledigen kann (BOOTSTRAP.md).
# Kann gefahrlos wiederholt werden: Alles wird geprüft oder ist idempotent.
#
#   infra/bootstrap.sh infra <infra-projekt> [rechnungskonto]
#       das Infra-Projekt, das Servicekonto von Infrastructure Manager und das
#       Cloudflare-Token für Terraform
#   infra/bootstrap.sh add-site <infra-projekt> <seiten-projekt>
#       erlaubt diesem Servicekonto, das Projekt einer Seite zu verwalten
set -euo pipefail

befehl=${1:?infra or add-site}
INFRA=${2:?infra project id}
KONTO=infra-manager@$INFRA.iam.gserviceaccount.com

case $befehl in
infra)
  if ! gcloud projects describe "$INFRA" >/dev/null 2>&1; then
    gcloud projects create "$INFRA" --name="Werkverzeichnis Infra"
  fi
  if [ -n "${3:-}" ]; then
    gcloud billing projects link "$INFRA" --billing-account="$3"
  fi
  gcloud services enable --project="$INFRA" config.googleapis.com cloudbuild.googleapis.com \
    secretmanager.googleapis.com storage.googleapis.com iam.googleapis.com \
    cloudresourcemanager.googleapis.com serviceusage.googleapis.com

  gcloud iam service-accounts describe "$KONTO" --project="$INFRA" >/dev/null 2>&1 \
    || gcloud iam service-accounts create infra-manager --project="$INFRA" \
         --display-name="Infrastructure Manager (Terraform)"
  gcloud projects add-iam-policy-binding "$INFRA" --member="serviceAccount:$KONTO" \
    --role=roles/config.agent --condition=None >/dev/null

  # Pages und R2 bearbeiten (später DNS); nur Terraform liest es, nie ein Build.
  gcloud secrets describe cloudflare-terraform-token --project="$INFRA" >/dev/null 2>&1 \
    || gcloud secrets create cloudflare-terraform-token --project="$INFRA" --replication-policy=automatic
  gcloud secrets add-iam-policy-binding cloudflare-terraform-token --project="$INFRA" \
    --member="serviceAccount:$KONTO" --role=roles/secretmanager.secretAccessor --condition=None >/dev/null
  if [ -z "$(gcloud secrets versions list cloudflare-terraform-token --project="$INFRA" --filter=state=enabled --format='value(name)')" ]; then
    read -rsp "Cloudflare-Token für Terraform (leer = überspringen): " token; echo
    [ -n "$token" ] && printf %s "$token" | gcloud secrets versions add cloudflare-terraform-token \
      --project="$INFRA" --data-file=-
  fi
  echo "Infra project $INFRA ready."
  ;;

add-site)
  SEITE=${3:?site project id}
  gcloud services enable --project="$SEITE" serviceusage.googleapis.com cloudresourcemanager.googleapis.com
  for rolle in \
    roles/serviceusage.serviceUsageAdmin roles/resourcemanager.projectIamAdmin \
    roles/iam.serviceAccountAdmin roles/iam.serviceAccountUser roles/iam.workloadIdentityPoolAdmin \
    roles/storage.admin roles/secretmanager.admin roles/datastore.owner roles/pubsub.admin \
    roles/cloudbuild.builds.editor roles/cloudbuild.connectionAdmin roles/firebase.admin; do
    gcloud projects add-iam-policy-binding "$SEITE" --member="serviceAccount:$KONTO" \
      --role="$rolle" --condition=None >/dev/null
  done
  echo "$KONTO may now manage $SEITE."
  ;;

*)
  echo "unknown command: $befehl" >&2; exit 1 ;;
esac
