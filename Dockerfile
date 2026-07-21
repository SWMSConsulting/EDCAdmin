# syntax=docker/dockerfile:1

# ---- 1) Build the DevExtreme Angular SPA -----------------------------------------------------
FROM node:22 AS frontend
WORKDIR /src
COPY frontend/edc-admin/package*.json ./
RUN npm ci
COPY frontend/edc-admin/ ./
# Inject the DevExtreme license at build time (kept out of git); empty => trial mode.
ARG DEVEXTREME_LICENSE=""
RUN printf "export const DEVEXTREME_LICENSE_KEY = '%s';\n" "$DEVEXTREME_LICENSE" > src/license.ts
RUN npx ng build --configuration production

# ---- 2) Build & publish the .NET BFF ---------------------------------------------------------
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS backend
WORKDIR /src
COPY backend/EdcAdmin.Backend/*.csproj ./
RUN dotnet restore
COPY backend/EdcAdmin.Backend/ ./
# Ship the built SPA inside wwwroot so it is part of the publish output.
RUN rm -rf wwwroot && mkdir wwwroot
COPY --from=frontend /src/dist/edc-admin/browser/ ./wwwroot/
RUN dotnet publish -c Release -o /app --no-restore

# ---- 3) Runtime ------------------------------------------------------------------------------
FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
ENV ASPNETCORE_URLS=http://+:8080
COPY --from=backend /app ./
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "EdcAdmin.Backend.dll"]
