#!/usr/bin/env bash
# Runs one layer of one site through Infrastructure Manager, which keeps the
# Terraform state.
#
#   INFRA_PROJECT=<infra-project> infra/apply.sh preview|apply gcp|cloudflare <site>
#
# The deployment is <site>-<layer>. The site's sites/<site>/<layer>.tfvars are
# the inputs; sites/<site>/<layer>-imports.tf, if there, is added to that site's
# copy of the layer (one-time imports of what existed before Terraform).
set -euo pipefail

cmd=${1:?preview or apply}
layer=${2:?gcp or cloudflare}
site=${3:?site, a directory in infra/sites}
: "${INFRA_PROJECT:?set INFRA_PROJECT}"
LOCATION=${INFRA_LOCATION:-europe-west3}

here=$(cd "$(dirname "$0")" && pwd)
parent=projects/$INFRA_PROJECT/locations/$LOCATION
deployment=$parent/deployments/$site-$layer

work=$(mktemp -d)
trap 'rm -r "${work:?}"' EXIT
mkdir "$work/src"
cp "$here/$layer"/*.tf "$work/src/"
[ -f "$here/sites/$site/$layer-imports.tf" ] && cp "$here/sites/$site/$layer-imports.tf" "$work/src/"
cp "$here/sites/$site/$layer.tfvars" "$work/inputs.tfvars"
[ "$layer" = cloudflare ] && echo "infra_project = \"$INFRA_PROJECT\"" >> "$work/inputs.tfvars"

args=(
  --service-account="projects/$INFRA_PROJECT/serviceAccounts/infra-manager@$INFRA_PROJECT.iam.gserviceaccount.com"
  --local-source="$work/src"
  --inputs-file="$work/inputs.tfvars"
  --tf-version-constraint=1.5.7
)

case $cmd in
preview)
  preview=$parent/previews/$site-$layer-$(date +%Y%m%d-%H%M%S)
  if gcloud infra-manager deployments describe "$deployment" >/dev/null 2>&1; then
    args+=(--deployment="$deployment")
  fi
  gcloud infra-manager previews create "$preview" "${args[@]}"
  # The plan is in the preview's Cloud Build log.
  gcloud infra-manager previews describe "$preview" --format='yaml(state,errorCode,tfErrors,logs,build)'
  ;;
apply)
  gcloud infra-manager deployments apply "$deployment" "${args[@]}"
  ;;
*)
  echo "unknown command: $cmd" >&2; exit 1 ;;
esac
