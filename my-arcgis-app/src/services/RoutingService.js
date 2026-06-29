import { solve } from "@arcgis/core/rest/route.js";
import RouteParameters from "@arcgis/core/rest/support/RouteParameters.js";
import FeatureSet from "@arcgis/core/rest/support/FeatureSet.js";
import Graphic from "@arcgis/core/Graphic.js";
import Point from "@arcgis/core/geometry/Point.js";

import { ROUTE_SERVICE_URL } from "../config/ArcGISConfiguration.js";

export async function solveRoute(start, end) {
const startPoint = new Point({
longitude: start.longitude,
latitude: start.latitude
});

const endPoint = new Point({
longitude: end.longitude,
latitude: end.latitude
});

const params = new RouteParameters({
stops: new FeatureSet({
features: [
new Graphic({
geometry: startPoint
}),
new Graphic({
geometry: endPoint
})
]
}),
returnDirections: true,
returnRoutes: true
});

const result = await solve(
ROUTE_SERVICE_URL,
params
);

if (
!result ||
!result.routeResults ||
result.routeResults.length === 0
) {
throw new Error("No route returned");
}

return result.routeResults[0].route.geometry;
}