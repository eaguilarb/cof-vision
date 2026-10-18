#!/bin/sh
# Actualiza COF Vision en el VPS con la última versión de GitHub (conserva el modelo y las variables).
# Uso: sh ~/cof/deploy/vps/actualizar.sh
set -e
cd ~/cof
curl -sL https://codeload.github.com/eaguilarb/cof-vision/tar.gz/refs/heads/claude/video-analysis-location-app-ngwv01 \
  | tar xz --strip-components=1 --wildcards '*/server' '*/worker' '*/deploy'
docker compose -f deploy/vps/docker-compose.yml up -d --build
docker compose -f deploy/vps/docker-compose.yml ps
