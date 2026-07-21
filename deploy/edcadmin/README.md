# EDC Admin – Deployment

Helm-Chart zum Betrieb der EDC-Admin-WebUI je EDC-Connector. Die App ist ein BFF
(ASP.NET Core) + DevExtreme-Angular-SPA. Der Management-`X-Api-Key` wird ausschließlich
serverseitig injiziert und erreicht nie den Browser. Zugang per Cookie-Login, öffentlich
erreichbar über nginx-Ingress mit Let's-Encrypt-Zertifikat (cert-manager) und optionaler
IP-Whitelist.

## Voraussetzungen
- nginx-Ingress-Controller + cert-manager mit ClusterIssuer `letsencrypt-prod`
- Image in GHCR: `ghcr.io/swmsconsulting/edcadmin`

## Secrets
Pro Instanz werden zwei Werte benötigt:
- `auth-password` – Login-Passwort der WebUI
- `edc-api-key`   – `X-Api-Key` der EDC Management API

Entweder vom Chart erzeugen lassen (`--set secrets.authPassword=... --set secrets.edcApiKey=...`)
oder ein bestehendes Secret referenzieren (`--set existingSecret=<name>` mit den Keys
`auth-password` und `edc-api-key`).

## Deploy (Beispiel Alice & Bob)
```bash
helm upgrade --install edcadmin-alice deploy/edcadmin \
  -n dataspace -f deploy/edcadmin/values-alice.yaml \
  --set image.tag="$IMAGE_TAG" \
  --set secrets.authPassword="$ALICE_UI_PASSWORD" \
  --set secrets.edcApiKey="$ALICE_EDC_API_KEY"

helm upgrade --install edcadmin-bob deploy/edcadmin \
  -n dataspace -f deploy/edcadmin/values-bob.yaml \
  --set image.tag="$IMAGE_TAG" \
  --set secrets.authPassword="$BOB_UI_PASSWORD" \
  --set secrets.edcApiKey="$BOB_EDC_API_KEY"
```
