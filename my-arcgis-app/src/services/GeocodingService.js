import { addressToLocations } from "@arcgis/core/rest/locator";
import { GEOCODER_URL } from "../config/ArcGISConfiguration.js";

// This app is Singapore-only (its MRT/Tourist Attraction layers only cover
// Singapore), but the ArcGIS World Geocoding Service defaults to a
// worldwide, unbiased search. A bare 6-digit Singapore postal code (e.g.
// "238801") or a short local address with no country name in it is
// ambiguous without locale context, and the World geocoder can fail to
// return any candidate for it at all. Pinning `countryCode` and a
// `location` bias toward Singapore fixes that without changing behavior
// for full, unambiguous addresses.
const SINGAPORE_COUNTRY_CODE = "SGP";
const SINGAPORE_CENTER = { type: "point", longitude: 103.8198, latitude: 1.3521, spatialReference: { wkid: 4326 } };

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

async function geocodeWithEsri(address) {
  const results = await addressToLocations(GEOCODER_URL, {
    address: { SingleLine: address },
    countryCode: SINGAPORE_COUNTRY_CODE,
    location: SINGAPORE_CENTER
  });

  if (!results.length) throw new Error("Location not found");

  return {
    longitude: results[0].location.x,
    latitude: results[0].location.y
  };
}

// Nominatim (OpenStreetMap) requires no API key/token - and therefore has no
// key-rotation burden - unlike OneMap's post-2025-10-01 token auth. It's
// used only as a fallback (not the primary geocoder) because its usage
// policy caps client-side use to 1 request/second and asks that heavier
// traffic run against a self-hosted instance instead.
const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";
const SINGAPORE_ISO_COUNTRY_CODE = "sg";

async function geocodeWithNominatim(address) {
  const url = `${NOMINATIM_SEARCH_URL}?format=jsonv2&limit=1&countrycodes=${SINGAPORE_ISO_COUNTRY_CODE}&q=${encodeURIComponent(address)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("Location not found");

  const results = await response.json();
  if (!results.length) throw new Error("Location not found");

  return {
    longitude: parseFloat(results[0].lon),
    latitude: parseFloat(results[0].lat)
  };
}

export async function geocodeAddress(address) {
  const query = normalizePostalCodeQuery(address);

  try {
    return await geocodeWithEsri(query);
  } catch (esriError) {
    try {
      return await geocodeWithNominatim(query);
    } catch {
      // Surface the original Esri error rather than the fallback's, since
      // Esri is the primary geocoder and its failure is the one worth
      // diagnosing if both fail.
      throw esriError;
    }
  }
}
