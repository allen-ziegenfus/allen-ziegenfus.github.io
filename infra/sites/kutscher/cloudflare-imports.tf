# Was es vor Terraform schon gab; siehe gcp-imports.tf.
import {
  to = cloudflare_r2_bucket.bilder
  id = "cf3fa9a06c8f2e93e24fa3eeaa80b783/werkverzeichnis-bilder/default"
}
import {
  to = cloudflare_pages_project.seite
  id = "cf3fa9a06c8f2e93e24fa3eeaa80b783/werkverzeichnis"
}
