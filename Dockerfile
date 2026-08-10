FROM node:22-alpine AS build

WORKDIR /app

# VITE_ARCGIS_* config is no longer baked in at build time - it's injected
# at container startup instead (see docker-entrypoint.sh), so the same
# image can be deployed with different values per environment. This build
# stage no longer needs or accepts those as ARGs.

# Copy package files
COPY my-arcgis-app/package*.json ./

# Install dependencies
RUN npm install

# Copy application source
COPY my-arcgis-app/. .

# Build React/Vite application
RUN npm run build

# Production image
FROM nginx:alpine

# Self-signed cert for local HTTPS (see nginx.conf) - generated fresh on
# every image build rather than committed, so there's no dev private key
# sitting in the repo/registry. -subj skips openssl's interactive prompts,
# which would otherwise hang a non-interactive `docker build`.
RUN apk add --no-cache openssl \
    && mkdir -p /etc/nginx/ssl \
    && openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
       -keyout /etc/nginx/ssl/localhost.key \
       -out /etc/nginx/ssl/localhost.crt \
       -subj "/CN=localhost"

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Regenerates env-config.js from the container's environment on every
# start (see docker-entrypoint.sh) - this is what makes VITE_ARCGIS_* a
# runtime value instead of something baked into the image.
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 443

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]