# Runs in Infrastructure Manager, which offers Terraform up to 1.5.x.
terraform {
  required_version = ">= 1.5, < 1.6"
  required_providers {
    google      = { source = "hashicorp/google", version = "~> 7.0" }
    google-beta = { source = "hashicorp/google-beta", version = "~> 7.0" }
  }
}

# Infrastructure Manager's service account lives in the infra project; calls
# are billed to (and need APIs enabled in) the site project instead.
provider "google" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}

provider "google-beta" {
  project               = var.project_id
  region                = var.region
  user_project_override = true
  billing_project       = var.project_id
}
