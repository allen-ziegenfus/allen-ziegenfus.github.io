# Was es vor Terraform schon gab. apply.sh fügt diese Datei nur für diese Seite
# zu infra/gcp hinzu; einmal importiert, tun die Blöcke nichts mehr.
import {
  to = google_firebase_project.projekt
  id = "projects/vollrad-werkverzeichnis"
}
import {
  to = google_firestore_database.datenbank
  id = "projects/vollrad-werkverzeichnis/databases/werkverzeichnis"
}
import {
  to = google_storage_bucket.originale
  id = "vollrad-werkverzeichnis.firebasestorage.app"
}
import {
  to = google_service_account.konto["werkverzeichnis-build"]
  id = "projects/vollrad-werkverzeichnis/serviceAccounts/werkverzeichnis-build@vollrad-werkverzeichnis.iam.gserviceaccount.com"
}
import {
  to = google_service_account.konto["bilder-function"]
  id = "projects/vollrad-werkverzeichnis/serviceAccounts/bilder-function@vollrad-werkverzeichnis.iam.gserviceaccount.com"
}
import {
  to = google_secret_manager_secret.geheimnis["r2-access-key-id"]
  id = "projects/vollrad-werkverzeichnis/secrets/r2-access-key-id"
}
import {
  to = google_secret_manager_secret.geheimnis["r2-secret-access-key"]
  id = "projects/vollrad-werkverzeichnis/secrets/r2-secret-access-key"
}
import {
  to = google_secret_manager_secret.geheimnis["cloudflare-pages-token"]
  id = "projects/vollrad-werkverzeichnis/secrets/cloudflare-pages-token"
}
import {
  to = google_cloudbuildv2_repository.repo
  id = "projects/vollrad-werkverzeichnis/locations/europe-west3/connections/Werkverzeichnis/repositories/allen-ziegenfus-allen-ziegenfus.github.io"
}
import {
  to = google_cloudbuild_trigger.seite
  id = "projects/vollrad-werkverzeichnis/locations/europe-west3/triggers/d8ffb15b-b57a-4289-b59b-61b84db79bf9"
}
