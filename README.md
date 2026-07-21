# EDC Admin

Produktiv nutzbare Management-WebUI für einen EDC-Connector (Eclipse Dataspace Connector,
tractusx-connector). Ermöglicht Ansicht/Suche des eigenen Katalogs sowie der Kataloge von
Partnern (zu denen Rechte bestehen), Verwaltung von Assets sowie Monitoring von
Vertragsverhandlungen und Transfers.

## Architektur
- **Backend (BFF, C# / ASP.NET Core)** – `backend/EdcAdmin.Backend`
  - Cookie-Login schützt die gesamte App.
  - Reverse-Proxy (YARP) auf die interne EDC Management API; der `X-Api-Key` wird
    **serverseitig** injiziert und erreicht nie den Browser.
  - Hostet die gebaute SPA und liefert `/api/config`, `/healthz`.
- **Frontend (DevExtreme Angular SPA)** – `frontend/edc-admin`
  - Side-Nav-Layout, Views: Katalog, Assets, Verträge, Transfers, Einstellungen.
  - Spricht ausschließlich das BFF an (`/api/edc/*`, `/api/auth/*`).

## Sicherheit
Die WebUI ist für den Betrieb hinter einem HTTPS-Ingress (Let's Encrypt via cert-manager)
gedacht, optional mit IP-Whitelisting am Ingress. Die mächtigen Management-Zugangsdaten
liegen als Kubernetes-Secret nur serverseitig vor.

## Lokale Entwicklung
```bash
# Backend
cd backend/EdcAdmin.Backend
EdcManagement__ApiKey=... Auth__Password=... dotnet run

# Frontend (proxyt /api an das Backend auf :5081)
cd frontend/edc-admin
npx ng serve
```

## Build & Deployment
- Container: multi-stage `Dockerfile` (Node baut die SPA → .NET publish inkl. `wwwroot`).
- CI: `.github/workflows/build.yml` baut & pusht nach `ghcr.io/swmsconsulting/edcadmin`.
- Deployment: Helm-Chart unter `deploy/edcadmin` (siehe `deploy/edcadmin/README.md`).
  Alice und Bob werden – produktivnah – auf **getrennte Cluster** deployed
  (`.github/workflows/deploy.yml`, je eigene Kubeconfig).
