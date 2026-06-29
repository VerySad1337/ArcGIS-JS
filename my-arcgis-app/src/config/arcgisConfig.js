import esriConfig from "@arcgis/core/config";

// ArcGIS Enterprise URL (IMPORTANT)
//esriConfig.portalUrl = "https://your-enterprise-domain/portal"; // Set your ArcGIS Enterprise portal URL here
esriConfig.apiKey = import.meta.env.VITE_ARCGIS_API_KEY;

export const ROUTE_SERVICE_URL = "https://route.arcgis.com/arcgis/rest/services/World/Route/NAServer/Route_World"; // Set your ArcGIS Enterprise route service URL here