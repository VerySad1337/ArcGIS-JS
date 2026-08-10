#!/bin/bash
set -e

IMAGE="erictanbq/arcgisreact1.0.0:latest"
CONTAINER_NAME="arcgis-react"
ENV_FILE="$HOME/.env"
HOST_PORT=9999
CONTAINER_PORT=443

echo "==> Pulling latest image: $IMAGE"
docker pull "$IMAGE"

echo "==> Stopping old container (if running)"
docker stop "$CONTAINER_NAME" 2>/dev/null || echo "   (no running container to stop)"

echo "==> Removing old container (if exists)"
docker rm "$CONTAINER_NAME" 2>/dev/null || echo "   (no container to remove)"

echo "==> Starting new container"
docker run -d \
  --name "$CONTAINER_NAME" \
  -p "$HOST_PORT:$CONTAINER_PORT" \
  --env-file "$ENV_FILE" \
  --restart unless-stopped \
  "$IMAGE"

echo "==> Deployment complete. Current status:"
docker ps --filter "name=$CONTAINER_NAME"

echo ""
echo "==> Recent logs:"
sleep 2
docker logs --tail 20 "$CONTAINER_NAME"
