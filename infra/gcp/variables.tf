variable "project_id" {
  description = "The site's GCP project."
  type        = string
}

variable "region" {
  type    = string
  default = "europe-west3"
}

variable "artist" {
  description = "Firestore artist id (artists/{artist}); the build's ARTIST_ID."
  type        = string
}

variable "firestore_database" {
  type    = string
  default = "werkverzeichnis"
}

variable "bucket" {
  description = "Originals bucket. Null: <project>.firebasestorage.app, the one Firebase creates."
  type        = string
  default     = null
}

variable "github_connection" {
  description = "Cloud Build GitHub connection, created in the console (it needs a browser sign-in)."
  type        = string
}

variable "github_repo" {
  description = "owner/name on GitHub."
  type        = string
}

variable "branch" {
  description = "Branch the trigger builds, and the Pages branch it deploys to."
  type        = string
}

variable "site_url" {
  type = string
}

variable "pages_project" {
  description = "Cloudflare Pages project the build deploys to."
  type        = string
}

variable "cloudflare_account_id" {
  type = string
}
