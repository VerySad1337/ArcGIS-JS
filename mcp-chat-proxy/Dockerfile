FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Every OLLAMA_*/ARCGIS_PORTAL_URL/CHAT_* value is a runtime-only env var
# (see docker-compose.yml and README.md's configuration table) - never
# baked into this image, so the same image can point at a different model,
# Ollama host, portal, or tool allow-list per environment with no rebuild.
EXPOSE 4001

CMD ["node", "server.js"]
