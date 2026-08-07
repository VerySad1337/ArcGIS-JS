import esriConfig from "@arcgis/core/config";

esriConfig.apiKey = import.meta.env.VITE_ARCGIS_API_KEY;

// Portal to search/sign in against. Defaults to ArcGIS Online when unset;
// point this at an Enterprise portal's sharing root
// (e.g. "https://your-enterprise-domain/portal") via .env instead of
// hardcoding it here, so the same build can target different portals per
// environment (dev/staging/prod) without a code change.
export const PORTAL_URL = import.meta.env.VITE_ARCGIS_PORTAL_URL || "https://www.arcgis.com";
if (import.meta.env.VITE_ARCGIS_PORTAL_URL) {
  esriConfig.portalUrl = PORTAL_URL;
}

// OAuth 2.0 application (client) ID registered with the portal above (ArcGIS
// Developer dashboard, or an Enterprise portal's own OAuth app registration).
// Sign-in (see AuthService.js) is entirely optional and only activates when
// this is set - an app with no client ID configured just stays anonymous,
// same as before this feature existed.
export const OAUTH_APP_ID = import.meta.env.VITE_ARCGIS_OAUTH_CLIENT_ID || null;

// Web Map
export const WEBMAP_ID ="e64141e618654205b8e4849c39f23212";

// Web Scene
export const WEBSCENE_ID = "54e3ba44a26243f0867d52bb1cc454fc";

// Routing Service
export const ROUTE_SERVICE_URL ="https://route.arcgis.com/arcgis/rest/services/World/Route/NAServer/Route_World";

// Heatmap Feature Layer
export const HEATMAP_FEATURE_LAYER_URL ="https://services2.arcgis.com/j80Jz20at6Bi0thr/arcgis/rest/services/Tourist_Attractions/FeatureServer";

//MRT Station Feature Layer
export const MRT_STATION_FEATURE_LAYER_URL = "https://services2.arcgis.com/j80Jz20at6Bi0thr/arcgis/rest/services/Rail_Stations/FeatureServer";

//MRT Line Station Feature Layer
export const MRT_LINE_FEATURE_LAYER_URL = "https://services2.arcgis.com/j80Jz20at6Bi0thr/arcgis/rest/services/Rail_Lines/FeatureServer";

//Geocoding Service
export const GEOCODER_URL = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";