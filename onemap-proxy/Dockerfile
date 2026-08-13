FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY server.js ./

# ONEMAP_EMAIL / ONEMAP_PASSWORD are runtime-only env vars (see
# docker-compose.yml) - never baked into this image, so the same image can
# be run against different OneMap accounts per environment without a
# rebuild, same reasoning as the main app's VITE_ARCGIS_* handling.
EXPOSE 4000

CMD ["node", "server.js"]
