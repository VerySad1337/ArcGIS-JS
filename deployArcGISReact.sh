#!/bin/bash
set -e

IMAGE="erictanbq/arcgisreact1.0.0:latest"
CONTAINER_NAME="arcgis-react"
HOST_PORT=9999
CONTAINER_PORT=443

# Holds the OneMap account credential server-side and hands the frontend
# short-lived tokens - see onemap-proxy/server.js's module comment and
# knowledge/index.md's "Geocoder Provider Toggle" section for the full
# rationale. Build and push this image yourself before running this script
# the first time (there is nothing at this tag until you do):
#
#   cd onemap-proxy
#   docker build -t erictanbq/onemap-proxy:latest .
#   docker push erictanbq/onemap-proxy:latest
#
# Update ONEMAP_IMAGE below if you push under a different Docker Hub
# repo/tag.
ONEMAP_IMAGE="erictanbq/onemap-proxy:latest"
ONEMAP_CONTAINER_NAME="onemap-proxy"

# nginx.conf's /api/onemap/ reverse-proxy rule resolves the literal
# hostname "onemap-proxy" (see its `set $onemap_upstream onemap-proxy:4000`
# line) - that only resolves if both containers share a user-defined Docker
# network (the default bridge network does NOT do container-name DNS the
# way a user-defined one, or docker-compose's own network, does), and only
# if ONEMAP_CONTAINER_NAME above stays exactly "onemap-proxy". Do not
# rename one without the other.
NETWORK_NAME="arcgis-network"

# Both containers read from the SAME env file - onemap-proxy only reads the
# ONEMAP_EMAIL/ONEMAP_PASSWORD keys out of it and ignores the rest
# (VITE_ARCGIS_*, etc.), same as arcgis-app only reads its own keys. Add
# ONEMAP_EMAIL/ONEMAP_PASSWORD to this file before running this script -
# see docker-compose.yml's own top comment for why these must NEVER be
# VITE_-prefixed (that would bake the account password into the public
# frontend bundle).
ENV_FILE="$HOME/.env"

echo "==> Ensuring the shared Docker network exists: $NETWORK_NAME"
docker network create "$NETWORK_NAME" 2>/dev/null || echo "   (network already exists)"

echo "==> Pulling latest images"
docker pull "$ONEMAP_IMAGE"
docker pull "$IMAGE"

echo "==> Stopping old containers (if running)"
docker stop "$ONEMAP_CONTAINER_NAME" 2>/dev/null || echo "   (no running $ONEMAP_CONTAINER_NAME container to stop)"
docker stop "$CONTAINER_NAME" 2>/dev/null || echo "   (no running $CONTAINER_NAME container to stop)"

echo "==> Removing old containers (if they exist)"
docker rm "$ONEMAP_CONTAINER_NAME" 2>/dev/null || echo "   (no $ONEMAP_CONTAINER_NAME container to remove)"
docker rm "$CONTAINER_NAME" 2>/dev/null || echo "   (no $CONTAINER_NAME container to remove)"

# Built as arrays, not a single backslash-continued command: a stray \r
# (Windows line ending) after a trailing `\` silently breaks bash's line
# continuation - `docker run -d \` then runs as its own complete command
# with no IMAGE argument, which is exactly the "'docker run' requires at
# least 1 argument" failure this replaced. Arrays have no continuation to
# break, so this is immune to that whole class of transfer/paste corruption
# regardless of line endings.
#
# onemap-proxy starts first and is NOT published to the host (no -p) - only
# arcgis-app's nginx talks to it, over the shared network above, the same
# "not reachable from outside the compose network" boundary
# docker-compose.yml keeps for local dev.
echo "==> Starting onemap-proxy container"
onemap_run_args=(run -d --name "$ONEMAP_CONTAINER_NAME" --network "$NETWORK_NAME" --env-file "$ENV_FILE" --restart unless-stopped "$ONEMAP_IMAGE")
docker "${onemap_run_args[@]}"

echo "==> Starting arcgis-react container"
arcgis_run_args=(run -d --name "$CONTAINER_NAME" --network "$NETWORK_NAME" -p "$HOST_PORT:$CONTAINER_PORT" --env-file "$ENV_FILE" --restart unless-stopped "$IMAGE")
docker "${arcgis_run_args[@]}"

echo "==> Deployment complete. Current status:"
docker ps --filter "name=$ONEMAP_CONTAINER_NAME" --filter "name=$CONTAINER_NAME"

echo ""
echo "==> Recent onemap-proxy logs:"
sleep 2
docker logs --tail 20 "$ONEMAP_CONTAINER_NAME"

echo ""
echo "==> Recent arcgis-react logs:"
docker logs --tail 20 "$CONTAINER_NAME"
