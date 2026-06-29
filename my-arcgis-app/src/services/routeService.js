import { solve } from "@arcgis/core/rest/route.js";
import RouteParameters from "@arcgis/core/rest/support/RouteParameters.js";
import FeatureSet from "@arcgis/core/rest/support/FeatureSet.js";
import Graphic from "@arcgis/core/Graphic.js";

import { ROUTE_SERVICE_URL } from "../config/arcgisConfig";

export async function solveRoute(start, end) {
  const params = new RouteParameters({
    stops: new FeatureSet({
      features: [
        new Graphic({
          geometry: start
        }),
        new Graphic({
          geometry: end
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

  return result.routeResults[0].route.geometry;
}