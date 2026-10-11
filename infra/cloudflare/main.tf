# Die Cloudflare-Seite einer Seite: das Pages-Projekt, auf das die Builds
# deployen (Direct Upload, ohne Git-Verbindung), und der R2-Bucket, den seine
# Funktion /bilder ausliefert.

resource "cloudflare_r2_bucket" "bilder" {
  account_id = var.konto_id
  name       = var.bilder_bucket
  lifecycle { prevent_destroy = true }
}

locals {
  bindungen = { r2_buckets = { BILDER = { name = cloudflare_r2_bucket.bilder.name } } }
}

resource "cloudflare_pages_project" "seite" {
  account_id        = var.konto_id
  name              = var.pages_projekt
  production_branch = var.produktions_branch
  deployment_configs = {
    production = local.bindungen
    preview    = local.bindungen
  }
  lifecycle { prevent_destroy = true }
}

output "pages_subdomain" {
  value = cloudflare_pages_project.seite.subdomain
}
