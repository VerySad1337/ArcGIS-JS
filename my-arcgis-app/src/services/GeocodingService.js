import { addressToLocations, locationToAddress } from "@arcgis/core/rest/locator";
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

// An unrestricted reverse geocode returns whatever is nearest of ANY type,
// including a POI/place name (a park, a plaza, a landmark) - and a POI
// candidate carries no postal code of its own, which is what left Postal
// Code showing "N/A" for a point that landed on open ground near a named
// place rather than directly on a building. Restricting to these two
// feature types forces a genuine address-level match - the nearest block/
// building - which always carries a postal code.
//
// These MUST be the SDK's own kebab-case GeocodeFeatureType values
// ("street-address"/"point-address" - see
// @arcgis/core/rest/support/types.d.ts), not the PascalCase names the
// REST API docs use ("StreetAddress"/"PointAddress"). Passing the PascalCase
// form doesn't error - LocationToAddressParameters silently fails to
// serialize it into the outgoing request, so the restriction has no effect
// at all and every reverse geocode keeps matching the nearest POI exactly
// as before. This was the actual cause of a first attempt at this fix
// appearing to do nothing: the "nearest block" still came back as a POI
// (e.g. "Wunderground at Tampines West Open Plaza") with no postal code,
// and its AddNum attribute wasn't a house/block number at all - it was a
// coincidental digit picked up from a numbered street name like "Tampines
// Street 81", which is why an unrelated "81" showed up as the block.
const ADDRESS_FEATURE_TYPES = ["street-address", "point-address"];

// The World Geocoding Service's own reverseGeocode default search radius is
// 100m - fine when the selected point sits right against a building, but a
// point out in a park/plaza/carpark (exactly the "New Century Food House"/
// "Wunderground..." case this is fixing) can easily have no street-address/
// point-address candidate at all within that radius, even though a real
// HDB block is only a short walk further out. Widening just the address-
// restricted search (not the unrestricted fallback below, which is only
// ever a last resort) makes "nearest block" actually reach the nearest
// real block instead of giving up early and falling through to whatever
// POI happens to be closer.
const ADDRESS_SEARCH_DISTANCE = 500;

// Only trust a candidate's AddNum as a real block/house number when it also
// carries a postal code - the two should always co-occur for a genuine
// Singapore address match. A candidate with no postal code (a POI/Locality
// match that slipped through, or anything else non-address-level) gets no
// block reported either, rather than surfacing a misleading digit borrowed
// from an unrelated part of its label.
function addressResultFromCandidate(candidate) {
  if (!candidate?.address) return null;
  const postalCode = candidate.attributes?.Postal || "";
  return {
    address: candidate.address,
    postalCode,
    block: postalCode ? (candidate.attributes?.AddNum || "") : ""
  };
}

async function reverseGeocodeWithEsri(latitude, longitude) {
  const location = {
    type: "point",
    longitude,
    latitude,
    spatialReference: { wkid: 4326 }
  };

  const restricted = await locationToAddress(GEOCODER_URL, {
    location,
    featureTypes: ADDRESS_FEATURE_TYPES,
    distance: ADDRESS_SEARCH_DISTANCE
  });
  const restrictedResult = addressResultFromCandidate(restricted);
  if (restrictedResult?.postalCode) return restrictedResult;

  // No address-level candidate (with a postal code) within the default
  // search radius - fall back to an unrestricted match so something is
  // still shown, rather than reporting nothing at all. Its block is only
  // trusted if it too turns out to carry a postal code (see
  // addressResultFromCandidate above).
  const unrestricted = await locationToAddress(GEOCODER_URL, { location });
  const unrestrictedResult = addressResultFromCandidate(unrestricted);
  if (unrestrictedResult) return unrestrictedResult;

  if (restrictedResult) return restrictedResult;

  throw new Error("No address found for this location");
}

// Same fallback rationale as geocodeWithNominatim above: no API key/token
// needed, used only when Esri fails.
const NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse";

// Nominatim's raw display_name is a flat comma list assembled straight from
// OSM's own admin hierarchy, which for Singapore duplicates the country
// (once as its `state`-level "X Region" tag, again as `country`) and
// surfaces that region tag as if it were a meaningful part of the postal
// address - e.g. "897, Tampines Street 81, Tampines Polyview, Tampines,
// East Region, Singapore, 520897, Singapore". Neither the repeated country
// nor the region division is something a real Singapore mailing address
// includes, so both are stripped before display rather than showing
// display_name verbatim.
function formatNominatimAddress(result) {
  const segments = result.display_name.split(", ");
  const seen = new Set();
  const deduped = segments.filter((segment) => {
    const key = segment.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const state = result.address?.state?.trim();
  const withoutState = state ? deduped.filter((segment) => segment.trim() !== state) : deduped;

  return withoutState.join(", ");
}

async function reverseGeocodeWithNominatim(latitude, longitude) {
  const url = `${NOMINATIM_REVERSE_URL}?format=jsonv2&lat=${latitude}&lon=${longitude}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error("No address found for this location");

  const result = await response.json();
  if (!result || result.error || !result.display_name) throw new Error("No address found for this location");

  return {
    address: formatNominatimAddress(result),
    postalCode: result.address?.postcode || "",
    block: result.address?.house_number || ""
  };
}

// Reverse geocodes a lat/long point to a street address, postal code, and
// nearest block number, mirroring geocodeAddress's Esri-first/Nominatim-
// fallback structure so the two directions of geocoding behave consistently.
export async function reverseGeocodeLocation(latitude, longitude) {
  const { lat, lon } = validateCoordinates(latitude, longitude);

  try {
    return await reverseGeocodeWithEsri(lat, lon);
  } catch (esriError) {
    try {
      return await reverseGeocodeWithNominatim(lat, lon);
    } catch {
      throw esriError;
    }
  }
}
