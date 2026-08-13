// Holds the SLA OneMap account credential (email + password) SERVER-SIDE,
// and exposes exactly one endpoint - GET /api/onemap/token - that hands the
// frontend a short-lived access token to call OneMap's Search/Reverse
// Geocode APIs with.
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
// token in memory, and re-logs-in automatically once the cache is stale -
// the frontend only ever sees the short-lived token, never the password.
//
// Deliberately minimal: one dependency (express), no database, no session
// state beyond the in-memory token cache below. If this process restarts,
// it just re-logs-in on the next request - there's nothing to persist.
const express = require("express");

const ONEMAP_AUTH_URL = "https://www.onemap.gov.sg/api/auth/post/getToken";

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
// lands right at the boundary never hands out a token that's about to die
// mid-flight on the frontend.
const EXPIRY_SAFETY_MARGIN_MS = 5 * 60 * 1000;

// OneMap's own docs describe access tokens as valid for ~3 days. Used only
// as a defensive fallback if the login response's expiry field is ever
// missing or unparseable (see the reverse-geocode endpoint's own
// unverified-at-implementation-time caveat in GeocodingService.js - this
// service was built without being able to render OneMap's JS-SPA docs
// site, so response-shape assumptions here are corroborated from secondary
// sources, not confirmed against the live API) - better to keep serving a
// plausibly-valid cached token than to trust a malformed expiry into
// treating every token as already-expired.
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
  return { token: cachedToken, expiresAt: cachedExpiresAtMs };
}

async function getValidToken() {
  const now = Date.now();
  if (cachedToken && now < cachedExpiresAtMs - EXPIRY_SAFETY_MARGIN_MS) {
    return { token: cachedToken, expiresAt: cachedExpiresAtMs };
  }

  if (!loginPromise) {
    loginPromise = loginToOneMap().finally(() => {
      loginPromise = null;
    });
  }
  return loginPromise;
}

const app = express();

app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

app.get("/api/onemap/token", async (_req, res) => {
  try {
    const { token, expiresAt } = await getValidToken();
    res.json({ token, expiresAt });
  } catch (err) {
    // Logged server-side for operator visibility; the client only ever
    // gets a generic message - never the upstream error body, which could
    // otherwise hint at credential/account details.
    console.error("[onemap-proxy] Failed to obtain a OneMap token:", err.message);
    res.status(502).json({ error: "OneMap authentication is currently unavailable." });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`[onemap-proxy] Listening on port ${PORT}`);
});
