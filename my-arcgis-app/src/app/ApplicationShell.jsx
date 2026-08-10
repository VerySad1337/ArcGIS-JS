import { useEffect, useRef, useState } from "react";
const TOAST_DURATION_MS = 4000;
import GISMapView from "../components/GISMapView";
import ViewModeToggle from "../components/ViewModeToggle";
import LayerControlPanel from "../components/LayerControlPanel";
import GlobalSearchPanel from "../components/GlobalSearchPanel";
import PortalLayerPanel from "../components/PortalLayerPanel";
import AccountButton from "../components/AccountButton";
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
  const [layers, setLayers] = useState([]);
  const engineRef = useRef(new GISMapEngine());
  const [toast, setToast] = useState(null);
  const toastTimeoutRef = useRef(null);
  const [selectedFeature, setSelectedFeature] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeDrawType, setActiveDrawType] = useState(null);
  // Which layer a completed sketch is persisted to - "drawings" (default,
  // local-only) or a hosted/portal layer id (see GISMapEngine.setDrawTarget).
  const [drawTargetLayerId, setDrawTargetLayerId] = useState("drawings");
  const [hasInteracted, setHasInteracted] = useState(false);
  const [isRouting, setIsRouting] = useState(false);
  // Explicit state (rather than deriving Boolean(engineRef.current?.searchGraphic)
  // inline at render time) because that derivation only reflects reality once
  // something re-renders the component, and setHasInteracted(true) - the only
  // side effect handleSelectSearchResult otherwise triggers - is a no-op once
  // hasInteracted is already true (e.g. after any earlier interaction), so no
  // re-render would ever happen: selecting an address result after any prior
  // interaction silently left the "Add to Layers" form stuck hidden even
  // though engine.searchGraphic was already set. Tracking it as its own state
  // guarantees a re-render on every transition regardless of what else has
  // already happened this session.
  const [hasSearchResult, setHasSearchResult] = useState(false);
  const [reorderAnnouncement, setReorderAnnouncement] = useState("");
  const sidebarToggleRef = useRef(null);
  const sidePanelRef = useRef(null);
  const loadProjectInputRef = useRef(null);
  const [signedInUser, setSignedInUser] = useState(null);
  const [signingIn, setSigningIn] = useState(false);
  const [sliceActive, setSliceActive] = useState(false);
  // Bumped on every successful project load - see loadProject below and
  // LayerControlPanel's projectVersion prop for why this exists.
  const [projectVersion, setProjectVersion] = useState(0);

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
    engineRef.current.setOnFeatureSelect(setSelectedFeature);
    engineRef.current.setOnDrawingsChanged(refreshLayers);
    engineRef.current.setOnDrawStateChange(setActiveDrawType);
    engineRef.current.setOnFeatureAddedToLayer(() => {
      refreshLayers();
      showToast("Feature added to layer.", "success");
    });
    engineRef.current.setOnDrawTargetError((message) => {
      showToast(message || "Failed to add feature to layer.", "error");
    });
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

  const toggleLayer = (id) => {
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
      showToast(
        options.type === "heatmap"
          ? `Heatmap applied to "${layerName}".`
          : `"${layerName}" is now styled by "${options.field}".`,
        "success"
      );
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

  // Provisions a brand-new hosted Feature Layer on the portal (see
  // GISMapEngine.createHostedFeatureLayer) and registers it exactly like a
  // layer added via portal search - same throw-and-toast convention as
  // addPortalLayer.
  const createHostedFeatureLayer = async ({ name, geometryType, fields }) => {
    // Temporary diagnostic (2026-08): the engine call and refreshLayers()
    // are split into two try/catches, each with its own console.error tag,
    // so a failure can be pinned to a specific step - the toast alone can't
    // tell "the REST calls actually failed" apart from "they succeeded but
    // getLayers()/refreshLayers() blew up afterward reading the new layer".
    let newLayerId;
    try {
      newLayerId = await engineRef.current.createHostedFeatureLayer({ name, geometryType, fields });
    } catch (err) {
      console.error("createHostedFeatureLayer: engine call failed:", err);
      showToast(err.message || "Failed to create feature layer.", "error");
      return;
    }
    try {
      refreshLayers();
      showToast(`Created hosted layer "${name}".`, "success");
    } catch (err) {
      console.error("createHostedFeatureLayer: refreshLayers() failed after layer", newLayerId, "was created:", err);
      showToast(
        `Layer "${name}" was created, but the layer list couldn't refresh (${err.message || "unknown error"}). Reload the page.`,
        "error"
      );
    }
  };

  // Which layer FloatingDrawTools' "Draw into" selector offers: "Drawings"
  // plus any layer getLayers() reports as accepting new features (see
  // GISMapEngine's canBeDrawTarget). Derived from the already-computed
  // `layers` state, no extra engine round trip needed.
  const drawTargetOptions = [
    { id: "drawings", name: "Drawings" },
    ...layers.filter((l) => l.canBeDrawTarget).map((l) => ({ id: l.id, name: l.name }))
  ];

  const setDrawTarget = (layerId) => {
    try {
      engineRef.current.setDrawTarget(layerId);
      setDrawTargetLayerId(layerId);
    } catch (err) {
      showToast(err.message || "Failed to set draw target.", "error");
    }
  };

  // Named Heatmap Layers: the discoverable, "add to the layers card" way to
  // run heatmap analysis (see GISMapEngine's "Named Heatmap Layers"
  // section) - a user picks a source point layer and a name, and gets a
  // brand-new, independently toggleable/removable layer, instead of having
  // to find that layer's own Symbology section and switch it into Heatmap
  // mode in place. createHeatmapLayer throws on a missing name/ineligible
  // source, same throw-and-toast convention as addPortalLayer/setLayerFilter.
  // (The "which layers are eligible sources" list is derived by
  // LayerControlPanel straight from the `layers` prop's own heatmapEligible
  // style-group flags, so no separate engine round trip is needed for it.)
  const createHeatmapLayer = (sourceId, options) => {
    try {
      const { name } = engineRef.current.createHeatmapLayer(sourceId, options);
      refreshLayers();
      showToast(`Added heatmap layer "${name}".`, "success");
    } catch (err) {
      showToast(err.message || "Failed to add heatmap layer.", "error");
    }
  };

  const updateHeatmapLayerIntensity = (id, intensity) => {
    engineRef.current.updateHeatmapLayerIntensity(id, intensity);
    refreshLayers();
  };

  // "Add to Layers" in Route Search's discoverable way to keep a route
  // result around: route/stops are excluded from the Layers card (see
  // GISMapEngine.getLayers's comment) since they're just the live, always-
  // overwritten-by-the-next-search working state - this snapshots the
  // current route+stops into a brand-new, independently named/toggleable/
  // removable layer instead. Same throw-and-toast convention as
  // createHeatmapLayer (blank name / no route drawn yet).
  const createRouteResultLayer = (name) => {
    try {
      const { name: savedName } = engineRef.current.createRouteResultLayer(name);
      refreshLayers();
      showToast(`Added route layer "${savedName}".`, "success");
    } catch (err) {
      showToast(err.message || "Failed to add route layer.", "error");
    }
  };

  // "Add to Layers" in the Search card's discoverable way to keep an
  // address search result around: searchResult is excluded from the Layers
  // card (see GISMapEngine.getLayers's comment) since it's just the live,
  // always-overwritten-by-the-next-search marker - this snapshots the
  // current marker into a brand-new, independently named/toggleable/
  // removable layer instead. Same throw-and-toast convention as
  // createRouteResultLayer (blank name / no search result yet).
  // Once saved, the live marker is cleared (engine.clearSearchResult) so the
  // Search card resets to its empty initial state rather than leaving a
  // now-redundant marker (duplicating the one just saved) on the map -
  // GlobalSearchPanel mirrors this by clearing its own query/results state.
  const createSearchResultLayer = (name) => {
    try {
      const { name: savedName } = engineRef.current.createSearchResultLayer(name);
      engineRef.current.clearSearchResult();
      setHasSearchResult(false);
      refreshLayers();
      showToast(`Added search result layer "${savedName}".`, "success");
    } catch (err) {
      showToast(err.message || "Failed to add search result layer.", "error");
    }
  };

  // "Add to Layers" in the Buffer section's discoverable way to keep a
  // buffer result around: buffer is excluded from the Layers card (see
  // GISMapEngine.getLayers's comment) since it's just the live, always-
  // overwritten-by-the-next-buffer working state - this snapshots the
  // current polygon into a brand-new, independently named/toggleable/
  // removable layer instead. Same throw-and-toast convention as
  // createRouteResultLayer/createSearchResultLayer (blank name / no buffer
  // yet). Once saved, the live buffer is cleared (engine.clearBufferResult)
  // the same way a saved search result clears its own live marker.
  const createBufferResultLayer = (name) => {
    try {
      const { name: savedName } = engineRef.current.createBufferResultLayer(name);
      engineRef.current.clearBufferResult();
      refreshLayers();
      showToast(`Added buffer layer "${savedName}".`, "success");
    } catch (err) {
      showToast(err.message || "Failed to add buffer layer.", "error");
    }
  };

  // A single remove handler for every removable dynamic layer
  // (LayerControlPanel's remove button doesn't distinguish where a layer
  // came from) - dispatches on the synthetic id's prefix, the same
  // "heatmap_<id>"/"portal_<itemId>"/"route_<id>"/"search_<id>"/
  // "buffer_<id>" id-space convention all five engine methods already use.
  const removeLayer = (id) => {
    if (id.startsWith("heatmap_")) {
      engineRef.current.removeHeatmapLayer(id);
    } else if (id.startsWith("route_")) {
      engineRef.current.removeRouteResultLayer(id);
    } else if (id.startsWith("search_")) {
      engineRef.current.removeSearchResultLayer(id);
    } else if (id.startsWith("buffer_")) {
      engineRef.current.removeBufferResultLayer(id);
    } else {
      engineRef.current.removePortalLayer(id);
    }
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
      setHasSearchResult(true);
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
  // syncing the shell's own useState mirrors (is3D/routeOn) to whatever the
  // loaded project restored, the same way toggleRoute/toggleViewMode keep
  // those mirrors in sync with engine state elsewhere in this file.
  const saveProject = () => {
    engineRef.current.saveProjectState(showToast);
  };

  const loadProject = async (file) => {
    if (!file) return;
    setHasInteracted(true);
    const result = await engineRef.current.loadProjectState(file, showToast);
    if (!result) return;

    setRouteOn(result.routeVisible);
    setHasSearchResult(result.hasSearchResult);
    if (result.is3D !== is3D) {
      toggleViewMode(result.is3D);
    }
    refreshLayers();
    // RendererControls (LayerControlPanel's per-style-group Symbology form)
    // seeds its Heatmap-mode intensity (and mode/field) from props only on
    // mount, via useState - it doesn't resync if those props change under an
    // already-mounted instance. If a layer's Symbology > Heatmap section was
    // left open across a project load, its slider kept showing the
    // pre-load value instead of the one the loaded project actually applied.
    // Bumping this forces those instances to remount and re-seed from the
    // freshly loaded renderer state (see the key on RendererControls).
    setProjectVersion((v) => v + 1);
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
        <AccountButton
          oauthConfigured={isOAuthConfigured()}
          signedInUser={signedInUser}
          signingIn={signingIn}
          onSignIn={handleSignIn}
          onSignOut={handleSignOut}
        />

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

        <GlobalSearchPanel
          onSearch={handleSearch}
          onSelectResult={handleSelectSearchResult}
          hasSearchResult={hasSearchResult}
          onCreateSearchResultLayer={createSearchResultLayer}
        />

        <LayerControlPanel
          layers={layers}
          onToggle={toggleLayer}
          onReorder={reorderLayer}
          onStyleChange={updateLayerStyle}
          onZoomToLayer={zoomToLayer}
          onRemove={removeLayer}
          onGetLayerFields={getLayerFields}
          onApplyFilter={applyLayerFilter}
          onClearFilter={clearLayerFilter}
          onRunAggregate={runAnalysis}
          onSetAnnotation={setLayerAnnotation}
          onClearAnnotation={clearLayerAnnotation}
          onSetRenderer={setLayerRenderer}
          onClearRenderer={clearLayerRenderer}
          onUpdateRendererEntry={updateRendererEntry}
          onUpdateHeatmapLayerIntensity={updateHeatmapLayerIntensity}
          projectVersion={projectVersion}
        />

        <AnalysisPanel
          is3D={is3D}
          selectedFeature={selectedFeature}
          onBuffer={bufferSelectedFeature}
          sliceActive={sliceActive}
          onToggleSlice={toggleSlice}
          routeOn={routeOn}
          toggleRoute={toggleRoute}
          onRoute={handleRoute}
          isRouting={isRouting}
          hasRoute={Boolean(engineRef.current?.routeGraphic)}
          onCreateRouteLayer={createRouteResultLayer}
          hasBuffer={Boolean(engineRef.current?.bufferGraphic)}
          onCreateBufferLayer={createBufferResultLayer}
          layers={layers}
          onCreateHeatmapLayer={createHeatmapLayer}
        />

        <PortalLayerPanel
          onSearch={searchPortal}
          onAddLayer={addPortalLayer}
          onCreateLayer={createHostedFeatureLayer}
          signedInUser={signedInUser}
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
          drawTargetLayerId={drawTargetLayerId}
          drawTargetOptions={drawTargetOptions}
          onChangeDrawTarget={setDrawTarget}
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