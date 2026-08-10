#!/bin/sh
# Generates dist/env-config.js from the container's environment at startup
# (not build time) so one image can be deployed with different
# VITE_ARCGIS_* values per environment via `docker run --env-file`/
# `-e`/compose `environment:`. See knowledge/deployment.md.
set -eu

CONFIG_FILE="/usr/share/nginx/html/env-config.js"

# Escapes backslashes and double quotes so a value can't break out of the
# JS string literal it's placed into below.
js_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

API_KEY=$(js_escape "${VITE_ARCGIS_API_KEY:-}")
OAUTH_CLIENT_ID=$(js_escape "${VITE_ARCGIS_OAUTH_CLIENT_ID:-}")
PORTAL_URL=$(js_escape "${VITE_ARCGIS_PORTAL_URL:-}")

cat > "$CONFIG_FILE" <<EOF
window.__ENV__ = {
  VITE_ARCGIS_API_KEY: "${API_KEY}",
  VITE_ARCGIS_OAUTH_CLIENT_ID: "${OAUTH_CLIENT_ID}",
  VITE_ARCGIS_PORTAL_URL: "${PORTAL_URL}"
};
EOF

exec "$@"
