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

# Local-model chatbot backend - see mcp-chat-proxy/README.md and
# knowledge/features/chatbot-mcp-system.md. Same "build and push it
# yourself first" step as onemap-proxy above:
#
#   cd mcp-chat-proxy
#   docker build -t erictanbq/mcp-chat-proxy:latest .
#   docker push erictanbq/mcp-chat-proxy:latest
#
# Optional feature: if you don't want it on this deploy, comment out the
# "Starting ollama"/"Starting mcp-chat-proxy" blocks below and set
# VITE_CHAT_ENABLED=false in ENV_FILE so the frontend doesn't render a chat
# panel with nothing behind it.
CHAT_IMAGE="erictanbq/mcp-chat-proxy:latest"
CHAT_CONTAINER_NAME="mcp-chat-proxy"
OLLAMA_IMAGE="ollama/ollama:latest"
OLLAMA_CONTAINER_NAME="ollama"

# nginx.conf's /api/onemap/ and /api/chat/ reverse-proxy rules resolve the
# literal hostnames "onemap-proxy"/"mcp-chat-proxy" - that only resolves if
# every container shares a user-defined Docker network (the default bridge
# network does NOT do container-name DNS the way a user-defined one, or
# docker-compose's own network, does), and only if the *_CONTAINER_NAME
# values above stay exactly what nginx.conf expects. Do not rename one
# without the other.
NETWORK_NAME="arcgis-network"

# All containers read from the SAME env file - each only reads the keys it
# actually needs and ignores the rest (onemap-proxy ignores VITE_ARCGIS_*,
# mcp-chat-proxy ignores ONEMAP_*, etc.), same as arcgis-app only reads its
# own keys. Add ONEMAP_EMAIL/ONEMAP_PASSWORD and OLLAMA_MODEL (plus
# OLLAMA_URL/ARCGIS_PORTAL_URL if you want non-default values - see
# mcp-chat-proxy/README.md) to this file before running this script - see
# docker-compose.yml's own top comment for why account credentials must
# NEVER be VITE_-prefixed (that would bake them into the public frontend
# bundle).
ENV_FILE="$HOME/.env"

# docker-compose.yml fills OLLAMA_URL/ARCGIS_PORTAL_URL with defaults
# (${VAR:-default} substitution, plus translating VITE_ARCGIS_PORTAL_URL ->
# ARCGIS_PORTAL_URL) before the container ever sees them - `docker run
# --env-file` below has no equivalent substitution, so mcp-chat-proxy's
# config.js sees a truly-missing var and refuses to start if ENV_FILE
# leaves either blank. Source ENV_FILE into this script's own shell (set -a
# exports every assignment) so the same ${VAR:-default} fallback used in
# docker-compose.yml can be replicated here as -e overrides layered on top
# of --env-file (see the mcp-chat-proxy run args below).
set -a
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && source "$ENV_FILE"
set +a

echo "==> Ensuring the shared Docker network exists: $NETWORK_NAME"
docker network create "$NETWORK_NAME" 2>/dev/null || echo "   (network already exists)"

echo "==> Pulling latest images"
docker pull "$ONEMAP_IMAGE"
docker pull "$CHAT_IMAGE"
docker pull "$OLLAMA_IMAGE"
docker pull "$IMAGE"

echo "==> Stopping old containers (if running)"
docker stop "$ONEMAP_CONTAINER_NAME" 2>/dev/null || echo "   (no running $ONEMAP_CONTAINER_NAME container to stop)"
docker stop "$CHAT_CONTAINER_NAME" 2>/dev/null || echo "   (no running $CHAT_CONTAINER_NAME container to stop)"
docker stop "$OLLAMA_CONTAINER_NAME" 2>/dev/null || echo "   (no running $OLLAMA_CONTAINER_NAME container to stop)"
docker stop "$CONTAINER_NAME" 2>/dev/null || echo "   (no running $CONTAINER_NAME container to stop)"

echo "==> Removing old containers (if they exist)"
docker rm "$ONEMAP_CONTAINER_NAME" 2>/dev/null || echo "   (no $ONEMAP_CONTAINER_NAME container to remove)"
docker rm "$CHAT_CONTAINER_NAME" 2>/dev/null || echo "   (no $CHAT_CONTAINER_NAME container to remove)"
docker rm "$OLLAMA_CONTAINER_NAME" 2>/dev/null || echo "   (no $OLLAMA_CONTAINER_NAME container to remove)"
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

# Named volume persists pulled model weights across container recreation,
# same reasoning as docker-compose.yml's ollama-models volume. Not
# published to the host (no -p) - only mcp-chat-proxy talks to it, over the
# shared network, and it isn't reachable from outside this deploy either.
echo "==> Starting ollama container"
ollama_run_args=(run -d --name "$OLLAMA_CONTAINER_NAME" --network "$NETWORK_NAME" -v ollama-models:/root/.ollama --restart unless-stopped "$OLLAMA_IMAGE")
docker "${ollama_run_args[@]}"

# Not published to the host either - same boundary as onemap-proxy.
# mcp-chat-proxy/config.js requires OLLAMA_URL/OLLAMA_MODEL/ARCGIS_PORTAL_URL
# to be set (fails loud otherwise) - OLLAMA_URL/ARCGIS_PORTAL_URL are
# defaulted automatically below if ENV_FILE leaves them blank (see the
# "set -a; source" block above), same as docker-compose.yml does for local
# dev. OLLAMA_MODEL has no default anywhere - it must be set in ENV_FILE.
echo "==> Starting mcp-chat-proxy container"
# -e overrides after --env-file fill in the two vars docker-compose.yml
# used to default for local dev (see the "set -a; source" block above) -
# ENV_FILE can leave OLLAMA_URL/ARCGIS_PORTAL_URL blank or absent, same as
# my-arcgis-app/.env does, and this still starts.
chat_run_args=(
  run -d --name "$CHAT_CONTAINER_NAME" --network "$NETWORK_NAME"
  --env-file "$ENV_FILE"
  -e "OLLAMA_URL=${OLLAMA_URL:-http://ollama:11434}"
  -e "ARCGIS_PORTAL_URL=${ARCGIS_PORTAL_URL:-${VITE_ARCGIS_PORTAL_URL:-https://www.arcgis.com}}"
  --restart unless-stopped "$CHAT_IMAGE"
)
docker "${chat_run_args[@]}"

echo "==> Starting arcgis-react container"
arcgis_run_args=(run -d --name "$CONTAINER_NAME" --network "$NETWORK_NAME" -p "$HOST_PORT:$CONTAINER_PORT" --env-file "$ENV_FILE" --restart unless-stopped "$IMAGE")
docker "${arcgis_run_args[@]}"

echo "==> Deployment complete. Current status:"
docker ps --filter "name=$ONEMAP_CONTAINER_NAME" --filter "name=$OLLAMA_CONTAINER_NAME" --filter "name=$CHAT_CONTAINER_NAME" --filter "name=$CONTAINER_NAME"

echo ""
echo "==> Recent onemap-proxy logs:"
sleep 2
docker logs --tail 20 "$ONEMAP_CONTAINER_NAME"

echo ""
echo "==> Recent mcp-chat-proxy logs:"
docker logs --tail 20 "$CHAT_CONTAINER_NAME"

echo ""
echo "==> Recent arcgis-react logs:"
docker logs --tail 20 "$CONTAINER_NAME"

echo ""
echo "==> Reminder: pull an Ollama model if you haven't already:"
echo "    docker exec $OLLAMA_CONTAINER_NAME ollama pull <the model set as OLLAMA_MODEL in $ENV_FILE>"
