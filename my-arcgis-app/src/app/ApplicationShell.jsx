import { useEffect, useRef, useState } from "react";
const TOAST_DURATION_MS = 4000;
import GISMapView from "../components/GISMapView";
import ViewModeToggle from "../components/ViewModeToggle";
import RoutingControlPanel from "../components/RoutingControlPanel";
import LayerControlPanel from "../components/LayerControlPanel";
import GlobalSearchPanel from "../components/GlobalSearchPanel";
import PortalLayerPanel from "../components/PortalLayerPanel";
import AnalysisPanel from "../components/AnalysisPanel";
import GISMapEngine from "../gis/GISMapEngine";
import { solveRoute } from "../services/RoutingService";
import { geocodeAddress } from "../services/GeocodingService";
import { searchPortalLayers } from "../services/PortalService";
import { isOAuthConfigured, checkSignInStatus, signIn, signOut } from "../services/AuthService";
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
  const [isRouting, setIsRouting] = useState(false);
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  const sidebarToggleRef = useRef(null);
  const sidePanelRef = useRef(null);
  const loadProjectInputRef = useRef(null);
  const [signedInUser, setSignedInUser] = useState(null);
  const [signingIn, setSigningIn] = useState(false);
  const [sliceActive, setSliceActive] = useState(false);

  useEffect(() => {
    if (!isOAuthConfigured()) return;
    // Restores a prior session (IdentityManager persists credentials across
    // reloads) without prompting the user again; resolves to null when
    // there's nothing to restore.
    checkSignInStatus().then(setSignedInUser);
  }, []);

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
    // Errors stay on screen until the user dismisses them; only transient
    // success/info messages auto-dismiss, since a 4s auto-hide risks a user
    // missing the reason a failed action failed.
    if (type !== "error") {
      toastTimeoutRef.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
    }
  };

  const dismissToast = () => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast(null);
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
    // Detach the engine's persistent layers from the outgoing map before
    // React unmounts the current <arcgis-map>/<arcgis-scene> element. That
    // element destroys its own Map on unmount, which cascades to destroy
    // any layer still attached to it (drawings, route, stops, ...) -
    // permanently wiping their graphics before the next attachToView call
    // ever gets a chance to save them. See GISMapEngine.detachFromView.
    engineRef.current.detachFromView();
    // detachFromView tears down the Slice widget (it's bound to the
    // outgoing view's own UI and can't survive the reattachment), so the
    // shell's mirror of that state needs to follow.
    if (sliceActive) setSliceActive(false);
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
    setIsRouting(true);
    try {
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
    } catch (err) {
      showToast(err.message || "Couldn't calculate a route between those locations.", "error");
    } finally {
      setIsRouting(false);
    }
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
    const updated = engineRef.current.getLayers();
    setLayers([...updated]);
    const moved = updated.filter(Boolean)[to];
    if (moved) {
      setReorderAnnouncement(`${moved.name} moved to position ${to + 1} of ${updated.filter(Boolean).length}.`);
    }
  };

  const updateLayerStyle = (id, style) => {
    engineRef.current.setLayerStyle(id, style);
    refreshLayers();
  };

  // Filter & Aggregate: schema lookups are read-only (no toast needed on
  // failure - LayerControlPanel just gets an empty field list); apply/clear
  // mutate engine state that getLayers() surfaces (filterDescription), so
  // both refresh the layer list the same way every other layer mutation
  // does. setLayerFilter throws on an invalid condition (bad field/operator/
  // value), consistent with updateSelectedFeatureAttributes/addColumnToLayer/
  // addPortalLayer's throw-and-let-the-shell-toast convention.
  const getLayerFields = (id) => engineRef.current.getLayerFieldSchema(id);

  const applyLayerFilter = async (id, filter) => {
    try {
      const result = await engineRef.current.setLayerFilter(id, filter);
      refreshLayers();
      const layerName = engineRef.current.getLayers().find((l) => l?.id === id)?.name || id;
      showToast(
        result.active ? `Filter applied to "${layerName}".` : `Filter cleared for "${layerName}".`,
        "success"
      );
    } catch (err) {
      showToast(err.message || "Invalid filter.", "error");
    }
  };

  const clearLayerFilter = (id) => {
    engineRef.current.clearLayerFilter(id);
    refreshLayers();
  };

  // Layer Annotation: same throw-and-toast/refresh convention as
  // applyLayerFilter/clearLayerFilter above - setLayerAnnotation throws on
  // a field that doesn't exist on the layer's schema.
  const setLayerAnnotation = async (id, field) => {
    try {
      await engineRef.current.setLayerAnnotation(id, field);
      refreshLayers();
      const layerName = engineRef.current.getLayers().find((l) => l?.id === id)?.name || id;
      showToast(`"${layerName}" is now labeled by "${field}".`, "success");
    } catch (err) {
      showToast(err.message || "Invalid annotation field.", "error");
    }
  };

  const clearLayerAnnotation = (id) => {
    engineRef.current.clearLayerAnnotation(id);
    refreshLayers();
  };

  // Advanced Renderer (Unique Values / Class Breaks): same throw-and-toast/
  // refresh convention as applyLayerFilter/setLayerAnnotation above -
  // setLayerAdvancedRenderer throws on a field that doesn't exist on the
  // layer's schema or an unknown renderer type.
  const setLayerRenderer = async (id, options) => {
    try {
      await engineRef.current.setLayerAdvancedRenderer(id, options);
      refreshLayers();
      const layerName = engineRef.current.getLayers().find((l) => l?.id === id)?.name || id;
      showToast(`"${layerName}" is now styled by "${options.field}".`, "success");
    } catch (err) {
      showToast(err.message || "Could not generate renderer.", "error");
    }
  };

  const clearLayerRenderer = (id) => {
    engineRef.current.clearLayerAdvancedRenderer(id);
    refreshLayers();
  };

  const updateRendererEntry = (id, key, changes) => {
    engineRef.current.updateRendererEntrySymbol(id, key, changes);
    refreshLayers();
  };

  const runAnalysis = async (ids, options) => {
    try {
      return await engineRef.current.runAnalysis(ids, options);
    } catch (err) {
      showToast(err.message || "Analysis failed.", "error");
      return null;
    }
  };

  // Spatial Analysis (ANALYSIS card): Buffer and Slice are both 3D-only -
  // see GISMapEngine.isSceneView. bufferSelectedFeature reports its own
  // success/failure via the msg callback (same convention as
  // zoomToLayer/uploadGeoJSON), so this wrapper only needs to refresh the
  // layer list afterward, since a successful buffer adds a graphic to the
  // already-tracked drawings layer.
  const bufferSelectedFeature = (distance, unit) => {
    engineRef.current.bufferSelectedFeature(distance, unit, showToast);
    refreshLayers();
  };

  const toggleSlice = () => {
    if (sliceActive) {
      engineRef.current.stopSlice();
    } else {
      engineRef.current.startSlice(showToast);
    }
    setSliceActive(engineRef.current.isSliceActive());
  };

  // Portal layer search itself is a stateless service call (consistent with
  // the existing rule that RoutingService/GeocodingService are invoked from
  // the shell, not the engine); adding/removing the resulting FeatureLayer
  // is engine-owned, same as every other layer mutation.
  const searchPortal = async (query) => {
    try {
      return await searchPortalLayers(query);
    } catch (err) {
      showToast(err.message || "Portal search failed.", "error");
      return [];
    }
  };

  // Async because the engine probes the service for accessibility before
  // registering the layer - a portal item can be publicly listed while its
  // service is subscription-only or restricted, and letting that failure
  // reach the SDK would surface as a forced sign-in modal.
  const addPortalLayer = async (item) => {
    try {
      await engineRef.current.addPortalLayer(item);
      refreshLayers();
      showToast(`Added "${item.title}" to layers.`, "success");
    } catch (err) {
      showToast(err.message || "Failed to add layer.", "error");
    }
  };

  const removePortalLayer = (id) => {
    engineRef.current.removePortalLayer(id);
    refreshLayers();
  };

  const handleSignIn = async () => {
    setSigningIn(true);
    try {
      const user = await signIn();
      setSignedInUser(user);
      if (user) showToast(`Signed in as ${user.fullName}.`, "success");
    } catch (err) {
      showToast(err.message || "Sign-in failed or was cancelled.", "error");
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = () => {
    signOut();
    setSignedInUser(null);
    showToast("Signed out.", "success");
  };

  // Combines map-feature search (Tourist Attractions/MRT Stations/MRT
  // Lines/Drawings, via the engine) with address geocoding (via the
  // existing GeocodingService) into one result list. Geocoding is invoked
  // here rather than from the engine, consistent with the existing rule
  // that stateless services are called from the shell, not the engine.
  const handleSearch = async (query) => {
    const [featureResults, addressLocation] = await Promise.all([
      engineRef.current.searchFeatures(query),
      geocodeAddress(query).catch(() => null)
    ]);

    const addressResult = addressLocation
      ? [{
          type: "address",
          layerId: "address",
          label: query,
          longitude: addressLocation.longitude,
          latitude: addressLocation.latitude
        }]
      : [];

    return [...featureResults, ...addressResult];
  };

  const handleSelectSearchResult = async (result) => {
    setHasInteracted(true);
    if (result.type === "address") {
      await engineRef.current.zoomToPoint(result.longitude, result.latitude);
    } else {
      await engineRef.current.zoomToSearchResult(result);
    }
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

  // Project Persistence (Save/Load Project) - the ArcGIS Pro ".aprx" analog.
  // saveProjectState/loadProjectState do the actual serialization (see
  // GISMapEngine's "Project Persistence" section); this wrapper's job is
  // syncing the shell's own useState mirrors (is3D/routeOn/heatOn/
  // heatIntensity) to whatever the loaded project restored, the same way
  // toggleHeatmap/toggleRoute/toggleViewMode keep those mirrors in sync with
  // engine state elsewhere in this file.
  const saveProject = () => {
    engineRef.current.saveProjectState(showToast);
  };

  const loadProject = async (file) => {
    if (!file) return;
    setHasInteracted(true);
    const result = await engineRef.current.loadProjectState(file, showToast);
    if (!result) return;

    setRouteOn(result.routeVisible);
    setHeatOn(result.heatVisible);
    setHeatIntensity(result.heatIntensity);
    if (result.is3D !== is3D) {
      toggleViewMode(result.is3D);
    }
    refreshLayers();
  };

  const handleSaveAttributes = async (updates) => {
    try {
      const result = await engineRef.current.updateSelectedFeatureAttributes(updates);
      setSelectedFeature((prev) => (prev ? { ...prev, attributes: result.attributes } : prev));
      showToast("Attribute changes saved.", "success");
    } catch (err) {
      showToast(err.message || "Failed to save attribute changes.", "error");
    }
  };

  // Drawings live in memory on the local GraphicsLayer, so editing them needs
  // no account and must keep working anonymously - that is the app's normal
  // mode. The hosted FeatureLayers are a different story: writing to them
  // needs a real credential, and offering the controls anyway meant the
  // rejection surfaced as IdentityManager's own sign-in modal. Hiding them
  // until there is a credential keeps the app read-only-usable instead of
  // appearing to require a login.
  const canEditSelectedFeature =
    selectedFeature?.layerId === "drawings" || Boolean(signedInUser);

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
        <div className="project-persistence-row">
          <button type="button" className="gis-button-secondary" onClick={saveProject}>
            <Icon name="folder" size={16} />
            Save Project
          </button>
          <button
            type="button"
            className="gis-button-secondary"
            onClick={() => loadProjectInputRef.current?.click()}
          >
            <Icon name="folder" size={16} />
            Load Project
          </button>
          <input
            ref={loadProjectInputRef}
            hidden
            type="file"
            accept=".json"
            onChange={({ target }) => {
              const file = target.files?.[0];
              target.value = "";
              if (file) loadProject(file);
            }}
          />
        </div>

        <ViewModeToggle is3D={is3D} setIs3D={toggleViewMode} />

        <GlobalSearchPanel onSearch={handleSearch} onSelectResult={handleSelectSearchResult} />

        <LayerControlPanel
          layers={layers}
          onToggle={toggleLayer}
          onReorder={reorderLayer}
          onStyleChange={updateLayerStyle}
          onZoomToLayer={zoomToLayer}
          onRemove={removePortalLayer}
          heatIntensity={heatIntensity}
          updateIntensity={updateIntensity}
          onGetLayerFields={getLayerFields}
          onApplyFilter={applyLayerFilter}
          onClearFilter={clearLayerFilter}
          onRunAggregate={runAnalysis}
          onSetAnnotation={setLayerAnnotation}
          onClearAnnotation={clearLayerAnnotation}
          onSetRenderer={setLayerRenderer}
          onClearRenderer={clearLayerRenderer}
          onUpdateRendererEntry={updateRendererEntry}
        />

        <RoutingControlPanel
          routeOn={routeOn}
          toggleRoute={toggleRoute}
          onRoute={handleRoute}
          isRouting={isRouting}
        />

        <AnalysisPanel
          is3D={is3D}
          selectedFeature={selectedFeature}
          onBuffer={bufferSelectedFeature}
          sliceActive={sliceActive}
          onToggleSlice={toggleSlice}
        />

        <PortalLayerPanel
          onSearch={searchPortal}
          onAddLayer={addPortalLayer}
          oauthConfigured={isOAuthConfigured()}
          signedInUser={signedInUser}
          signingIn={signingIn}
          onSignIn={handleSignIn}
          onSignOut={handleSignOut}
        />
      </div>

      <span className="sr-only" role="status" aria-live="polite">
        {reorderAnnouncement}
      </span>

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
          canEdit={canEditSelectedFeature}
        />
      </div>
      {toast && (
        <output
          className={`gis-toast gis-toast-${toast.type}`}
          role={toast.type === "error" ? "alert" : undefined}
        >
          <span className="gis-toast-message">{toast.message}</span>
          <button
            type="button"
            className="gis-toast-close"
            aria-label="Dismiss"
            onClick={dismissToast}
          >
            <Icon name="close" size={12} />
          </button>
        </output>
      )}
    </div>
  );
}