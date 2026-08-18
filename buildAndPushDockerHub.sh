#!/bin/bash
set -e

# Builds and pushes all three images this repo publishes to Docker Hub,
# under the same tags deployArcGISReact.sh expects to pull. Run this after
# changing code in my-arcgis-app/, onemap-proxy/, or mcp-chat-proxy/ - env
# var changes alone (OLLAMA_MODEL, OLLAMA_NUM_CTX, etc.) do NOT need a
# rebuild/push, since those are read at container start from $HOME/.env on
# the deploy server, not baked into the image. See knowledge/deployment.md.

ARCGIS_IMAGE="erictanbq/arcgisreact1.0.0:latest"
ONEMAP_IMAGE="erictanbq/onemap-proxy:latest"
CHAT_IMAGE="erictanbq/mcp-chat-proxy:latest"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Checking Docker Hub login"
# docker info's own "Username:" field doesn't populate under the "desktop"
# credential store (Docker Desktop's Windows/macOS credential helper), so
# check the credential helper directly instead - it's what docker push
# actually reads from.
if ! docker-credential-desktop list 2>/dev/null | grep -q "index.docker.io"; then
  echo "    Not logged in - run 'docker login' first."
  exit 1
fi

echo "==> Building $ARCGIS_IMAGE"
docker build -t "$ARCGIS_IMAGE" "$REPO_ROOT"

echo "==> Building $ONEMAP_IMAGE"
docker build -t "$ONEMAP_IMAGE" "$REPO_ROOT/onemap-proxy"

echo "==> Building $CHAT_IMAGE"
docker build -t "$CHAT_IMAGE" "$REPO_ROOT/mcp-chat-proxy"

echo "==> Pushing $ARCGIS_IMAGE"
docker push "$ARCGIS_IMAGE"

echo "==> Pushing $ONEMAP_IMAGE"
docker push "$ONEMAP_IMAGE"

echo "==> Pushing $CHAT_IMAGE"
docker push "$CHAT_IMAGE"

echo "==> Done. Run deployArcGISReact.sh on the server to pull and deploy these."
