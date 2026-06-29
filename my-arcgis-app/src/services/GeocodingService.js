import { addressToLocations } from "@arcgis/core/rest/locator.js";

const GEOCODE_URL =
"https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";

export async function geocodeAddress(address) {
const results = await addressToLocations(
GEOCODE_URL,
{
address: {
SingleLine: address
}
}
);

if (!results.length) {
throw new Error("Location not found");
}

return {
longitude: results[0].location.x,
latitude: results[0].location.y
};
}