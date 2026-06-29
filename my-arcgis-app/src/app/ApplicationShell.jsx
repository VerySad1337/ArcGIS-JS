import { useRef, useState } from "react";

import GISMapView from "../components/GISMapView";
import RoutingControlPanel from "../components/RoutingControlPanel";

import { solveRoute } from "../services/RoutingService";
import { geocodeAddress } from "../services/GeocodingService";

import GISMapEngine from "../gis/GISMapEngine";

import {WEBMAP_ID,WEBSCENE_ID} from "../config/ArcGISConfiguration.js";

export default function ApplicationShell() {
const [is3D, setIs3D] = useState(false);

const [routeOn, setRouteOn] = useState(true);

const [heatOn, setHeatOn] = useState(false);

const [heatIntensity, setHeatIntensity] = useState(50);

const viewRef = useRef(null);

const engineRef = useRef(new GISMapEngine());

const handleViewReady = (view) => {
viewRef.current = view;

engineRef.current.attachToView(view);

};

const handleRoute = async (startStr, endStr) => {
try {
const startLoc =
await geocodeAddress(startStr);

  const endLoc =
    await geocodeAddress(endStr);

  const start = {
    type: "point",
    longitude: startLoc.longitude,
    latitude: startLoc.latitude
  };

  const end = {
    type: "point",
    longitude: endLoc.longitude,
    latitude: endLoc.latitude
  };

  const route =
    await solveRoute(start, end);

  console.log(route);
  console.log(route.spatialReference);
    engineRef.current.drawRoute(route);

  engineRef.current.drawStops(
    start,
    end
  );
} catch (err) {
  console.error(
    "Route Error:",
    err
  );
}

};

const toggleRoute = () => {
const newValue = !routeOn;

engineRef.current.toggleRoute(
  newValue
);

setRouteOn(newValue);

};

const toggleHeatmap = () => {
const view = viewRef.current;

if (!view) return;

if (!heatOn) {
  engineRef.current.enableHeatmap(
    view,
    heatIntensity
  );
} else {
  engineRef.current.disableHeatmap();
}

setHeatOn(!heatOn);

};

const updateIntensity = (value) => {
setHeatIntensity(value);

engineRef.current.updateHeatmapIntensity(
  value
);

};

return (
<div className="app">
<RoutingControlPanel is3D={is3D} setIs3D={setIs3D} routeOn={routeOn} toggleRoute={toggleRoute} heatOn={heatOn} toggleHeatmap={toggleHeatmap} heatIntensity={heatIntensity} updateIntensity={updateIntensity} onRoute={handleRoute} />

  <GISMapView
    is3D={is3D}
    webMapId={WEBMAP_ID}
    webSceneId={WEBSCENE_ID}
    onViewReady={handleViewReady}
  />
</div>

);
}