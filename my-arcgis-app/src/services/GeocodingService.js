import { addressToLocations } from "@arcgis/core/rest/locator";
import {GEOCODER_URL} from "../config/ArcGISConfiguration.js";

export async function geocodeAddress(
address
) {
const results =
await addressToLocations(
GEOCODER_URL,
{
address: {
SingleLine: address
}
}
);

if (!results.length) {
throw new Error(
"Location not found"
);
}

return {
longitude:
results[0].location.x,

latitude:
  results[0].location.y

};
}