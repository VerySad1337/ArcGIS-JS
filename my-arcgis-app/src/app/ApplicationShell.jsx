import { useEffect, useRef, useState } from "react";
const TOAST_DURATION_MS = 4000;
import GISMapView from "../components/GISMapView";
import RoutingControlPanel from "../components/RoutingControlPanel";
import LayerControlPanel from "../components/LayerControlPanel";
import GISMapEngine from "../gis/GISMapEngine";
import { solveRoute } from "../services/RoutingService";
import { geocodeAddress } from "../services/GeocodingService";
import { WEBMAP_ID, WEBSCENE_ID } from "../config/ArcGISConfiguration";
import FloatingDrawTools from "../components/FloatingDrawTools";
import FeatureAttributesPanel from "../components/FeatureAttributesPanel";
import Icon from "../components/Icon";

export default function ApplicationShell() {
  const [is3D, setIs3D] = useState(false);
  const [routeOn, setRouteOn] = useState(true);
  const [heatOn, setHeatOn] = useState(false);
  const [heatIntensity, setHeatIntensity] = useState(50);
  const [layers, setLayers] = useState([]);
  const viewRef = useRef(null);
  const engineRef = useRef(new GISMapEngine());
  const [toast, setToast] = useState(null);
  const toastTimeoutRef = useRef(null);
  const [selectedFeature, setSelectedFeature] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeDrawType, setActiveDrawType] = useState(null);
  const [hasInteracted, setHasInteracted] = useState(false);
  const sidebarToggleRef = useRef(null);
  const sidePanelRef = useRef(null);

  useEffect(() => {
    if (!sidebarOpen) return;
    sidePanelRef.current?.focus();

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setSidebarOpen(false);
        sidebarToggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [sidebarOpen]);

  const showToast = (message, type = "error") => {
    setToast({ message, type });
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  };

  const refreshLayers = () => {
    const updated = engineRef.current.getLayers();
    setLayers([...updated]);
  };

  const toggleViewMode = (next) => {
    if (next === is3D) return;
    if (activeDrawType) {
      engineRef.current.cancelDraw();
      showToast("Switching views cancelled your in-progress drawing.", "error");
    }
    setIs3D(next);
  };

  const handleViewReady = (view) => {
    viewRef.current = view;
    engineRef.current.setOnFeatureSelect(setSelectedFeature);
    engineRef.current.setOnDrawingsChanged(refreshLayers);
    engineRef.current.setOnDrawStateChange(setActiveDrawType);
    engineRef.current.attachToView(view);
    refreshLayers();
  };

  const handleRoute = async (start, end) => {
    setHasInteracted(true);
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
    // Heatmap visibility goes through enableHeatmap/disableHeatmap (not the
    // generic per-layer toggle) so its intensity renderer and heatVisible
    // field stay correct across a 2D/3D reattachment.
    if (id === "heat") {
      toggleHeatmap();
      return;
    }
    engineRef.current.toggleLayer(id);
    refreshLayers();
  };

  const zoomToLayer = async (id) => {
    await engineRef.current.zoomToLayer(id, showToast);
    refreshLayers();
  };

  const reorderLayer = (from, to) => {
    engineRef.current.reorderLayers(from, to);
    setLayers([...engineRef.current.getLayers()]);
  };

  const updateLayerStyle = (id, style) => {
    engineRef.current.setLayerStyle(id, style);
    refreshLayers();
  };

  const drawPoint = () => {
  setHasInteracted(true);
  engineRef.current.startPointDraw();
  };

  const drawLine = () => {
  setHasInteracted(true);
  engineRef.current.startLineDraw();
  };

  const drawPolygon = () => {
  setHasInteracted(true);
  engineRef.current.startPolygonDraw();
  };

  const cancelDraw = () => {
    engineRef.current.cancelDraw();
  };

  const uploadGeoJSON=async(file)=>{
  if(!file)return;
  setHasInteracted(true);
  console.log("Uploading:", file.name);
  await engineRef.current.uploadGeoJSON(file, showToast);
  setLayers([...engineRef.current.getLayers()]);
  };

  const saveGeoJSON = () => {engineRef.current.saveDrawings(showToast);};

  const handleSaveAttributes = async (updates) => {
    try {
      const result = await engineRef.current.updateSelectedFeatureAttributes(updates);
      setSelectedFeature((prev) => (prev ? { ...prev, attributes: result.attributes } : prev));
      showToast("Attribute changes saved.", "success");
    } catch (err) {
      showToast(err.message || "Failed to save attribute changes.", "error");
    }
  };

  const handleAddColumn = async (fieldName, defaultValue) => {
    if (!selectedFeature) return;
    try {
      await engineRef.current.addColumnToLayer(selectedFeature.layerId, fieldName, "esriFieldTypeString", defaultValue);
      setSelectedFeature((prev) =>
        prev ? { ...prev, attributes: { ...prev.attributes, [fieldName]: defaultValue } } : prev
      );
      showToast(`Column "${fieldName}" added.`, "success");
    } catch (err) {
      showToast(err.message || "Failed to add column.", "error");
    }
  };

  return (
    <div className="app">
      <button
        ref={sidebarToggleRef}
        className="sidebar-toggle"
        aria-label={sidebarOpen ? "Close panel" : "Open panel"}
        onClick={() => setSidebarOpen((open) => !open)}
      >
        <Icon name={sidebarOpen ? "close" : "menu"} />
      </button>

      {sidebarOpen && (
        <button
          type="button"
          className="side-panel-backdrop"
          aria-label="Close panel"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div
        ref={sidePanelRef}
        className={`side-panel${sidebarOpen ? " open" : ""}`}
        tabIndex={-1}
      >
        <RoutingControlPanel
          is3D={is3D}
          setIs3D={toggleViewMode}
          routeOn={routeOn}
          toggleRoute={toggleRoute}
          onRoute={handleRoute}
        />

        <LayerControlPanel
          layers={layers}
          onToggle={toggleLayer}
          onReorder={reorderLayer}
          onStyleChange={updateLayerStyle}
          onZoomToLayer={zoomToLayer}
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
        {!hasInteracted && (
          <div className="map-first-run-hint">
            Search a route above, or tap + to start drawing
          </div>
        )}
          <FloatingDrawTools
          drawPoint={drawPoint}
          drawLine={drawLine}
          drawPolygon={drawPolygon}
          saveGeoJSON={saveGeoJSON}
          uploadGeoJSON={uploadGeoJSON}
          activeDrawType={activeDrawType}
          onCancelDraw={cancelDraw}
          />
        <FeatureAttributesPanel
          feature={selectedFeature}
          onClose={() => setSelectedFeature(null)}
          onSaveAttributes={handleSaveAttributes}
          onAddColumn={handleAddColumn}
        />
      </div>
      {toast && (
        <output
          className={`gis-toast gis-toast-${toast.type}`}
          role={toast.type === "error" ? "alert" : undefined}
        >
          {toast.message}
        </output>
      )}
    </div>
  );
}