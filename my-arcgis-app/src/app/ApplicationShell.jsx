import { useRef, useState } from "react";
const TOAST_DURATION_MS = 10000;
import GISMapView from "../components/GISMapView";
import RoutingControlPanel from "../components/RoutingControlPanel";
import LayerControlPanel from "../components/LayerControlPanel";
import GISMapEngine from "../gis/GISMapEngine";
import { solveRoute } from "../services/RoutingService";
import { geocodeAddress } from "../services/GeocodingService";
import { WEBMAP_ID, WEBSCENE_ID } from "../config/ArcGISConfiguration";
import FloatingDrawTools from "../components/FloatingDrawTools";

export default function ApplicationShell() {
  const [is3D, setIs3D] = useState(false);
  const [routeOn, setRouteOn] = useState(true);
  const [heatOn, setHeatOn] = useState(false);
  const [heatIntensity, setHeatIntensity] = useState(50);
  const [layers, setLayers] = useState([]);
  const viewRef = useRef(null);
  const engineRef = useRef(new GISMapEngine());
  const [toast, setToast] = useState("");
  const toastTimeoutRef = useRef(null);

  const showToast = (message) => {
    setToast(message);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToast(""), TOAST_DURATION_MS);
  };

  const refreshLayers = () => {
    const updated = engineRef.current.getLayers();
    setLayers([...updated]);
  };

  const handleViewReady = (view) => {
    viewRef.current = view;
    engineRef.current.attachToView(view);
    refreshLayers();
  };

  const handleRoute = async (start, end) => {
    const s = await geocodeAddress(start);
    const e = await geocodeAddress(end);
    const route = await solveRoute(
      { type: "point", longitude: s.longitude, latitude: s.latitude },
      { type: "point", longitude: e.longitude, latitude: e.latitude }
    );
    engineRef.current.drawRoute(route);
    engineRef.current.drawStops(
      { type: "point", longitude: s.longitude, latitude: s.latitude },
      { type: "point", longitude: e.longitude, latitude: e.latitude }
    );
    refreshLayers();
  };

  const toggleRoute = () => {
    const next = !routeOn;
    engineRef.current.toggleRoute(next);
    setRouteOn(next);
    refreshLayers();
  };

  const toggleHeatmap = () => {
    const next = !heatOn;
    if (next) {
      engineRef.current.enableHeatmap(viewRef.current, heatIntensity);
    } else {
      engineRef.current.disableHeatmap();
    }
    setHeatOn(next);
    refreshLayers();
  };

  const updateIntensity = (value) => {
    setHeatIntensity(value);
    engineRef.current.updateHeatmapIntensity(value);
  };

  const toggleLayer = (id) => {
    engineRef.current.toggleLayer(id);
    refreshLayers();
  };

  const reorderLayer = (from, to) => {
    engineRef.current.reorderLayers(from, to);
    setLayers([...engineRef.current.getLayers()]);
  };

  const drawPoint = () => {
  engineRef.current.startPointDraw();
  };

  const drawLine = () => {
  engineRef.current.startLineDraw();
  };

  const drawPolygon = () => {
  engineRef.current.startPolygonDraw();
  };

  const uploadGeoJSON=async(file)=>{
  if(!file)return;
  console.log("Uploading:", file.name);
  await engineRef.current.uploadGeoJSON(file);
  setLayers([...engineRef.current.getLayers()]);
  };

  const saveGeoJSON = () => {engineRef.current.saveDrawings(showToast);};
  
  return (
    <div className="app">
      <div className="side-panel">
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

        <LayerControlPanel
          layers={layers}
          onToggle={toggleLayer}
          onReorder={reorderLayer}
          heatIntensity={heatIntensity}
          updateIntensity={updateIntensity}
        />
      </div>

      <div className="map-container">
        <GISMapView
          is3D={is3D}
          webMapId={WEBMAP_ID}
          webSceneId={WEBSCENE_ID}
          onViewReady={handleViewReady}
        />
          <FloatingDrawTools
          drawPoint={drawPoint}
          drawLine={drawLine}
          drawPolygon={drawPolygon}
          saveGeoJSON={saveGeoJSON}
          uploadGeoJSON={uploadGeoJSON}
          />
      </div>
      {toast && ( <div className="gis-toast"> {toast} </div> )}
    </div>
  );
}