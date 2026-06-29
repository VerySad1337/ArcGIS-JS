import esriConfig from "@arcgis/core/config";
esriConfig.apiKey = import.meta.env.VITE_ARCGIS_API_KEY;
export const ROUTE_SERVICE_URL = "https://route.arcgis.com/arcgis/rest/services/World/Route/NAServer/Route_World"; // Set your ArcGIS Enterprise route service URL here