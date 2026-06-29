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

  const viewRef = useRef(null);
  const engineRef = useRef(new GISMapEngine());

  const handleViewReady = (view) => {
    viewRef.current = view;
    engineRef.current.attachToView(view);
  };

  const handleRoute = async (start, end) => {
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
  };

  return (
    <div className="app">

      {/* SIDEBAR */}
      <div className="sidebar">

        <RoutingControlPanel
          is3D={is3D}
          setIs3D={setIs3D}
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