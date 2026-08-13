// Singaporeans commonly write a postal code as "S460022" (or lowercase
// "s460022"), not just the bare 6 digits - prefixing a bare digits-only
// input with "S" matches that convention. A query that already has the "S"
// prefix (or isn't a bare 6-digit code at all, e.g. a full address) is left
// untouched and geocoded as-is.
const SIX_DIGIT_POSTAL_CODE = /^\d{6}$/;

function normalizePostalCodeQuery(address) {
  const trimmed = address.trim();
  return SIX_DIGIT_POSTAL_CODE.test(trimmed) ? `S${trimmed}` : trimmed;
}

// OneMap is this app's ONLY geocoder (2026-08) - Esri's World Geocoding
// Service and the OpenStreetMap Nominatim fallback that used to sit behind
// it were both removed, deliberately with no fallback of any kind. A
// failure here surfaces straight to the caller (see ApplicationShell's
// throw-and-toast handlers) rather than silently trying a different
// provider - if OneMap (or onemap-proxy, see below) is down, geocoding is
// down; nothing quietly serves a different provider's answer instead.
//
// Calls onemap-proxy's own /api/onemap/search route (same-origin, via
// nginx.conf's /api/onemap/ reverse-proxy rule) rather than
// onemap.gov.sg's Search API directly (2026-08, full-proxy hardening) - the
// OneMap account token used to be attached to this request client-side
// (see git history's OneMapAuthService.js, now removed), which hid the
// account password but still put the token itself in every browser
// request. onemap-proxy now attaches the token server-side and forwards
// just the query - the token never reaches the browser at all anymore.
export async function geocodeAddress(address) {
  const query = normalizePostalCodeQuery(address);

  const response = await fetch(`/api/onemap/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error("Location not found");

  const data = await response.json();
  const result = data.results?.[0];
  if (!result) throw new Error("Location not found");

  return {
    longitude: parseFloat(result.LONGITUDE),
    latitude: parseFloat(result.LATITUDE)
  };
}

const LATITUDE_RANGE = { min: -90, max: 90 };
const LONGITUDE_RANGE = { min: -180, max: 180 };

function validateCoordinates(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);

  if (!Number.isFinite(lat) || lat < LATITUDE_RANGE.min || lat > LATITUDE_RANGE.max) {
    throw new Error("Latitude must be a number between -90 and 90.");
  }
  if (!Number.isFinite(lon) || lon < LONGITUDE_RANGE.min || lon > LONGITUDE_RANGE.max) {
    throw new Error("Longitude must be a number between -180 and 180.");
  }

  return { lat, lon };
}

// OneMap represents "no value" as the literal string "NIL" rather than an
// empty field.
function valueOrEmpty(value) {
  return value && value !== "NIL" ? value : "";
}

// Reverse geocodes a lat/long point to a street address, postal code, and
// nearest block number, via onemap-proxy's own /api/onemap/revgeocode route
// - same "OneMap only, no fallback" rule as geocodeAddress above, and the
// same full-proxy rationale (the token stays server-side in onemap-proxy,
// never reaching the browser).
export async function reverseGeocodeLocation(latitude, longitude) {
  const { lat, lon } = validateCoordinates(latitude, longitude);

  const response = await fetch(`/api/onemap/revgeocode?lat=${lat}&lon=${lon}`);
  if (!response.ok) throw new Error("No address found for this location");

  const data = await response.json();
  const info = data?.GeocodeInfo?.[0];
  if (!info) throw new Error("No address found for this location");

  const building = valueOrEmpty(info.BUILDINGNAME);
  const block = valueOrEmpty(info.BLOCK);
  const road = valueOrEmpty(info.ROAD);
  const postalCode = valueOrEmpty(info.POSTALCODE);
  const blockAndRoad = [block, road].filter(Boolean).join(" ");
  const address = [building, blockAndRoad].filter(Boolean).join(", ") || road;

  return { address, postalCode, block };
}
