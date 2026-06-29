import { useState, useRef } from "react";

import RouteInput from "./components/RouteInput";
import RouteMap from "./components/RouteMap";

import { solveRoute } from "./services/routeService";
import { geocodeAddress } from "./services/geocodeService";

import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";

import FeatureLayer from "@arcgis/core/layers/FeatureLayer";

function App() {
  const [is3D, setIs3D] = useState(false);

  const [routeOn, setRouteOn] = useState(true);
  const [heatOn, setHeatOn] = useState(false);
  const [heatIntensity, setHeatIntensity] = useState(50);

  const viewRef = useRef(null);

  const routeLayerRef = useRef(new GraphicsLayer());
  const stopLayerRef = useRef(new GraphicsLayer());
  const heatLayerRef = useRef(null);

  const webMapId = "e64141e618654205b8e4849c39f23212";
  const webSceneId = "54e3ba44a26243f0867d52bb1cc454fc";

  // ---------------- VIEW READY ----------------
  const handleViewReady = (view) => {
    viewRef.current = view;

    if (!view.map.layers.includes(routeLayerRef.current)) {
      view.map.add(routeLayerRef.current);
      view.map.add(stopLayerRef.current);
    }
  };

  // ---------------- ROUTE ----------------
  const handleRoute = async (startStr, endStr) => {
    try {
      const startLoc = await geocodeAddress(startStr);
      const endLoc = await geocodeAddress(endStr);

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

      const route = await solveRoute(start, end);

      // clear
      routeLayerRef.current.removeAll();
      stopLayerRef.current.removeAll();

      // route line
      routeLayerRef.current.add(
        new Graphic({
          geometry: route,
          symbol: {
            type: "simple-line",
            color: [255, 0, 0],
            width: 6
          }
        })
      );

      // start
      stopLayerRef.current.add(
        new Graphic({
          geometry: start,
          symbol: {
            type: "simple-marker",
            color: "green",
            size: 10
          }
        })
      );

      // end
      stopLayerRef.current.add(
        new Graphic({
          geometry: end,
          symbol: {
            type: "simple-marker",
            color: "red",
            size: 10
          }
        })
      );

    } catch (err) {
      console.error("Route Error:", err);
    }
  };

  // ---------------- ROUTE TOGGLE ----------------
  const toggleRoute = () => {
    routeLayerRef.current.visible = !routeOn;
    stopLayerRef.current.visible = !routeOn;
    setRouteOn(!routeOn);
  };

  // ---------------- HEATMAP (FIXED PROPERLY) ----------------
  const toggleHeatmap = () => {
    const view = viewRef.current;
    if (!view) return;

    if (!heatOn) {
      heatLayerRef.current = new FeatureLayer({
        url: "https://services2.arcgis.com/j80Jz20at6Bi0thr/arcgis/rest/services/Tourist_Attractions/FeatureServer",
          opacity: 0.8,
          renderer: {
          type: "heatmap",
          field: "", // IMPORTANT: leave empty for density heatmap
          colorStops: [
          { ratio: 0, color: "rgba(0,0,255,0)" },
          { ratio: 0.2, color: "blue" },
          { ratio: 0.4, color: "cyan" },
          { ratio: 0.6, color: "lime" },
          { ratio: 0.8, color: "yellow" },
          { ratio: 1, color: "red" }
          ],
          maxPixelIntensity: heatIntensity,
        minPixelIntensity: 0
      }
    });

      view.map.add(heatLayerRef.current);
    } else {
      if (heatLayerRef.current) {
        heatLayerRef.current.renderer = {
      ...heatLayerRef.current.renderer,
      maxPixelIntensity: value
    };
  }
    }

    setHeatOn(!heatOn);
  };

  // ---------------- INTENSITY (FIXED) ----------------
  const updateIntensity = (value) => {
    setHeatIntensity(value);

    if (heatLayerRef.current) {
      heatLayerRef.current.renderer = {
        ...heatLayerRef.current.renderer,
        maxPixelIntensity: value
      };
    }
  };

  // ---------------- UI ----------------
  return (
    <div className="app">

      <div style={{
        position: "absolute",
        top: 10,
        left: 10,
        zIndex: 1000,
        background: "white",
        padding: 8,
        display: "flex",
        gap: 10
      }}>
        <button onClick={() => setIs3D(!is3D)}>
          {is3D ? "2D" : "3D"}
        </button>

        <button onClick={toggleRoute}>
          {routeOn ? "Hide Route" : "Show Route"}
        </button>

        <button onClick={toggleHeatmap}>
          {heatOn ? "Hide Heatmap" : "Show Heatmap"}
        </button>

        <input
          type="range"
          min="1"
          max="100"
          value={heatIntensity}
          onChange={(e) => updateIntensity(Number(e.target.value))}
        />

        <span>{heatIntensity}</span>
      </div>

      <RouteInput onRoute={handleRoute} />

      <RouteMap
        is3D={is3D}
        webMapId={webMapId}
        webSceneId={webSceneId}
        onViewReady={handleViewReady}
      />
    </div>
  );
}

export default App;