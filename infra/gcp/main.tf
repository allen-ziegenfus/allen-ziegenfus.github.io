# Das Google-Cloud-Projekt einer Seite: Firestore, der Bucket der Originale, die
# Servicekonten und was jedes darf, die Secrets (Werte kommen von Hand) und der
# Cloud-Build-Trigger. Firestore-Regeln, die Funktionen und die Seite selbst
# werden aus dem Repo deployt (tools/rules_deploy.mjs, firebase deploy, Cloud Build).

locals {
  bucket  = coalesce(var.bucket, "${var.projekt_id}.firebasestorage.app")
  konten  = { for k, v in google_service_account.konto : k => "serviceAccount:${v.email}" }
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

resource "google_firebase_project" "projekt" {
  provider   = google-beta
  depends_on = [google_project_service.api]
}

resource "google_firestore_database" "datenbank" {
  name                    = var.firestore_datenbank
  location_id             = var.region
  type                    = "FIRESTORE_NATIVE"
  database_edition        = "ENTERPRISE"
  delete_protection_state = "DELETE_PROTECTION_ENABLED"
  deletion_policy         = "ABANDON"
  depends_on              = [google_project_service.api]
}

# Originale. Die Bildfunktion erzeugt daraus die Webversionen in R2.
resource "google_storage_bucket" "originale" {
  name                        = local.bucket
  location                    = upper(var.region)
  storage_class               = "REGIONAL"
  uniform_bucket_level_access = false
  lifecycle { prevent_destroy = true }
}

# --- Servicekonten -----------------------------------------------------------

resource "google_service_account" "konto" {
  for_each = {
    werkverzeichnis-build = "Werkverzeichnis build"
    bilder-function       = "Bild-Funktion: Webversionen nach R2"
    publish-function      = "Veröffentlichen: Build starten, Status eintragen"
  }
  account_id   = each.key
  display_name = each.value
}

resource "google_project_iam_member" "rolle" {
  for_each = {
    "build-datastore"   = ["werkverzeichnis-build", "roles/datastore.viewer"]
    "build-logs"        = ["werkverzeichnis-build", "roles/logging.logWriter"]
    "bilder-datastore"  = ["bilder-function", "roles/datastore.user"]
    "bilder-events"     = ["bilder-function", "roles/eventarc.eventReceiver"]
    "bilder-invoker"    = ["bilder-function", "roles/run.invoker"]
    "publish-builds"    = ["publish-function", "roles/cloudbuild.builds.editor"]
    "publish-datastore" = ["publish-function", "roles/datastore.user"]
    "publish-events"    = ["publish-function", "roles/eventarc.eventReceiver"]
    "publish-invoker"   = ["publish-function", "roles/run.invoker"]
  }
  project = var.projekt_id
  member  = local.konten[each.value[0]]
  role    = each.value[1]
}

resource "google_storage_bucket_iam_member" "originale_lesen" {
  for_each = toset(["werkverzeichnis-build", "bilder-function"])
  bucket   = google_storage_bucket.originale.name
  role     = "roles/storage.objectViewer"
  member   = local.konten[each.key]
}

# Die Veröffentlichen-Funktion startet den Trigger, dessen Builds als Build-Konto laufen.
resource "google_service_account_iam_member" "veroeffentlichen_als_build" {
  service_account_id = google_service_account.konto["werkverzeichnis-build"].name
  role               = "roles/iam.serviceAccountUser"
  member             = local.konten["publish-function"]
}

# Storage-Ereignisse erreichen die Bildfunktion über Pub/Sub.
data "google_storage_project_service_account" "gcs" {}

resource "google_project_iam_member" "gcs_ereignisse" {
  project = var.projekt_id
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${data.google_storage_project_service_account.gcs.email_address}"
}

# --- Secrets (Werte: gcloud secrets versions add, siehe BOOTSTRAP.md) --------

resource "google_secret_manager_secret" "geheimnis" {
  for_each  = toset(["r2-access-key-id", "r2-secret-access-key", "cloudflare-pages-token"])
  secret_id = each.key
  replication {
    auto {}
  }
  depends_on = [google_project_service.api]
}

resource "google_secret_manager_secret_iam_member" "leser" {
  for_each = {
    "r2-access-key-id"       = "bilder-function"
    "r2-secret-access-key"   = "bilder-function"
    "cloudflare-pages-token" = "werkverzeichnis-build"
  }
  secret_id = google_secret_manager_secret.geheimnis[each.key].id
  role      = "roles/secretmanager.secretAccessor"
  member    = local.konten[each.value]
}

# --- Bauen und veröffentlichen ------------------------------------------------

resource "google_cloudbuildv2_repository" "repo" {
  name              = replace(var.github_repo, "/", "-")
  location          = var.region
  parent_connection = var.github_verbindung
  remote_uri        = "https://github.com/${var.github_repo}.git"
}

resource "google_cloudbuild_trigger" "seite" {
  name            = "werkverzeichnis-${var.branch}"
  description     = "Seite aus Firestore nach Cloudflare Pages (Push auf ${var.branch} oder Veröffentlichen)"
  location        = var.region
  filename        = "cloudbuild.yaml"
  service_account = google_service_account.konto["werkverzeichnis-build"].id

  repository_event_config {
    repository = google_cloudbuildv2_repository.repo.id
    push {
      branch = "^${var.branch}$"
    }
  }

  substitutions = {
    _SITE                  = var.seiten_url
    _ARTIST                = var.kuenstler
    _FIRESTORE_DATABASE    = var.firestore_datenbank
    _PAGES_PROJECT         = var.pages_projekt
    _CLOUDFLARE_ACCOUNT_ID = var.cloudflare_konto_id
  }
}

# Cloud Build meldet hier jeden Build; gcf/publish.js (buildStatus) hört zu.
resource "google_pubsub_topic" "cloud_builds" {
  name       = "cloud-builds"
  depends_on = [google_project_service.api]
}
