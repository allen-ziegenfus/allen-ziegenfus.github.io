#!/usr/bin/env bash
# Führt eine Schicht einer Seite über Infrastructure Manager aus, das den
# Terraform-State hält.
#
#   INFRA_PROJECT=<infra-projekt> infra/apply.sh preview|apply gcp|cloudflare <seite>
#
# Das Deployment heißt <seite>-<schicht>. sites/<seite>/<schicht>.tfvars sind die
# Eingaben; sites/<seite>/<schicht>-imports.tf kommt, falls vorhanden, in die
# Kopie der Schicht für diese Seite (einmalige Importe dessen, was es vor
# Terraform schon gab).
set -euo pipefail

befehl=${1:?preview or apply}
schicht=${2:?gcp or cloudflare}
seite=${3:?site, a directory in infra/sites}
: "${INFRA_PROJECT:?set INFRA_PROJECT}"
ORT=${INFRA_LOCATION:-europe-west3}

hier=$(cd "$(dirname "$0")" && pwd)
eltern=projects/$INFRA_PROJECT/locations/$ORT
deployment=$eltern/deployments/$seite-$schicht

arbeit=$(mktemp -d)
trap 'rm -r "${arbeit:?}"' EXIT
mkdir "$arbeit/src"
cp "$hier/$schicht"/*.tf "$arbeit/src/"
[ -f "$hier/sites/$seite/$schicht-imports.tf" ] && cp "$hier/sites/$seite/$schicht-imports.tf" "$arbeit/src/"
cp "$hier/sites/$seite/$schicht.tfvars" "$arbeit/eingaben.tfvars"
[ "$schicht" = cloudflare ] && echo "infra_projekt = \"$INFRA_PROJECT\"" >> "$arbeit/eingaben.tfvars"

argumente=(
  --service-account="projects/$INFRA_PROJECT/serviceAccounts/infra-manager@$INFRA_PROJECT.iam.gserviceaccount.com"
  --local-source="$arbeit/src"
  --inputs-file="$arbeit/eingaben.tfvars"
  --tf-version-constraint=1.5.7
)

case $befehl in
preview)
  vorschau=$eltern/previews/$seite-$schicht-$(date +%Y%m%d-%H%M%S)
  if gcloud infra-manager deployments describe "$deployment" >/dev/null 2>&1; then
    argumente+=(--deployment="$deployment")
  fi
  gcloud infra-manager previews create "$vorschau" "${argumente[@]}"
  # Der Plan steht im Cloud-Build-Log der Vorschau.
  gcloud infra-manager previews describe "$vorschau" --format='yaml(state,errorCode,tfErrors,logs,build)'
  ;;
apply)
  gcloud infra-manager deployments apply "$deployment" "${argumente[@]}"
  ;;
*)
  echo "unknown command: $befehl" >&2; exit 1 ;;
esac
