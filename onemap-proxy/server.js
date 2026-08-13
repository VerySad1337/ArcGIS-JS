// Holds the SLA OneMap account credential (email + password) SERVER-SIDE,
// and proxies the actual Search/Reverse Geocode requests too - the token
// itself never reaches the browser, only the two calls' JSON results do.
//
// Why this exists at all: OneMap's Search/Reverse Geocode APIs (unlike its
// public, keyless basemap tiles - see ArcGISConfiguration.js's
// ONEMAP_TILE_URL_TEMPLATE) require a bearer token minted by POSTing an
// account email+password to OneMap's own login endpoint, and that token
// expires every ~3 days. This app's frontend is a static bundle shipped to
// every visitor's browser - any secret embedded in it (env var, JS
// constant, whatever) is trivially readable via devtools/Network tab, so
// the account password can never live there. This tiny service is the only
// thing in the deployment that holds it: it logs in, caches the resulting
// token in memory, and re-logs-in automatically once the cache is stale.
//
// Full proxy, not just a token-mint endpoint (2026-08). An earlier version
// of this service only exposed GET /api/onemap/token and let the browser
// call OneMap's Search/Reverse Geocode APIs directly with that token
// attached - which hid the password but still put the (shorter-lived,
// lower-privilege, but still real) token in every request the browser made,
// visible in devtools. GeocodingService.js now calls this service's own
// /api/onemap/search and /api/onemap/revgeocode instead of onemap.gov.sg
// directly, and this service attaches the token server-side before
// forwarding - the token never leaves this container at all anymore.
//
// Deliberately minimal: one dependency (express), no database, no session
// state beyond the in-memory token cache below. If this process restarts,
// it just re-logs-in on the next request - there's nothing to persist.
const express = require("express");

const ONEMAP_AUTH_URL = "https://www.onemap.gov.sg/api/auth/post/getToken";
const ONEMAP_SEARCH_URL = "https://www.onemap.gov.sg/api/common/elastic/search";
// Verified live (2026-08) with a real account token against a real point
// (Marina Bay Sands) - both this URL and its GeocodeInfo[] response shape
// matched on the first try. See knowledge/index.md's Routing System section
// for the full verification note.
const ONEMAP_REVGEOCODE_URL = "https://www.onemap.gov.sg/api/public/revgeocode";

const ONEMAP_EMAIL = process.env.ONEMAP_EMAIL;
const ONEMAP_PASSWORD = process.env.ONEMAP_PASSWORD;

// Fail loud at startup rather than silently accepting requests and 500ing
// on every one - the same "missing config should be impossible to miss"
// choice docker-compose.yml's ${VITE_ARCGIS_API_KEY:?missing} already makes
// for the ArcGIS key.
if (!ONEMAP_EMAIL || !ONEMAP_PASSWORD) {
  console.error(
    "[onemap-proxy] ONEMAP_EMAIL and ONEMAP_PASSWORD must both be set - refusing to start with no OneMap credential configured."
  );
  process.exit(1);
}

// Refresh this many ms before the token's real expiry, so a request that
// lands right at the boundary never gets rejected mid-flight by OneMap.
const EXPIRY_SAFETY_MARGIN_MS = 5 * 60 * 1000;

// OneMap's own docs describe access tokens as valid for ~3 days. Used only
// as a defensive fallback if the login response's expiry field is ever
// missing or unparseable - better to keep serving a plausibly-valid cached
// token than to trust a malformed expiry into treating every token as
// already-expired.
const DEFAULT_TOKEN_TTL_MS = 3 * 24 * 60 * 60 * 1000;

let cachedToken = null;
let cachedExpiresAtMs = 0;
// Coalesces concurrent callers onto the same in-flight login instead of
// each firing its own request at OneMap when the cache is simultaneously
// stale for several requests at once.
let loginPromise = null;

async function loginToOneMap() {
  const response = await fetch(ONEMAP_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ONEMAP_EMAIL, password: ONEMAP_PASSWORD })
  });

  if (!response.ok) {
    throw new Error(`OneMap login failed with status ${response.status}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error("OneMap login response had no access_token");
  }

  const expiryFromResponseMs = Number(data.expiry_timestamp) * 1000;
  const expiresAtMs = Number.isFinite(expiryFromResponseMs) && expiryFromResponseMs > Date.now()
    ? expiryFromResponseMs
    : Date.now() + DEFAULT_TOKEN_TTL_MS;

  cachedToken = data.access_token;
  cachedExpiresAtMs = expiresAtMs;
  return cachedToken;
}

async function getValidToken() {
  const now = Date.now();
  if (cachedToken && now < cachedExpiresAtMs - EXPIRY_SAFETY_MARGIN_MS) {
    return cachedToken;
  }

  if (!loginPromise) {
    loginPromise = loginToOneMap().finally(() => {
      loginPromise = null;
    });
  }
  return loginPromise;
}

// Shared by both proxy routes below. Retries once, with a forced-fresh
// token, on a 401 from OneMap - our own cached-expiry bookkeeping can be
// wrong (clock skew, a token revoked early) even when it looks valid, so
// this is the actual source of truth rather than trusting the cache
// blindly. This retry used to live client-side (GeocodingService.js's
// fetchOneMapApi) back when the browser held the token itself; it moved
// here along with the token when the full-proxy design replaced that.
async function fetchOneMapWithAuth(url) {
  const token = await getValidToken();
  let response = await fetch(url, { headers: { Authorization: token } });

  if (response.status === 401) {
    cachedToken = null;
    cachedExpiresAtMs = 0;
    const freshToken = await getValidToken();
    response = await fetch(url, { headers: { Authorization: freshToken } });
  }

  return response;
}

const app = express();

app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

// GeocodingService.js's geocodeAddress calls this instead of OneMap's
// Search API directly - q is the already-normalized query string (postal
// code prefixing etc. still happens client-side in GeocodingService.js,
// since that's presentation logic, not a credential concern). The
// returnGeom/getAddrDetails/pageNum params this app always wants are fixed
// here rather than accepted from the client, keeping OneMap's own API
// shape entirely server-side.
app.get("/api/onemap/search", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!query) {
    res.status(400).json({ error: "Missing required query parameter: q" });
    return;
  }

  try {
    const url = `${ONEMAP_SEARCH_URL}?searchVal=${encodeURIComponent(query)}&returnGeom=Y&getAddrDetails=Y&pageNum=1`;
    const response = await fetchOneMapWithAuth(url);
    const body = await response.json();
    res.status(response.status).json(body);
  } catch (err) {
    console.error("[onemap-proxy] Search request failed:", err.message);
    res.status(502).json({ error: "OneMap search is currently unavailable." });
  }
});

// GeocodingService.js's reverseGeocodeLocation calls this instead of
// OneMap's Reverse Geocode API directly - lat/lon are already-validated
// numbers (GeocodingService.js's own validateCoordinates runs first). The
// buffer/addressType/otherFeatures params this app always wants are fixed
// here, same reasoning as /api/onemap/search above.
app.get("/api/onemap/revgeocode", async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    res.status(400).json({ error: "Missing/invalid required query parameters: lat, lon" });
    return;
  }

  try {
    const url = `${ONEMAP_REVGEOCODE_URL}?location=${lat},${lon}&buffer=200&addressType=All&otherFeatures=N`;
    const response = await fetchOneMapWithAuth(url);
    const body = await response.json();
    res.status(response.status).json(body);
  } catch (err) {
    console.error("[onemap-proxy] Reverse geocode request failed:", err.message);
    res.status(502).json({ error: "OneMap reverse geocode is currently unavailable." });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`[onemap-proxy] Listening on port ${PORT}`);
});
