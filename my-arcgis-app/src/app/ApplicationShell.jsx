import { useRef, useState } from "react";

import GISMapView from "../components/GISMapView";
import RoutingControlPanel from "../components/RoutingControlPanel";

import GISMapEngine from "../gis/GISMapEngine";

import { solveRoute } from "../services/RoutingService";
import { geocodeAddress } from "../services/GeocodingService";

import {
  WEBMAP_ID,
  WEBSCENE_ID
} from "../config/ArcGISConfiguration";

export default function ApplicationShell() {

  const [is3D, setIs3D] = useState(false);

  // ✅ RESTORED STATES (IMPORTANT)
  const [routeOn, setRouteOn] = useState(true);
  const [heatOn, setHeatOn] = useState(false);
  const [heatIntensity, setHeatIntensity] = useState(50);

  const viewRef = useRef(null);
  const engineRef = useRef(new GISMapEngine());

  const handleViewReady = (view) => {
    viewRef.current = view;
    engineRef.current.attachToView(view);
  };

  // ---------------- ROUTE ----------------
  const handleRoute = async (start, end) => {
    try {
      const s = await geocodeAddress(start);
      const e = await geocodeAddress(end);

      const startPoint = {
        type: "point",
        longitude: s.longitude,
        latitude: s.latitude
      };

      const endPoint = {
        type: "point",
        longitude: e.longitude,
        latitude: e.latitude
      };

      const route = await solveRoute(startPoint, endPoint);

      engineRef.current.drawRoute(route);
      engineRef.current.drawStops(startPoint, endPoint);

    } catch (err) {
      console.error("Route Error:", err);
    }
  };

  // ---------------- ROUTE TOGGLE FIX ----------------
  const toggleRoute = () => {
    const newValue = !routeOn;

    engineRef.current.toggleRoute(newValue);

    setRouteOn(newValue);
  };

  // ---------------- HEATMAP TOGGLE FIX ----------------
  const toggleHeatmap = () => {
    const view = viewRef.current;
    if (!view) return;

    const newValue = !heatOn;

    if (newValue) {
      engineRef.current.enableHeatmap(view, heatIntensity);
    } else {
      engineRef.current.disableHeatmap();
    }

    setHeatOn(newValue);
  };

  // ---------------- INTENSITY ----------------
  const updateIntensity = (value) => {
    setHeatIntensity(value);
    engineRef.current.updateHeatmapIntensity(value);
  };

  return (
    <div className="app">

      {/* SIDEBAR */}
      <div className="sidebar">

        <RoutingControlPanel
          is3D={is3D}
          setIs3D={setIs3D}
          routeOn={routeOn}
          toggleRoute={toggleRoute}
          heatOn={heatOn}
          toggleHeatmap={toggleHeatmap}
          heatIntensity={heatIntensity}
          updateIntensity={updateIntensity}
          onRoute={handleRoute}
        />

      </div>

      {/* MAP */}
      <div className="map-container">

        <GISMapView
          is3D={is3D}
          webMapId={WEBMAP_ID}
          webSceneId={WEBSCENE_ID}
          onViewReady={handleViewReady}
        />

      </div>

    </div>
  );
}