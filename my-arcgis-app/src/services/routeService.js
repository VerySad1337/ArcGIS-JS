import * as route from "@arcgis/core/rest/route";
import RouteParameters from "@arcgis/core/rest/support/RouteParameters";
import FeatureSet from "@arcgis/core/rest/support/FeatureSet";
import Graphic from "@arcgis/core/Graphic";

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

  const result = await route.solve(
    ROUTE_SERVICE_URL,
    params
  );

  return result.routeResults[0].route.geometry;
}