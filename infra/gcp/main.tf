# One site's Google Cloud project: Firestore, the originals bucket, the
# service accounts and what each may do, the secrets (values are added by hand),
# and the Cloud Build trigger. Firestore rules, the functions and the site itself
# are deployed from the repo (tools/rules_deploy.mjs, firebase deploy, Cloud Build).

locals {
  bucket = coalesce(var.bucket, "${var.project_id}.firebasestorage.app")
  sa     = { for k, v in google_service_account.sa : k => "serviceAccount:${v.email}" }
}

resource "google_project_service" "api" {
  for_each = toset([
    "artifactregistry", "cloudbuild", "cloudfunctions", "eventarc", "firebase", "firebaserules",
    "firestore", "iam", "iamcredentials", "identitytoolkit", "logging", "pubsub", "run",
    "secretmanager", "storage", "sts",
  ])
  service            = "${each.key}.googleapis.com"
  disable_on_destroy = false
}

resource "google_firebase_project" "this" {
  provider   = google-beta
  depends_on = [google_project_service.api]
}

resource "google_firestore_database" "this" {
  name                    = var.firestore_database
  location_id             = var.region
  type                    = "FIRESTORE_NATIVE"
  database_edition        = "ENTERPRISE"
  delete_protection_state = "DELETE_PROTECTION_ENABLED"
  deletion_policy         = "ABANDON"
  depends_on              = [google_project_service.api]
}

# Originals. The image function makes the web versions into R2.
resource "google_storage_bucket" "originals" {
  name                        = local.bucket
  location                    = upper(var.region)
  storage_class               = "REGIONAL"
  uniform_bucket_level_access = false
  lifecycle { prevent_destroy = true }
}

# --- Service accounts -------------------------------------------------------

resource "google_service_account" "sa" {
  for_each = {
    werkverzeichnis-build = "Werkverzeichnis build"
    bilder-function       = "Bild-Funktion: Webversionen nach R2"
    publish-function      = "Veröffentlichen: Build starten, Status eintragen"
  }
  account_id   = each.key
  display_name = each.value
}

resource "google_project_iam_member" "role" {
  for_each = {
    "build-datastore"    = ["werkverzeichnis-build", "roles/datastore.viewer"]
    "build-logs"         = ["werkverzeichnis-build", "roles/logging.logWriter"]
    "bilder-datastore"   = ["bilder-function", "roles/datastore.user"]
    "bilder-events"      = ["bilder-function", "roles/eventarc.eventReceiver"]
    "bilder-invoker"     = ["bilder-function", "roles/run.invoker"]
    "publish-builds"     = ["publish-function", "roles/cloudbuild.builds.editor"]
    "publish-datastore"  = ["publish-function", "roles/datastore.user"]
    "publish-events"     = ["publish-function", "roles/eventarc.eventReceiver"]
    "publish-invoker"    = ["publish-function", "roles/run.invoker"]
  }
  project = var.project_id
  member  = local.sa[each.value[0]]
  role    = each.value[1]
}

resource "google_storage_bucket_iam_member" "read_originals" {
  for_each = toset(["werkverzeichnis-build", "bilder-function"])
  bucket   = google_storage_bucket.originals.name
  role     = "roles/storage.objectViewer"
  member   = local.sa[each.key]
}

# The publish function runs the trigger, whose builds run as the build account.
resource "google_service_account_iam_member" "publish_acts_as_build" {
  service_account_id = google_service_account.sa["werkverzeichnis-build"].name
  role               = "roles/iam.serviceAccountUser"
  member             = local.sa["publish-function"]
}

# Storage events reach the image function through Pub/Sub.
data "google_storage_project_service_account" "gcs" {}

resource "google_project_iam_member" "gcs_events" {
  project = var.project_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${data.google_storage_project_service_account.gcs.email_address}"
}

# --- Secrets (values: gcloud secrets versions add, see BOOTSTRAP.md) ---------

resource "google_secret_manager_secret" "secret" {
  for_each  = toset(["r2-access-key-id", "r2-secret-access-key", "cloudflare-pages-token"])
  secret_id = each.key
  replication {
    auto {}
  }
  depends_on = [google_project_service.api]
}

resource "google_secret_manager_secret_iam_member" "reader" {
  for_each = {
    "r2-access-key-id"       = "bilder-function"
    "r2-secret-access-key"   = "bilder-function"
    "cloudflare-pages-token" = "werkverzeichnis-build"
  }
  secret_id = google_secret_manager_secret.secret[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = local.sa[each.value]
}

# --- Build and publish ------------------------------------------------------

resource "google_cloudbuildv2_repository" "site" {
  name              = replace(var.github_repo, "/", "-")
  location          = var.region
  parent_connection = var.github_connection
  remote_uri        = "https://github.com/${var.github_repo}.git"
}

resource "google_cloudbuild_trigger" "site" {
  name            = "werkverzeichnis-${var.branch}"
  description     = "Site from Firestore to Cloudflare Pages (push to ${var.branch}, or Veröffentlichen)"
  location        = var.region
  filename        = "cloudbuild.yaml"
  service_account = google_service_account.sa["werkverzeichnis-build"].id

  repository_event_config {
    repository = google_cloudbuildv2_repository.site.id
    push {
      branch = "^${var.branch}$"
    }
  }

  substitutions = {
    _SITE                  = var.site_url
    _ARTIST                = var.artist
    _FIRESTORE_DATABASE    = var.firestore_database
    _PAGES_PROJECT         = var.pages_project
    _CLOUDFLARE_ACCOUNT_ID = var.cloudflare_account_id
  }
}

# Cloud Build reports every build here; gcf/publish.js (buildStatus) listens.
resource "google_pubsub_topic" "cloud_builds" {
  name       = "cloud-builds"
  depends_on = [google_project_service.api]
}
