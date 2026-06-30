import { useState } from "react";
import { geocodeAddress } from "../services/GeocodingService";
import { solveRoute } from "../services/RoutingService";

export function useRoutingEngine() {
  const [routeGeometry, setRouteGeometry] = useState(null);

  const calculateRoute = async (start, end) => {
    const s = await geocodeAddress(start);
    const e = await geocodeAddress(end);
    const route = await solveRoute({
      type: "features",
      features: [
        { geometry: s },
        { geometry: e }
      ]
    });
    setRouteGeometry(route.routeResults[0].route.geometry);
  };
  return { routeGeometry, calculateRoute };
}