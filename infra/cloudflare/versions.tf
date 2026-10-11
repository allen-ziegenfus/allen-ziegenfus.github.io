terraform {
  required_version = ">= 1.5, < 1.6"
  required_providers {
    google     = { source = "hashicorp/google", version = "~> 7.0" }
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 5.0" }
  }
}

provider "google" {
  project = var.infra_projekt
}

# Infrastructure Manager kann man kein Secret übergeben, deshalb liest Terraform
# das Token beim Lauf aus dem Secret Manager des Infra-Projekts (bootstrap.sh legt es ab).
data "google_secret_manager_secret_version" "cloudflare" {
  secret = "cloudflare-terraform-token"
}

provider "cloudflare" {
  api_token = data.google_secret_manager_secret_version.cloudflare.secret_data
}
