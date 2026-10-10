# Werkverzeichnis: set up the infrastructure

Everything a site needs in Google Cloud and Cloudflare is Terraform in `infra/`,
run by Infrastructure Manager (which keeps the state):

- `infra/gcp`: one site's Google Cloud project (Firestore, originals bucket,
  service accounts and their roles, secrets, the Cloud Build trigger)
- `infra/cloudflare`: its Pages project and R2 bucket
- `infra/sites/<site>/`: that site's inputs (`gcp.tfvars`, `cloudflare.tfvars`)
  and one-time imports of what existed before Terraform

One **infra project** holds the deployments, the Terraform service account and
the Cloudflare Terraform token; each site has its own project. This guide does
the few steps Terraform can't. Open it in Cloud Shell:

```
https://shell.cloud.google.com/cloudshell/editor?cloudshell_git_repo=https://github.com/allen-ziegenfus/allen-ziegenfus.github.io&cloudshell_git_branch=firestore-build&cloudshell_tutorial=infra/BOOTSTRAP.md
```

## 1. The infra project

Pick a project id (globally unique), find your billing account, and run the
bootstrap. It creates the project if needed, enables Infrastructure Manager,
creates the `infra-manager@` service account and the `cloudflare-terraform-token`
secret, and asks for the token's value (empty skips; see step 2).

```sh
gcloud billing accounts list
export INFRA_PROJECT=werkverzeichnis-infra
infra/bootstrap.sh infra $INFRA_PROJECT <billing-account-id>
```

## 2. The Cloudflare token for Terraform

Cloudflare dashboard → My Profile → API Tokens → Create Token → Custom token:

- Account · Cloudflare Pages · Edit
- Account · Workers R2 Storage · Edit
- Account resources: the account the sites are in

Store it (or re-run step 1, which asks if no version exists yet):

```sh
read -rs T && printf %s "$T" | gcloud secrets versions add cloudflare-terraform-token \
  --project=$INFRA_PROJECT --data-file=- && unset T
```

This is a different token from the build's `cloudflare-pages-token` (Pages
deploy only), which lives in the site project.

## 3. A site project

For an **existing** project (vollrad-werkverzeichnis) skip to the last command.
For a **new** site, by hand once, in the console:

1. Create the project and link billing.
2. Firebase console → Add project → choose it. Authentication → Sign-in method →
   Google. Add a web app; its config goes into `src/components/firebaseClient.js`.
3. Cloud Build → Repositories (2nd gen) → Create host connection: GitHub, region
   europe-west3, install the app for the repository only. Don't link the
   repository; Terraform does.
4. Copy `infra/sites/kutscher` to `infra/sites/<site>`, edit both `.tfvars`,
   delete the `*-imports.tf` files.

Then let Terraform manage it:

```sh
infra/bootstrap.sh add-site $INFRA_PROJECT <site-project>
```

## 4. Apply

Preview first; the plan is in the preview's Cloud Build log (the `logs` link).

```sh
infra/apply.sh preview gcp kutscher
infra/apply.sh apply gcp kutscher
```

If Infrastructure Manager isn't offered in europe-west3, add
`INFRA_LOCATION=europe-west1` in front (only where the state is kept; the
resources stay where the tfvars say).

Then the secret values, in the site project (empty after a new apply):

```sh
P=<site-project>
for s in r2-access-key-id r2-secret-access-key cloudflare-pages-token; do
  read -rsp "$s: " T; echo; printf %s "$T" | gcloud secrets versions add $s --project=$P --data-file=-
done; unset T
```

And Cloudflare, once its token is stored:

```sh
infra/apply.sh preview cloudflare kutscher
infra/apply.sh apply cloudflare kutscher
```

## 5. Deploy the app

From the repo, with your own credentials:

```sh
node tools/rules_deploy.mjs                     # Firestore rules (tests first)
(cd gcf && npm ci) && firebase deploy --only functions --project <site-project>
node tools/super_admin.mjs grant <your-email>   # then create the artist in /firestore-test/admin
```

A push to the site's branch builds and deploys it; so does Veröffentlichen.

## Not per-site yet

These still name the Kutscher site in code: `gcf/index.js` and `gcf/publish.js`
(project, trigger), `src/components/firebaseClient.js`, and `tools/*` defaults.
