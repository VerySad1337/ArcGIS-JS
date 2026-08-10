FROM node:22-alpine AS build

WORKDIR /app

# Build-time variables for Vite. Passed explicitly as ARGs (never via a
# copied .env - see .dockerignore) so the exact same "OAuth is entirely
# optional, on only when a Client ID is supplied" behavior the app has
# outside Docker also applies to a containerized build: leave the OAuth/
# portal args unset and the image builds anonymous-only, same as leaving
# them blank in my-arcgis-app/.env for `npm run dev`/`vite build`.
ARG VITE_ARCGIS_API_KEY
ARG VITE_ARCGIS_OAUTH_CLIENT_ID=""
ARG VITE_ARCGIS_PORTAL_URL=""
ENV VITE_ARCGIS_API_KEY=$VITE_ARCGIS_API_KEY
ENV VITE_ARCGIS_OAUTH_CLIENT_ID=$VITE_ARCGIS_OAUTH_CLIENT_ID
ENV VITE_ARCGIS_PORTAL_URL=$VITE_ARCGIS_PORTAL_URL

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

EXPOSE 443

CMD ["nginx", "-g", "daemon off;"]