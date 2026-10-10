variable "infra_project" {
  description = "Project holding the Cloudflare Terraform token."
  type        = string
}

variable "account_id" {
  type = string
}

variable "pages_project" {
  type = string
}

variable "production_branch" {
  type = string
}

variable "bilder_bucket" {
  description = "R2 bucket for the web versions, bound to the site as BILDER (functions/bilder)."
  type        = string
}
