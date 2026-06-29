FROM node:22-alpine AS build

WORKDIR /app

# Build-time variable for Vite
ARG VITE_ARCGIS_API_KEY
ENV VITE_ARCGIS_API_KEY=$VITE_ARCGIS_API_KEY

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

COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]