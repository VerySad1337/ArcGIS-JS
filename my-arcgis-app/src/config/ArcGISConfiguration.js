import esriConfig from "@arcgis/core/config";

esriConfig.apiKey = import.meta.env.VITE_ARCGIS_API_KEY;
// ArcGIS Enterprise URL (IMPORTANT)
//esriConfig.portalUrl = "https://your-enterprise-domain/portal"; 

// Web Map
export const WEBMAP_ID ="e64141e618654205b8e4849c39f23212";

// Web Scene
export const WEBSCENE_ID = "54e3ba44a26243f0867d52bb1cc454fc";

// Routing Service
export const ROUTE_SERVICE_URL ="https://route.arcgis.com/arcgis/rest/services/World/Route/NAServer/Route_World";

// Heatmap Feature Layer
export const HEATMAP_FEATURE_LAYER_URL ="https://services2.arcgis.com/j80Jz20at6Bi0thr/arcgis/rest/services/Tourist_Attractions/FeatureServer";

export const GEOCODER_URL = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";