# One site's Cloudflare side: the Pages project the builds deploy to (direct
# upload, no Git connection) and the R2 bucket its /bilder function serves.

resource "cloudflare_r2_bucket" "bilder" {
  account_id = var.account_id
  name       = var.bilder_bucket
  lifecycle { prevent_destroy = true }
}

locals {
  bindings = { r2_buckets = { BILDER = { name = cloudflare_r2_bucket.bilder.name } } }
}

resource "cloudflare_pages_project" "site" {
  account_id        = var.account_id
  name              = var.pages_project
  production_branch = var.production_branch
  deployment_configs = {
    production = local.bindings
    preview    = local.bindings
  }
  lifecycle { prevent_destroy = true }
}

output "pages_subdomain" {
  value = cloudflare_pages_project.site.subdomain
}
