#!/usr/bin/env bash
# The part Infrastructure Manager can't do for itself (BOOTSTRAP.md). Safe to
# re-run: everything is checked or idempotent.
#
#   infra/bootstrap.sh infra <infra-project> [billing-account]
#       the infra project, Infrastructure Manager's service account, and the
#       Cloudflare Terraform token
#   infra/bootstrap.sh add-site <infra-project> <site-project>
#       lets that service account manage a site's project
set -euo pipefail

cmd=${1:?infra or add-site}
INFRA=${2:?infra project id}
SA=infra-manager@$INFRA.iam.gserviceaccount.com

case $cmd in
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

  gcloud iam service-accounts describe "$SA" --project="$INFRA" >/dev/null 2>&1 \
    || gcloud iam service-accounts create infra-manager --project="$INFRA" \
         --display-name="Infrastructure Manager (Terraform)"
  gcloud projects add-iam-policy-binding "$INFRA" --member="serviceAccount:$SA" \
    --role=roles/config.agent --condition=None >/dev/null

  # Pages and R2 edit (later DNS); only Terraform reads it, never a build.
  gcloud secrets describe cloudflare-terraform-token --project="$INFRA" >/dev/null 2>&1 \
    || gcloud secrets create cloudflare-terraform-token --project="$INFRA" --replication-policy=automatic
  gcloud secrets add-iam-policy-binding cloudflare-terraform-token --project="$INFRA" \
    --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor --condition=None >/dev/null
  if [ -z "$(gcloud secrets versions list cloudflare-terraform-token --project="$INFRA" --filter=state=enabled --format='value(name)')" ]; then
    read -rsp "Cloudflare Terraform token (empty to skip): " token; echo
    [ -n "$token" ] && printf %s "$token" | gcloud secrets versions add cloudflare-terraform-token \
      --project="$INFRA" --data-file=-
  fi
  echo "Infra project $INFRA ready."
  ;;

add-site)
  SITE=${3:?site project id}
  gcloud services enable --project="$SITE" serviceusage.googleapis.com cloudresourcemanager.googleapis.com
  for role in \
    roles/serviceusage.serviceUsageAdmin roles/resourcemanager.projectIamAdmin \
    roles/iam.serviceAccountAdmin roles/iam.serviceAccountUser roles/iam.workloadIdentityPoolAdmin \
    roles/storage.admin roles/secretmanager.admin roles/datastore.owner roles/pubsub.admin \
    roles/cloudbuild.builds.editor roles/cloudbuild.connectionAdmin roles/firebase.admin; do
    gcloud projects add-iam-policy-binding "$SITE" --member="serviceAccount:$SA" \
      --role="$role" --condition=None >/dev/null
  done
  echo "$SA may now manage $SITE."
  ;;

*)
  echo "unknown command: $cmd" >&2; exit 1 ;;
esac
