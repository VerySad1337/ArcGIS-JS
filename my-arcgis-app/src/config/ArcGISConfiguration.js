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

//Geocoding Service
export const GEOCODER_URL = "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";

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
        GEOCODER_URL,
        ROUTE_SERVICE_URL
      ],
      token: getEnv("VITE_ARCGIS_API_KEY")
    }
  ]
};