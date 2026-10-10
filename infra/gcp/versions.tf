# Läuft in Infrastructure Manager, das Terraform bis 1.5.x anbietet.
terraform {
  required_version = ">= 1.5, < 1.6"
  required_providers {
    google      = { source = "hashicorp/google", version = "~> 7.0" }
    google-beta = { source = "hashicorp/google-beta", version = "~> 7.0" }
  }
}

# Das Servicekonto von Infrastructure Manager liegt im Infra-Projekt; die Aufrufe
# werden stattdessen dem Projekt der Seite berechnet (und brauchen dort die APIs).
provider "google" {
  project               = var.projekt_id
  region                = var.region
  user_project_override = true
  billing_project       = var.projekt_id
}

provider "google-beta" {
  project               = var.projekt_id
  region                = var.region
  user_project_override = true
  billing_project       = var.projekt_id
}
