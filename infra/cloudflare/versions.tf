terraform {
  required_version = ">= 1.5, < 1.6"
  required_providers {
    google     = { source = "hashicorp/google", version = "~> 7.0" }
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 5.0" }
  }
}

provider "google" {
  project = var.infra_project
}

# Infrastructure Manager can't be handed a secret, so the token is read from the
# infra project's Secret Manager while Terraform runs (bootstrap.sh stores it).
data "google_secret_manager_secret_version" "cloudflare" {
  secret = "cloudflare-terraform-token"
}

provider "cloudflare" {
  api_token = data.google_secret_manager_secret_version.cloudflare.secret_data
}
