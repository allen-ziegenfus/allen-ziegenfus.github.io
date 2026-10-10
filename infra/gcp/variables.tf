variable "projekt_id" {
  description = "Das GCP-Projekt der Seite."
  type        = string
}

variable "region" {
  type    = string
  default = "europe-west3"
}

variable "kuenstler" {
  description = "Kennung der Künstler:in in Firestore (artists/{kuenstler}); die ARTIST_ID des Builds."
  type        = string
}

variable "firestore_datenbank" {
  type    = string
  default = "werkverzeichnis"
}

variable "bucket" {
  description = "Bucket der Originale. Null: <projekt>.firebasestorage.app, den Firebase anlegt."
  type        = string
  default     = null
}

variable "github_verbindung" {
  description = "GitHub-Verbindung von Cloud Build, angelegt in der Konsole (braucht eine Anmeldung im Browser)."
  type        = string
}

variable "github_repo" {
  description = "besitzer/name auf GitHub."
  type        = string
}

variable "branch" {
  description = "Branch, den der Trigger baut, und Pages-Branch, auf den er deployt."
  type        = string
}

variable "seiten_url" {
  type = string
}

variable "pages_projekt" {
  description = "Cloudflare-Pages-Projekt, auf das der Build deployt."
  type        = string
}

variable "cloudflare_konto_id" {
  type = string
}
