import esriConfig from "@arcgis/core/config";

// Runtime config, generated into env-config.js by docker-entrypoint.sh from
// the container's environment at startup (see Dockerfile) - falls back to
// Vite's build-time env for `npm run dev`/`npm run build` outside Docker,
// where window.__ENV__ is just the empty placeholder in public/env-config.js.
const runtimeEnv = (typeof window !== "undefined" && window.__ENV__) || {};
function getEnv(key) {
  return runtimeEnv[key] || import.meta.env[key];
}

// Portal to search/sign in against. Defaults to ArcGIS Online when unset;
// point this at an Enterprise portal's sharing root
// (e.g. "https://your-enterprise-domain/portal") via .env instead of
// hardcoding it here, so the same image can target different portals per
// environment (dev/staging/prod) without a rebuild.
export const PORTAL_URL = getEnv("VITE_ARCGIS_PORTAL_URL") || "https://www.arcgis.com";
if (getEnv("VITE_ARCGIS_PORTAL_URL")) {
  esriConfig.portalUrl = PORTAL_URL;
}

// OAuth 2.0 application (client) ID registered with the portal above (ArcGIS
// Developer dashboard, or an Enterprise portal's own OAuth app registration).
// Sign-in (see AuthService.js) is entirely optional and only activates when
// this is set - an app with no client ID configured just stays anonymous,
// same as before this feature existed.
export const OAUTH_APP_ID = getEnv("VITE_ARCGIS_OAUTH_CLIENT_ID") || null;

// Web Map
export const WEBMAP_ID ="e64141e618654205b8e4849c39f23212";

// Web Scene
export const WEBSCENE_ID = "54e3ba44a26243f0867d52bb1cc454fc";

// Routing Service
export const ROUTE_SERVICE_URL ="https://route.arcgis.com/arcgis/rest/services/World/Route/NAServer/Route_World";

// Tourist Attractions Feature Layer. Heatmap analysis is no longer a
// separate, dedicated layer/service (see knowledge/index.md's Heatmap
// System) - it's a renderer mode any point layer in the layers card can be
// switched into, so there is no HEATMAP_FEATURE_LAYER_URL of its own anymore.
export const TOURIST_ATTRACTIONS_FEATURE_LAYER_URL ="https://services2.arcgis.com/j80Jz20at6Bi0thr/arcgis/rest/services/Tourist_Attractions/FeatureServer";

//MRT Station Feature Layer
export const MRT_STATION_FEATURE_LAYER_URL = "https://services2.arcgis.com/j80Jz20at6Bi0thr/arcgis/rest/services/Rail_Stations/FeatureServer";

//MRT Line Station Feature Layer
export const MRT_LINE_FEATURE_LAYER_URL = "https://services2.arcgis.com/j80Jz20at6Bi0thr/arcgis/rest/services/Rail_Lines/FeatureServer";

// Raster basemaps selectable from the ViewModeToggle basemap picker (2D and
// 3D both use these - `map.basemap = id` accepts the same style ids
// regardless of view type). "default" is not a real Esri basemap id; it
// means "revert to the map/scene item's own configured basemap" - see
// GISMapEngine.js's originalBasemap field and setBasemap. "satellite" is
// raster imagery (the one id IMAGERY_BASEMAP_IDS treats as warranting the 3D
// buildings/exaggeration enhancement - see syncSceneEnhancements); "onemap"
// is SLA OneMap's own tile service (see ONEMAP_TILE_URL_TEMPLATE below).
// Previously also offered Esri's "hybrid"/"streets-vector"/"topo-vector"/
// "osm"/"gray-vector"/"dark-gray-vector" styles - removed (2026-08) to keep
// the picker to just Default/Imagery/OneMap.
export const BASEMAP_OPTIONS = [
  { id: "default", label: "Default" },
  { id: "satellite", label: "Imagery" },
  { id: "onemap", label: "OneMap (Singapore)" }
];

// SLA OneMap's own basemap tiles - the "Default" style of
// https://www.onemap.gov.sg/docs/maps/. Deliberately NOT behind
// esriConfig.apiKeys.scopes/an API key: unlike OneMap's search/reverse-
// geocode APIs (which require a bearer token from /api/auth/post/getToken,
// obtained server-side by onemap-proxy/ - see GeocodingService.js and
// knowledge/index.md's Geocoder Provider Toggle section), the tile endpoint
// is served publicly with no authentication, per OneMap's own docs and
// Terms of Use (which only require showing their logo/attribution, not a
// credential).
// {level}/{col}/{row} are WebTileLayer's own placeholder names for a
// standard Web Mercator XYZ tile scheme - the same z/x/y OneMap's docs
// describe, just ArcGIS's naming for them.
export const ONEMAP_TILE_URL_TEMPLATE = "https://www.onemap.gov.sg/maps/tiles/Default/{level}/{col}/{row}.png";
export const ONEMAP_ATTRIBUTION = "Map data © OneMap, Singapore Land Authority";

// The subset of BASEMAP_OPTIONS that are raster imagery - drives
// syncSceneEnhancements' 3D buildings/exaggeration enhancement, which only
// makes sense draped under photographic imagery, not a vector basemap.
export const IMAGERY_BASEMAP_IDS = ["satellite"];

// Esri's global OpenStreetMap 3D Buildings SceneLayer, draped over the scene
// when an imagery basemap is active in 3D (see GISMapEngine.js's
// syncSceneEnhancements). Like the feature/geocode/route services above,
// basemaps3d.arcgis.com now requires an API key for anonymous access - left
// out of `esriConfig.apiKeys.scopes` below, every request to it came back
// `400 Bad Request` and the layer/layerview failed to load.
export const BUILDINGS_SCENE_LAYER_URL = "https://basemaps3d.arcgis.com/arcgis/rest/services/OpenStreetMap3DBuildings/SceneServer";

// API key, SCOPED to just this app's own known services - never set as the
// blanket `esriConfig.apiKey`.
//
// The ArcGIS JS SDK's request pipeline (request/process.js) checks
// `getApiKey(url)` BEFORE ever consulting IdentityManager for a signed-in
// user's OAuth credential; if `esriConfig.apiKey` (singular) is set, that
// function returns it for literally any "*.arcgis.com" URL with no way to
// exclude one, which includes the portal's own sign-in endpoints
// (`${PORTAL_URL}/sharing/rest/portals/self`, used by AuthService's
// checkSignInStatus/signIn to read the signed-in user's profile). A blanket
// apiKey therefore silently wins over a freshly-obtained OAuth credential on
// every such request - `Portal.load()` authenticates as the API key's own
// app identity, `portal.user` comes back undefined, and sign-in appears to
// succeed (the popup completes, no error is thrown) while never actually
// reporting a signed-in user. This is what caused sign-in to silently do
// nothing after the popup closed (2026-08).
//
// `esriConfig.apiKeys.scopes` is an allow-list instead: the key is attached
// only to requests matching one of these URLs, so portal/sign-in requests
// fall through to IdentityManager as intended. Scope it to exactly the
// services this app actually needs anonymous/public access to.
//
// Trade-off: a portal search result NOT in this list (e.g. an arbitrary
// Living Atlas subscription-only layer added via "Add Layer from Portal")
// no longer gets this key attached automatically - it needs the current
// user to be signed in with their own access instead. See
// knowledge/index.md's Portal Layer System for the full note.
esriConfig.apiKeys = {
  scopes: [
    {
      urls: [
        TOURIST_ATTRACTIONS_FEATURE_LAYER_URL,
        MRT_STATION_FEATURE_LAYER_URL,
        MRT_LINE_FEATURE_LAYER_URL,
        ROUTE_SERVICE_URL,
        BUILDINGS_SCENE_LAYER_URL
      ],
      token: getEnv("VITE_ARCGIS_API_KEY")
    }
  ]
};