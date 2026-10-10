variable "infra_projekt" {
  description = "Projekt mit dem Cloudflare-Token für Terraform."
  type        = string
}

variable "konto_id" {
  type = string
}

variable "pages_projekt" {
  type = string
}

variable "produktions_branch" {
  type = string
}

variable "bilder_bucket" {
  description = "R2-Bucket für die Webversionen, an die Seite gebunden als BILDER (functions/bilder)."
  type        = string
}
