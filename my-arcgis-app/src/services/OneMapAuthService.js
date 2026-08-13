// Gets a SLA OneMap access token for GeocodingService's OneMap-provider
// calls, WITHOUT the frontend ever holding a OneMap account credential -
// see onemap-proxy/server.js's module comment for the full rationale.
// "Auto obtain" happens here: a caller never provides or manages a token
// itself, it just calls getOneMapToken() and gets a valid one back, fetched
// fresh from our own same-origin proxy endpoint whenever the in-memory
// cache is missing or close to expiry.
const TOKEN_ENDPOINT = "/api/onemap/token";

// Mirrors onemap-proxy/server.js's own EXPIRY_SAFETY_MARGIN_MS - refresh a
// little before the real expiry rather than exactly at it, so a request
// that's mid-flight right at the boundary doesn't get handed a token that
// dies before OneMap answers it.
const EXPIRY_SAFETY_MARGIN_MS = 60 * 1000;

let cachedToken = null;
let cachedExpiresAtMs = 0;
// Coalesces concurrent callers onto one in-flight fetch, same reason
// onemap-proxy/server.js coalesces concurrent logins.
let fetchPromise = null;

async function fetchToken() {
  const response = await fetch(TOKEN_ENDPOINT);
  if (!response.ok) {
    throw new Error("OneMap sign-in is currently unavailable.");
  }

  const { token, expiresAt } = await response.json();
  cachedToken = token;
  cachedExpiresAtMs = expiresAt;
  return cachedToken;
}

export async function getOneMapToken() {
  const now = Date.now();
  if (cachedToken && now < cachedExpiresAtMs - EXPIRY_SAFETY_MARGIN_MS) {
    return cachedToken;
  }

  if (!fetchPromise) {
    fetchPromise = fetchToken().finally(() => {
      fetchPromise = null;
    });
  }
  return fetchPromise;
}

// Lets a caller force a re-fetch after OneMap itself rejects a token as
// invalid/expired despite our cached expiry looking fine (clock skew, a
// token revoked early, etc.) - GeocodingService calls this on a 401 from
// OneMap's Search/Reverse Geocode APIs before giving up.
export function invalidateOneMapToken() {
  cachedToken = null;
  cachedExpiresAtMs = 0;
}
