import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// Stable identity for the chat-disabled case, so mapContext's memo hands back
// the same object every render instead of an equivalent fresh one.
const EMPTY_MAP_CONTEXT = Object.freeze({ is3D: false, layers: [], queryableLayerUrls: [] });

const TOAST_DURATION_MS = 4000;
import GISMapView from "../components/GISMapView";
import ViewModeToggle from "../components/ViewModeToggle";
import LayerControlPanel from "../components/LayerControlPanel";
import GlobalSearchPanel from "../components/GlobalSearchPanel";
import PortalLayerPanel from "../components/PortalLayerPanel";
import CreateFeatureLayerPanel from "../components/CreateFeatureLayerPanel";
import AccountButton from "../components/AccountButton";
import AnalysisPanel from "../components/AnalysisPanel";
import ChatPanel from "../components/ChatPanel";
import GISMapEngine from "../gis/GISMapEngine";
import { solveRoute } from "../services/RoutingService";
import { geocodeAddress, reverseGeocodeLocation } from "../services/GeocodingService";
import { searchPortalLayers } from "../services/PortalService";
import { sendChatMessage, sendToolResult } from "../services/ChatService";
import { isOAuthConfigured, checkSignInStatus, signIn, signOut } from "../services/AuthService";
import { WEBMAP_ID, WEBSCENE_ID, CHAT_ENABLED } from "../config/ArcGISConfiguration";
import FloatingDrawTools from "../components/FloatingDrawTools";
import FeatureAttributesPanel from "../components/FeatureAttributesPanel";
import Icon from "../components/Icon";

// Chatbot / MCP System only - see knowledge/features/chatbot-mcp-system.md.
//
// The manual Filter UI can never send a field name that doesn't exist: it
// populates a <select> from getLayerFieldSchema, so GISMapEngine's strict
// exact-match validation is exactly right there. The chat's model types the
// field name itself, and a small local model both lowercases ArcGIS's
// conventionally-uppercase field names and paraphrases them - which surfaced
// as "filter out tampines from mrt stations" failing with `"name" is not a
// field on this layer.` even when a NAME field does exist.
//
// So a chat-supplied field name is resolved against the layer's real schema
// before the engine ever sees it, rather than being trusted or rejected
// outright: exact match, then case-insensitive, then ignoring separators
// (so "station_name"/"stationname"/"Station Name" all reach STATION_NAME).
// Anything looser is deliberately NOT attempted - silently filtering on a
// field the user didn't ask about is worse than an error the model can act
// on, and runClientAction's failure path hands the model the real field list
// so its retry is informed rather than another guess.
function squashFieldName(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// A model writes SQL-flavoured operator spellings that LayerFilterExpression's
// FILTER_OPERATORS table doesn't use as keys. The table is the authority (the
// tool schema now advertises its real keys), but a model will keep emitting
// these regardless of the schema, and "!=" in particular is the obvious choice
// for "filter OUT x" - so they're mapped rather than rejected.
const OPERATOR_ALIASES = {
  "!=": "<>",
  "is null": "isNull",
  "is not null": "isNotNull",
  isnull: "isNull",
  isnotnull: "isNotNull",
  like: "contains",
  "starts with": "startsWith",
  "ends with": "endsWith"
};

function resolveOperatorToken(requested) {
  const token = String(requested || "").trim();
  return OPERATOR_ALIASES[token] || OPERATOR_ALIASES[token.toLowerCase()] || token;
}

function resolveFieldName(requested, fields) {
  const names = fields.map((f) => f.name);
  const exact = names.find((n) => n === requested);
  if (exact) return exact;

  const caseInsensitive = names.find((n) => n.toLowerCase() === String(requested || "").toLowerCase());
  if (caseInsensitive) return caseInsensitive;

  const squashed = squashFieldName(requested);
  return squashed ? names.find((n) => squashFieldName(n) === squashed) || null : null;
}

export default function ApplicationShell() {
  const [is3D, setIs3D] = useState(false);
  const [basemapId, setBasemapId] = useState("default");
  const [routeOn, setRouteOn] = useState(true);
  const [layers, setLayers] = useState([]);
  const engineRef = useRef(new GISMapEngine());
  const [toast, setToast] = useState(null);
  const toastTimeoutRef = useRef(null);
  const [selectedFeature, setSelectedFeature] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeDrawType, setActiveDrawType] = useState(null);
  // Which layer a completed sketch is persisted to - "" (default, no
  // explicit choice yet - draws fall back to the local "Drawings" scratch
  // layer via GISMapEngine's own "drawings" default), "drawings" (chosen
  // explicitly), or a hosted/portal layer id (see GISMapEngine.setDrawTarget).
  // Auto-selection of the topmost editable layer happens in the effect
  // below, once `layers` reports at least one canBeDrawTarget candidate.
  const [drawTargetLayerId, setDrawTargetLayerId] = useState("");
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
  const [lineOfSightActive, setLineOfSightActive] = useState(false);
  const [viewshedActive, setViewshedActive] = useState(false);
  // Bumped on every successful project load - see loadProject below and
  // LayerControlPanel's projectVersion prop for why this exists.
  const [projectVersion, setProjectVersion] = useState(0);

  // Every handler below is wrapped in useCallback, and every child panel is
  // wrapped in React.memo (see each component's own export). The two go
  // together and neither works alone: an inline arrow prop changes identity
  // on every render, which defeats memo entirely. Without this pairing, a
  // single layer-visibility toggle (or a colour-picker drag, which fires
  // continuously) re-rendered the whole panel tree - LayerControlPanel's
  // ~1500 lines of nested per-layer forms included - even though only the
  // layer list had changed.
  const refreshLayers = useCallback(() => {
    const updated = engineRef.current.getLayers();
    setLayers([...updated]);
  }, []);

  useEffect(() => {
    if (!isOAuthConfigured()) return;
    // Restores a prior session (IdentityManager persists credentials across
    // reloads) without prompting the user again; resolves to null when
    // there's nothing to restore. Also refreshes the layer list so a
    // restored session's editable/canBeDrawTarget flags (which read the
    // current credential - see GISMapEngine.hasEditCredential) aren't stuck
    // showing signed-out state until some unrelated action refreshes them.
    checkSignInStatus().then((user) => {
      setSignedInUser(user);
      refreshLayers();
    });
  }, [refreshLayers]);

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

  const showToast = useCallback((message, type = "error") => {
    setToast({ message, type });
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    // Errors stay on screen until the user dismisses them; only transient
    // success/info messages auto-dismiss, since a 4s auto-hide risks a user
    // missing the reason a failed action failed.
    if (type !== "error") {
      toastTimeoutRef.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
    }
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast(null);
  }, []);

  const toggleViewMode = useCallback((next) => {
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
    // detachFromView tears down the Slice/LineOfSight/Viewshed widgets
    // (each bound to the outgoing view's own UI and unable to survive the
    // reattachment), so the shell's mirrors of that state need to follow.
    if (sliceActive) setSliceActive(false);
    if (lineOfSightActive) setLineOfSightActive(false);
    if (viewshedActive) setViewshedActive(false);
    setIs3D(next);
  }, [is3D, activeDrawType, sliceActive, lineOfSightActive, viewshedActive, showToast]);

  const changeBasemap = useCallback((id) => {
    engineRef.current.setBasemap(id);
    setBasemapId(id);
  }, []);

  const handleViewReady = useCallback((view) => {
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
  }, [refreshLayers, showToast]);

  const handleRoute = useCallback(async (start, end) => {
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
  }, [refreshLayers, showToast]);

  // Reverse geocode: a read-only lat/long -> address/postal-code lookup for
  // AnalysisPanel's own Reverse Geocode section. Unlike handleRoute, this
  // doesn't mutate any engine/map state, so there's no refreshLayers() call
  // - just the same throw-and-toast convention the rest of this file uses
  // for a failable call the caller can't usefully recover from itself.
  const handleReverseGeocode = useCallback(async (latitude, longitude) => {
    try {
      return await reverseGeocodeLocation(latitude, longitude);
    } catch (err) {
      showToast(err.message || "Couldn't find an address for that location.", "error");
      return null;
    }
  }, [showToast]);

  const toggleRoute = useCallback(() => {
    const next = !routeOn;
    engineRef.current.toggleRoute(next);
    setRouteOn(next);
    refreshLayers();
  }, [routeOn, refreshLayers]);

  const toggleLayer = useCallback((id) => {
    engineRef.current.toggleLayer(id);
    refreshLayers();
  }, [refreshLayers]);

  const zoomToLayer = useCallback(async (id) => {
    await engineRef.current.zoomToLayer(id, showToast);
    refreshLayers();
  }, [refreshLayers, showToast]);

  const reorderLayer = useCallback((from, to) => {
    engineRef.current.reorderLayers(from, to);
    const updated = engineRef.current.getLayers();
    setLayers([...updated]);
    const moved = updated.filter(Boolean)[to];
    if (moved) {
      setReorderAnnouncement(`${moved.name} moved to position ${to + 1} of ${updated.filter(Boolean).length}.`);
    }
  }, []);

  const updateLayerStyle = useCallback((id, style) => {
    engineRef.current.setLayerStyle(id, style);
    refreshLayers();
  }, [refreshLayers]);

  // Filter & Aggregate: schema lookups are read-only (no toast needed on
  // failure - LayerControlPanel just gets an empty field list); apply/clear
  // mutate engine state that getLayers() surfaces (filterDescription), so
  // both refresh the layer list the same way every other layer mutation
  // does. setLayerFilter throws on an invalid condition (bad field/operator/
  // value), consistent with updateSelectedFeatureAttributes/addColumnToLayer/
  // addPortalLayer's throw-and-let-the-shell-toast convention.
  const getLayerFields = useCallback((id) => engineRef.current.getLayerFieldSchema(id), []);

  const applyLayerFilter = useCallback(async (id, filter) => {
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
  }, [refreshLayers, showToast]);

  const clearLayerFilter = useCallback((id) => {
    engineRef.current.clearLayerFilter(id);
    refreshLayers();
  }, [refreshLayers]);

  // Layer Annotation: same throw-and-toast/refresh convention as
  // applyLayerFilter/clearLayerFilter above - setLayerAnnotation throws on
  // a field that doesn't exist on the layer's schema.
  const setLayerAnnotation = useCallback(async (id, field) => {
    try {
      await engineRef.current.setLayerAnnotation(id, field);
      refreshLayers();
      const layerName = engineRef.current.getLayers().find((l) => l?.id === id)?.name || id;
      showToast(`"${layerName}" is now labeled by "${field}".`, "success");
    } catch (err) {
      showToast(err.message || "Invalid annotation field.", "error");
    }
  }, [refreshLayers, showToast]);

  const clearLayerAnnotation = useCallback((id) => {
    engineRef.current.clearLayerAnnotation(id);
    refreshLayers();
  }, [refreshLayers]);

  // Advanced Renderer (Unique Values / Class Breaks): same throw-and-toast/
  // refresh convention as applyLayerFilter/setLayerAnnotation above -
  // setLayerAdvancedRenderer throws on a field that doesn't exist on the
  // layer's schema or an unknown renderer type.
  const setLayerRenderer = useCallback(async (id, options) => {
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
  }, [refreshLayers, showToast]);

  const clearLayerRenderer = useCallback((id) => {
    engineRef.current.clearLayerAdvancedRenderer(id);
    refreshLayers();
  }, [refreshLayers]);

  const updateRendererEntry = useCallback((id, key, changes) => {
    engineRef.current.updateRendererEntrySymbol(id, key, changes);
    refreshLayers();
  }, [refreshLayers]);

  const runAnalysis = useCallback(async (ids, options) => {
    try {
      return await engineRef.current.runAnalysis(ids, options);
    } catch (err) {
      showToast(err.message || "Analysis failed.", "error");
      return null;
    }
  }, [showToast]);

  // Spatial Analysis (ANALYSIS card): Buffer and Slice are both 3D-only -
  // see GISMapEngine.isSceneView. bufferSelectedFeature reports its own
  // success/failure via the msg callback (same convention as
  // zoomToLayer/uploadGeoJSON), so this wrapper only needs to refresh the
  // layer list afterward, since a successful buffer adds a graphic to the
  // already-tracked drawings layer.
  const bufferSelectedFeature = useCallback((distance, unit) => {
    engineRef.current.bufferSelectedFeature(distance, unit, showToast);
    refreshLayers();
  }, [refreshLayers, showToast]);

  // Slice/Line of Sight/Viewshed are mutually exclusive on the engine side
  // (see GISMapEngine's "Slice/LineOfSight/Viewshed are additionally
  // mutually exclusive" comment) - starting any one of them silently stops
  // whichever of the other two was active, so every toggle here re-syncs
  // all three pieces of shell state from the engine afterward, not just the
  // one the user clicked. Without this, switching from e.g. Slice straight
  // to Line of Sight would leave sliceActive stuck true (the engine already
  // tore the widget down, but the shell never found out), showing "Stop
  // Slice" for a tool that isn't actually running anymore.
  const syncAnalysisToolState = useCallback(() => {
    setSliceActive(engineRef.current.isSliceActive());
    setLineOfSightActive(engineRef.current.isLineOfSightActive());
    setViewshedActive(engineRef.current.isViewshedActive());
  }, []);

  const toggleSlice = useCallback(() => {
    if (sliceActive) {
      engineRef.current.stopSlice();
    } else {
      engineRef.current.startSlice(showToast);
    }
    syncAnalysisToolState();
  }, [sliceActive, showToast, syncAnalysisToolState]);

  const toggleLineOfSight = useCallback(() => {
    if (lineOfSightActive) {
      engineRef.current.stopLineOfSight();
    } else {
      engineRef.current.startLineOfSight(showToast);
    }
    syncAnalysisToolState();
  }, [lineOfSightActive, showToast, syncAnalysisToolState]);

  const toggleViewshed = useCallback(() => {
    if (viewshedActive) {
      engineRef.current.stopViewshed();
    } else {
      engineRef.current.startViewshed(showToast);
    }
    syncAnalysisToolState();
  }, [viewshedActive, showToast, syncAnalysisToolState]);

  // Portal layer search itself is a stateless service call (consistent with
  // the existing rule that RoutingService/GeocodingService are invoked from
  // the shell, not the engine); adding/removing the resulting FeatureLayer
  // is engine-owned, same as every other layer mutation.
  const searchPortal = useCallback(async (query) => {
    try {
      return await searchPortalLayers(query);
    } catch (err) {
      showToast(err.message || "Portal search failed.", "error");
      return [];
    }
  }, [showToast]);

  // Async because the engine probes the service for accessibility before
  // registering the layer - a portal item can be publicly listed while its
  // service is subscription-only or restricted, and letting that failure
  // reach the SDK would surface as a forced sign-in modal.
  const addPortalLayer = useCallback(async (item) => {
    try {
      await engineRef.current.addPortalLayer(item);
      refreshLayers();
      showToast(`Added "${item.title}" to layers.`, "success");
    } catch (err) {
      showToast(err.message || "Failed to add layer.", "error");
    }
  }, [refreshLayers, showToast]);

  // Provisions a brand-new hosted Feature Layer on the portal (see
  // GISMapEngine.createHostedFeatureLayer) and registers it exactly like a
  // layer added via portal search - same throw-and-toast convention as
  // addPortalLayer.
  const createHostedFeatureLayer = useCallback(async ({ name, geometryType, fields }) => {
    try {
      await engineRef.current.createHostedFeatureLayer({ name, geometryType, fields });
      refreshLayers();
      showToast(`Created hosted layer "${name}".`, "success");
    } catch (err) {
      showToast(err.message || "Failed to create feature layer.", "error");
    }
  }, [refreshLayers, showToast]);

  // Which layer FloatingDrawTools' "Draw into" selector offers: every layer
  // getLayers() reports as accepting new features (see GISMapEngine's
  // canBeDrawTarget), each carrying its own geometryType so FloatingDrawTools
  // can show only the one matching draw tool. Derived from the already-
  // computed `layers` state, no extra engine round trip needed.
  //
  // "Drawings" is deliberately NOT offered here (2026-08) - it remains
  // GISMapEngine's internal local-scratch fallback (SketchViewModel always
  // sketches onto drawLayer first regardless of target, and a failed push to
  // a hosted layer still leaves the graphic there - see Draw Target Routing
  // in knowledge/features/drawing-system.md), but a user can no longer
  // explicitly choose to leave a drawing local-only. When this list is
  // empty (no editable feature class available), FloatingDrawTools hides
  // the selector entirely and drawing still falls back to the local layer
  // via GISMapEngine.activeDrawTargetLayerId's own "drawings" default.
  //
  // Memoized because it is a fresh array on every render otherwise, which
  // would make FloatingDrawTools' React.memo a no-op.
  const drawTargetOptions = useMemo(
    () =>
      layers
        .filter((l) => l.canBeDrawTarget)
        .map((l) => ({ id: l.id, name: l.name, geometryType: l.geometryType })),
    [layers]
  );

  const setDrawTarget = useCallback((layerId) => {
    try {
      engineRef.current.setDrawTarget(layerId);
      setDrawTargetLayerId(layerId);
    } catch (err) {
      showToast(err.message || "Failed to set draw target.", "error");
    }
  }, [showToast]);

  // "Draw into" starts with nothing explicitly chosen (drawTargetLayerId ===
  // ""). Once the layer list reports one or more editable feature classes
  // (canBeDrawTarget), auto-select the one drawn on top of the map instead
  // of leaving the picker empty - `layers` is already ordered bottom-to-top
  // (see LayerControlPanel's ordering note), so the topmost candidate is the
  // last match in that filtered list. Only runs while nothing has been
  // chosen yet, so it never overrides a user's own selection.
  useEffect(() => {
    if (drawTargetLayerId) return;
    const editableLayers = layers.filter((l) => l.canBeDrawTarget);
    if (editableLayers.length < 1) return;
    const topmost = editableLayers[editableLayers.length - 1];
    setDrawTarget(topmost.id);
  }, [layers, drawTargetLayerId, setDrawTarget]);

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
  const createHeatmapLayer = useCallback((sourceId, options) => {
    try {
      const { name } = engineRef.current.createHeatmapLayer(sourceId, options);
      refreshLayers();
      showToast(`Added heatmap layer "${name}".`, "success");
    } catch (err) {
      showToast(err.message || "Failed to add heatmap layer.", "error");
    }
  }, [refreshLayers, showToast]);

  const updateHeatmapLayerIntensity = useCallback((id, intensity) => {
    engineRef.current.updateHeatmapLayerIntensity(id, intensity);
    refreshLayers();
  }, [refreshLayers]);

  // Named Hexagon Layers: the discrete, "bin points into hexagons"
  // sibling to Named Heatmap Layers above (see GISMapEngine's "Named
  // Hexagon Layers" section) - a user picks a source point layer, a name,
  // and a cell size, and gets a brand-new, independently toggleable/
  // removable layer of count-colored hexagons. createHexagonLayer is async
  // (it queries the source layer's features) and throws on a missing
  // name/ineligible source/invalid cell size/no data to bin, same
  // throw-and-toast convention as createHeatmapLayer.
  const createHexagonLayer = useCallback(async (sourceId, options) => {
    try {
      const { name } = await engineRef.current.createHexagonLayer(sourceId, options);
      refreshLayers();
      showToast(`Added hexagon layer "${name}".`, "success");
    } catch (err) {
      showToast(err.message || "Failed to add hexagon layer.", "error");
    }
  }, [refreshLayers, showToast]);

  // "Add to Layers" in Route Search's discoverable way to keep a route
  // result around: route/stops are excluded from the Layers card (see
  // GISMapEngine.getLayers's comment) since they're just the live, always-
  // overwritten-by-the-next-search working state - this snapshots the
  // current route+stops into a brand-new, independently named/toggleable/
  // removable layer instead. Same throw-and-toast convention as
  // createHeatmapLayer (blank name / no route drawn yet).
  const createRouteResultLayer = useCallback((name) => {
    try {
      const { name: savedName } = engineRef.current.createRouteResultLayer(name);
      refreshLayers();
      showToast(`Added route layer "${savedName}".`, "success");
    } catch (err) {
      showToast(err.message || "Failed to add route layer.", "error");
    }
  }, [refreshLayers, showToast]);

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
  const createSearchResultLayer = useCallback((name) => {
    try {
      const { name: savedName } = engineRef.current.createSearchResultLayer(name);
      engineRef.current.clearSearchResult();
      setHasSearchResult(false);
      refreshLayers();
      showToast(`Added search result layer "${savedName}".`, "success");
    } catch (err) {
      showToast(err.message || "Failed to add search result layer.", "error");
    }
  }, [refreshLayers, showToast]);

  // "Add to Layers" in the Buffer section's discoverable way to keep a
  // buffer result around: buffer is excluded from the Layers card (see
  // GISMapEngine.getLayers's comment) since it's just the live, always-
  // overwritten-by-the-next-buffer working state - this snapshots the
  // current polygon into a brand-new, independently named/toggleable/
  // removable layer instead. Same throw-and-toast convention as
  // createRouteResultLayer/createSearchResultLayer (blank name / no buffer
  // yet). Once saved, the live buffer is cleared (engine.clearBufferResult)
  // the same way a saved search result clears its own live marker.
  const createBufferResultLayer = useCallback((name) => {
    try {
      const { name: savedName } = engineRef.current.createBufferResultLayer(name);
      engineRef.current.clearBufferResult();
      refreshLayers();
      showToast(`Added buffer layer "${savedName}".`, "success");
    } catch (err) {
      showToast(err.message || "Failed to add buffer layer.", "error");
    }
  }, [refreshLayers, showToast]);

  // A single remove handler for every removable dynamic layer
  // (LayerControlPanel's remove button doesn't distinguish where a layer
  // came from) - dispatches on the synthetic id's prefix, the same
  // "heatmap_<id>"/"portal_<itemId>"/"route_<id>"/"search_<id>"/
  // "buffer_<id>" id-space convention all five engine methods already use.
  const removeLayer = useCallback((id) => {
    if (id.startsWith("heatmap_")) {
      engineRef.current.removeHeatmapLayer(id);
    } else if (id.startsWith("route_")) {
      engineRef.current.removeRouteResultLayer(id);
    } else if (id.startsWith("search_")) {
      engineRef.current.removeSearchResultLayer(id);
    } else if (id.startsWith("buffer_")) {
      engineRef.current.removeBufferResultLayer(id);
    } else if (id.startsWith("hexagon_")) {
      engineRef.current.removeHexagonLayer(id);
    } else {
      engineRef.current.removePortalLayer(id);
    }
    refreshLayers();
  }, [refreshLayers]);

  // Rename is scoped to the same five user-created layer kinds removeLayer
  // dispatches over (engine.renameLayer itself checks which *LayerMeta the
  // id belongs to, so no id-prefix branching is needed here) - throw-and-
  // toast, same convention as createHeatmapLayer/addPortalLayer.
  const renameLayer = useCallback((id, name) => {
    try {
      engineRef.current.renameLayer(id, name);
      refreshLayers();
    } catch (err) {
      showToast(err.message || "Failed to rename layer.", "error");
    }
  }, [refreshLayers, showToast]);

  const handleSignIn = useCallback(async () => {
    setSigningIn(true);
    try {
      const user = await signIn();
      setSignedInUser(user);
      if (user) showToast(`Signed in as ${user.fullName}.`, "success");
      // getLayers()'s editable/canBeDrawTarget flags read the current
      // IdentityManager credential (see hasEditCredential) - without this,
      // the Layers card's editable badges and the "Draw into" dropdown stay
      // stuck showing pre-sign-in state until some unrelated action happens
      // to trigger the next refresh.
      refreshLayers();
    } catch (err) {
      showToast(err.message || "Sign-in failed or was cancelled.", "error");
    } finally {
      setSigningIn(false);
    }
  }, [refreshLayers, showToast]);

  const handleSignOut = useCallback(() => {
    signOut();
    setSignedInUser(null);
    showToast("Signed out.", "success");
    refreshLayers();
  }, [refreshLayers, showToast]);

  // Combines map-feature search (Tourist Attractions/MRT Stations/MRT
  // Lines/Drawings, via the engine) with address geocoding (via the
  // existing GeocodingService) into one result list. Geocoding is invoked
  // here rather than from the engine, consistent with the existing rule
  // that stateless services are called from the shell, not the engine.
  const handleSearch = useCallback(async (query) => {
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
  }, []);

  const handleSelectSearchResult = useCallback(async (result) => {
    setHasInteracted(true);
    if (result.type === "address") {
      await engineRef.current.zoomToPoint(result.longitude, result.latitude);
      setHasSearchResult(true);
    } else {
      await engineRef.current.zoomToSearchResult(result);
    }
  }, []);

  const drawPoint = useCallback(() => {
    setHasInteracted(true);
    engineRef.current.startPointDraw();
  }, []);

  const drawLine = useCallback(() => {
    setHasInteracted(true);
    engineRef.current.startLineDraw();
  }, []);

  const drawPolygon = useCallback(() => {
    setHasInteracted(true);
    engineRef.current.startPolygonDraw();
  }, []);

  const cancelDraw = useCallback(() => {
    engineRef.current.cancelDraw();
  }, []);

  // Project Persistence (Save/Load Project) - the ArcGIS Pro ".aprx" analog.
  // saveProjectState/loadProjectState do the actual serialization (see
  // GISMapEngine's "Project Persistence" section); this wrapper's job is
  // syncing the shell's own useState mirrors (is3D/routeOn) to whatever the
  // loaded project restored, the same way toggleRoute/toggleViewMode keep
  // those mirrors in sync with engine state elsewhere in this file.
  const saveProject = useCallback(() => {
    engineRef.current.saveProjectState(showToast);
  }, [showToast]);

  const loadProject = useCallback(async (file) => {
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
  }, [is3D, refreshLayers, showToast, toggleViewMode]);

  const handleSaveAttributes = useCallback(async (updates) => {
    try {
      const result = await engineRef.current.updateSelectedFeatureAttributes(updates);
      setSelectedFeature((prev) => (prev ? { ...prev, attributes: result.attributes } : prev));
      showToast("Attribute changes saved.", "success");
    } catch (err) {
      showToast(err.message || "Failed to save attribute changes.", "error");
    }
  }, [showToast]);

  // Drawings live in memory on the local GraphicsLayer, so editing them needs
  // no account and must keep working anonymously - that is the app's normal
  // mode. The hosted FeatureLayers are a different story: writing to them
  // needs a real credential, and offering the controls anyway meant the
  // rejection surfaced as IdentityManager's own sign-in modal. Hiding them
  // until there is a credential keeps the app read-only-usable instead of
  // appearing to require a login.
  const canEditSelectedFeature =
    selectedFeature?.layerId === "drawings" || Boolean(signedInUser);

  const handleAddColumn = useCallback(async (fieldName, defaultValue) => {
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
  }, [selectedFeature, showToast]);

  // Mirrors handleAddColumn: the engine owns the schema change, the shell
  // drops the key from the panel's copy of the attributes so the popup
  // reflects it without waiting for another hitTest.
  const handleDeleteColumn = useCallback(async (fieldName) => {
    if (!selectedFeature) return;
    try {
      await engineRef.current.deleteColumnFromLayer(selectedFeature.layerId, fieldName);
      setSelectedFeature((prev) => {
        if (!prev) return prev;
        const remaining = { ...prev.attributes };
        delete remaining[fieldName];
        return { ...prev, attributes: remaining };
      });
      showToast(`Column "${fieldName}" deleted.`, "success");
    } catch (err) {
      showToast(err.message || "Failed to delete column.", "error");
    }
  }, [selectedFeature, showToast]);

  // Deleting the selected feature itself, not one of its columns. The graphic
  // the panel was showing no longer exists, so the popup is closed rather than
  // left pointing at a deleted row; refreshLayers() picks up the drawings
  // layer's now-changed style groups when the feature was a local drawing.
  const handleDeleteFeature = useCallback(async () => {
    if (!selectedFeature) return;
    try {
      await engineRef.current.deleteSelectedFeature();
      setSelectedFeature(null);
      refreshLayers();
      showToast("Feature deleted.", "success");
    } catch (err) {
      showToast(err.message || "Failed to delete feature.", "error");
    }
  }, [refreshLayers, selectedFeature, showToast]);

  // Inline arrows in JSX would change identity every render and defeat the
  // memo on the components they're passed to, same as the handlers above.
  const closeFeaturePanel = useCallback(() => setSelectedFeature(null), []);
  const toggleSidebar = useCallback(() => setSidebarOpen((open) => !open), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const openLoadProjectPicker = useCallback(() => loadProjectInputRef.current?.click(), []);
  const handleLoadProjectFile = useCallback(
    ({ target }) => {
      const file = target.files?.[0];
      target.value = "";
      if (file) loadProject(file);
    },
    [loadProject]
  );

  // Chatbot / MCP System - see knowledge/features/chatbot-mcp-system.md.
  // mcp-chat-proxy is stateless and has no access to GISMapEngine (which
  // only exists in this browser tab), so every request it handles carries
  // this snapshot of what's actually on the map right now: `layers` is the
  // exact same array LayerControlPanel/AnalysisPanel already consume (no
  // new engine state), and `queryableLayerUrls` is the allow-list the
  // sidecar's query_layer_features/get_layer_statistics tools validate a
  // requested `url` against, so the model can only ever query a layer the
  // user already has on their map, not an arbitrary REST endpoint.
  // Field names per filterable layer, included in `mapContext` so the model
  // can name a real field on its FIRST attempt instead of guessing one. The
  // guess is not a small cost to absorb: on CPU-only Ollama a single turn is
  // dominated by prompt evaluation (~200s - see mcp-chat-proxy/config.js's
  // timeout note), so one avoidable failed round trip costs the user minutes,
  // where these few hundred extra prompt tokens cost essentially nothing.
  //
  // Keyed off the filterable ids only, deliberately not `layers` itself:
  // refreshLayers() runs on every layer mutation including a colour-picker
  // drag, and re-querying every layer's schema on each of those events would
  // spawn a promise per layer per drag event. The trade-off is that a column
  // added via addColumnToLayer after this ran isn't reflected here until the
  // layer set next changes - runClientAction reads the live schema anyway, so
  // that only costs one informed retry in that narrow case.
  const [chatLayerFields, setChatLayerFields] = useState({});
  const layerIdsKey = layers.filter(Boolean).map((l) => l.id).join(",");

  useEffect(() => {
    if (!CHAT_ENABLED) return undefined; // nothing else reads this
    let cancelled = false;
    const engine = engineRef.current;

    Promise.all(
      engine.getFilterableLayers().map(async ({ id }) => {
        const { fields } = await engine.getLayerFieldSchema(id);
        return [id, fields.map((f) => f.name)];
      })
    )
      .then((entries) => {
        if (!cancelled) setChatLayerFields(Object.fromEntries(entries));
      })
      // A schema lookup failing just means the model has to ask; it must
      // never break the app, same as getLayerFields' un-toasted contract.
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [layerIdsKey]);

  // One pass over `layers`, not three. This is derived from `layers`, which
  // refreshLayers() replaces after *every* engine mutation - including each
  // throttled commit of a colour or opacity drag (see
  // knowledge/features/performance.md 2/3) - so it re-runs far more often
  // than the chat itself is ever used.
  //
  // Gated on CHAT_ENABLED for the same reason the chatLayerFields prefetch
  // above is: with chat off nothing renders ChatPanel and nothing reads this,
  // so deriving it per drag frame is pure waste. The frozen constant also
  // keeps the identity stable in that case, which is what lets ChatPanel's
  // own memo() boundary hold.
  const mapContext = useMemo(() => {
    if (!CHAT_ENABLED) return EMPTY_MAP_CONTEXT;

    const contextLayers = [];
    const queryableLayerUrls = [];
    for (const layer of layers) {
      if (!layer) continue;
      const fields = chatLayerFields[layer.id];
      contextLayers.push(fields ? { ...layer, fields } : layer);
      // The allow-list assertUrlIsOnCurrentMap validates a model-supplied
      // `url` against - only URL-backed layers have one.
      if (layer.url) queryableLayerUrls.push(layer.url);
    }
    return { is3D, layers: contextLayers, queryableLayerUrls };
  }, [is3D, layers, chatLayerFields]);

  // Thin, un-toasted pass-throughs to ChatService - ChatPanel already shows
  // a failure inline in its own timeline, so there's no separate toast to
  // duplicate that (unlike every other service call in this file, which
  // has no equivalent inline surface of its own).
  const handleSendChatMessage = useCallback((messages, context) => sendChatMessage(messages, context), []);
  const handleSubmitChatToolResult = useCallback(
    (messages, context, callId, result) => sendToolResult(messages, context, callId, result),
    []
  );

  // Executes one client-domain chat tool call (see mcp-chat-proxy/toolSchemas.js)
  // against the real engine methods - the same ones the manual UI buttons
  // call - so a chat-driven action can do nothing a signed-in-or-not user
  // couldn't already do by clicking through the UI, and inherits the exact
  // same anonymous-first authorization checks (IdentityManager/canEdit)
  // those methods already enforce. Deliberately separate from the existing
  // createHeatmapLayer/createHexagonLayer/... useCallbacks above: those
  // already catch-and-toast internally with no return value, but the chat
  // loop needs a real {ok, data|error} outcome to report back to the model
  // (see ChatPanel.jsx's onSubmitToolResult call) - not just a toast side
  // effect - so this calls the engine directly instead of through them.
  // Still shows the same toasts those handlers would have, for a user
  // watching the map react to what the assistant just did.
  const runClientAction = useCallback(async (name, args) => {
    const engine = engineRef.current;
    try {
      switch (name) {
        case "create_heatmap_layer": {
          const result = engine.createHeatmapLayer(args.sourceId, {
            name: args.name,
            intensity: args.intensity
          });
          refreshLayers();
          showToast(`Added heatmap layer "${result.name}".`, "success");
          return { ok: true, data: result };
        }
        case "create_hexagon_layer": {
          const result = await engine.createHexagonLayer(args.sourceId, {
            name: args.name,
            cellSize: args.cellSize
          });
          refreshLayers();
          showToast(`Added hexagon layer "${result.name}".`, "success");
          return { ok: true, data: result };
        }
        // The chat's own way to establish a feature selection. Everything
        // selection-scoped (apply_buffer above all) previously depended on the
        // user having clicked the map themselves - a model asked to "buffer
        // Tampines MRT by 500m" could only ever report
        // "Select a feature on the map first."
        //
        // Deliberately routed through searchFeatures + zoomToSearchResult, the
        // exact pair GlobalSearchPanel's own result list uses, rather than a
        // new selection path: zoomToSearchResult already sets
        // selectedGraphic/selectedLayerId and fires onFeatureSelect, so a
        // chat-driven selection lands the app in the identical state a click
        // does, attribute popup included.
        case "select_feature": {
          const query = String(args.query || "").trim();
          if (!query) return { ok: false, error: "select_feature needs a non-empty query." };

          const matches = await engine.searchFeatures(query);
          const scoped = args.layerId ? matches.filter((m) => m.layerId === args.layerId) : matches;

          if (scoped.length === 0) {
            // Informative rather than bare, same contract as set_layer_filter's
            // unresolvable-field error: tell the model where it actually looked
            // so a retry is informed instead of another guess. Un-toasted - a
            // model-facing correction mid-turn, not a user-facing failure.
            const scope = args.layerId ? `layer "${args.layerId}"` : "any searchable layer";
            const elsewhere = args.layerId && matches.length
              ? ` It does match on: ${[...new Set(matches.map((m) => m.layerId))].join(", ")}.`
              : "";
            return { ok: false, error: `No feature matching "${query}" on ${scope}.${elsewhere}` };
          }

          const match = scoped[0];
          await engine.zoomToSearchResult(match);

          // zoomToSearchResult returns early (selecting nothing) when there is
          // no live view or the camera move fails, and reports that only by
          // leaving the selection untouched. Check rather than assume - an
          // ok:true the model then describes as done would be a false success.
          if (engine.selectedLayerId !== match.layerId) {
            return { ok: false, error: `Found "${match.label}" but could not select it - the map view did not respond.` };
          }

          refreshLayers();
          showToast(`Selected "${match.label}" on ${match.layerTitle}.`, "success");
          return {
            ok: true,
            data: {
              layerId: match.layerId,
              layerTitle: match.layerTitle,
              label: match.label,
              attributes: match.attributes,
              matchCount: scoped.length,
              // Capped: a search can return up to 10 per layer, and the point
              // is to let the model say "I picked X, you may have meant Y",
              // not to hand it the whole result set to re-rank.
              otherMatches: scoped.slice(1, 4).map((m) => ({ label: m.label, layerTitle: m.layerTitle }))
            }
          };
        }
        // Filter-aware counting/aggregation. Distinct from the server-side
        // get_layer_statistics tool on purpose: that one queries the service
        // URL and therefore ignores definitionExpression, while this reads the
        // live engine and so answers "how many are showing right now". It is
        // also the only aggregate available for `drawings`, which has no
        // service to query at all.
        case "get_layer_aggregate": {
          const aggregate = await engine.getLayerAggregate(args.id, {
            field: args.field,
            statistics: Array.isArray(args.statistics) ? args.statistics : []
          });
          // No toast: this reads, it does not change the map. The manual
          // Aggregate control in LayerControlPanel shows its result inline for
          // the same reason.
          return { ok: true, data: aggregate };
        }
        case "apply_buffer": {
          let captured = null;
          engine.bufferSelectedFeature(args.distance, args.unit || "meters", (message, type) => {
            captured = { message, type };
            showToast(message, type);
          });
          refreshLayers();
          if (captured?.type === "error") return { ok: false, error: captured.message };
          return { ok: true, data: { message: captured?.message } };
        }
        case "create_buffer_result_layer": {
          const result = engine.createBufferResultLayer(args.name);
          engine.clearBufferResult();
          refreshLayers();
          showToast(`Added buffer layer "${result.name}".`, "success");
          return { ok: true, data: result };
        }
        case "add_portal_layer": {
          if (!args.item?.id || !args.item?.url) {
            return { ok: false, error: "item must be an object with id/title/url from a prior search_portal_layers result." };
          }
          const layerId = await engine.addPortalLayer(args.item);
          refreshLayers();
          showToast(`Added "${args.item.title}" to layers.`, "success");
          // Returns the real layer id so a follow-up rename_layer call (a
          // separate tool call - see mcp-chat-proxy/chatLoop.js's system
          // prompt) has something to reference. A single add_portal_layer
          // call used to also accept an optional custom `name` directly,
          // but qwen2.5:1.5b reliably dropped that field even once it was
          // marked required in the schema - splitting "add" and "rename"
          // into two separate, single-purpose tool calls mirrors the
          // apply_buffer -> create_buffer_result_layer chain, which this
          // model already handles correctly.
          return { ok: true, data: { id: layerId, title: args.item.title } };
        }
        case "rename_layer": {
          engine.renameLayer(args.id, args.name);
          refreshLayers();
          showToast(`Renamed layer to "${args.name}".`, "success");
          return { ok: true, data: { id: args.id, name: args.name } };
        }
        case "set_layer_filter": {
          const layerName = engine.getLayers().find((l) => l?.id === args.id)?.name || args.id;
          const { fields } = await engine.getLayerFieldSchema(args.id);

          // Correct the model's field names against the real schema (see
          // resolveFieldName above) and, when one genuinely doesn't exist,
          // fail with the actual field list rather than the engine's bare
          // '"name" is not a field on this layer.' - the model's next attempt
          // is then informed instead of another guess.
          const conditions = [];
          const corrections = [];

          for (const rawCondition of args.conditions || []) {
            const condition = { ...rawCondition, operator: resolveOperatorToken(rawCondition.operator) };

            // LayerFilterExpression's usableConditions silently drops a
            // field-less condition, which is right for the manual UI (a
            // half-typed row shouldn't error on every keystroke) but wrong
            // here: a completed tool call that omitted the field would
            // silently clear the filter instead of applying one.
            let field = condition.field ? resolveFieldName(condition.field, fields) : null;

            // The model named no field this layer has. Rather than bouncing it
            // back to guess again, ask the data which field actually holds the
            // value it's looking for - a name like "Tampines" identifies its
            // own field far more reliably than a 1.5B model does.
            if (!field) {
              const inferred = await engine.inferFieldForValue(args.id, condition.value);
              if (inferred) {
                field = inferred.field;
                corrections.push(`searched ${field} (the field containing "${condition.value}")`);

                // The probe found the value as a SUBSTRING of the real value
                // (e.g. NAME is "TAMPINES MRT STATION", not "Tampines"), which
                // makes both whole-value comparisons provably useless: `=`
                // matches nothing and empties the layer, `<>` matches every
                // row and filters nothing. Each is promoted to its substring
                // equivalent, preserving include-vs-exclude intent. Promoted
                // on that evidence only - never on a hunch, and never when the
                // value IS the whole field value.
                const substringEquivalent = { "=": "contains", "<>": "doesNotContain" }[condition.operator];
                if (
                  substringEquivalent &&
                  inferred.matchedValue.toLowerCase() !== String(condition.value).toLowerCase()
                ) {
                  condition.operator = substringEquivalent;
                  corrections.push(`matched ${field} by substring rather than exactly, since values look like "${inferred.matchedValue}"`);
                }
              }
            }

            if (!field) {
              const available = fields.map((f) => f.name).join(", ") || "none";
              return {
                ok: false,
                error: `"${condition.field}" is not a field on "${layerName}", and no field on it contains "${condition.value}". Its fields are: ${available}. Retry with one of those exact names.`
              };
            }
            conditions.push({ ...condition, field });
          }

          const result = await engine.setLayerFilter(args.id, { conditions, logic: args.logic });
          refreshLayers();
          showToast(result.active ? `Filter applied to "${layerName}".` : `Filter cleared for "${layerName}".`, "success");
          // `corrections` is surfaced to the model so its reply to the user
          // describes the filter that was actually applied, not the one it
          // asked for - silently substituting a field would otherwise have it
          // confidently report the wrong thing.
          return { ok: true, data: corrections.length ? { ...result, corrections } : result };
        }
        case "set_layer_style": {
          engine.setLayerStyle(args.id, { color: args.color, borderWidth: args.borderWidth, opacity: args.opacity });
          refreshLayers();
          return { ok: true, data: { id: args.id } };
        }
        case "toggle_layer": {
          engine.toggleLayer(args.id);
          refreshLayers();
          return { ok: true, data: { id: args.id } };
        }
        case "zoom_to_layer": {
          await engine.zoomToLayer(args.id, showToast);
          refreshLayers();
          return { ok: true, data: { id: args.id } };
        }
        default:
          return { ok: false, error: `Unknown action: ${name}` };
      }
    } catch (err) {
      const message = err.message || "That action failed.";
      showToast(message, "error");
      return { ok: false, error: message };
    }
  }, [refreshLayers, showToast]);

  return (
    <div className="app">
      <button
        ref={sidebarToggleRef}
        className="sidebar-toggle"
        aria-label={sidebarOpen ? "Close panel" : "Open panel"}
        onClick={toggleSidebar}
      >
        <Icon name={sidebarOpen ? "close" : "menu"} />
      </button>

      {sidebarOpen && (
        <button
          type="button"
          className="side-panel-backdrop"
          aria-label="Close panel"
          onClick={closeSidebar}
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
            onClick={openLoadProjectPicker}
          >
            <Icon name="folder" size={16} />
            Load Project
          </button>
          <input
            ref={loadProjectInputRef}
            hidden
            type="file"
            accept=".json"
            onChange={handleLoadProjectFile}
          />
        </div>

        <ViewModeToggle
          is3D={is3D}
          setIs3D={toggleViewMode}
          basemapId={basemapId}
          onChangeBasemap={changeBasemap}
        />

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
          onRename={renameLayer}
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
          lineOfSightActive={lineOfSightActive}
          onToggleLineOfSight={toggleLineOfSight}
          viewshedActive={viewshedActive}
          onToggleViewshed={toggleViewshed}
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
          onCreateHexagonLayer={createHexagonLayer}
          onReverseGeocode={handleReverseGeocode}
        />

        <PortalLayerPanel
          onSearch={searchPortal}
          onAddLayer={addPortalLayer}
        />

        <CreateFeatureLayerPanel
          onCreateLayer={createHostedFeatureLayer}
          signedInUser={signedInUser}
        />

        {CHAT_ENABLED && (
          <ChatPanel
            mapContext={mapContext}
            onSendMessage={handleSendChatMessage}
            onSubmitToolResult={handleSubmitChatToolResult}
            onRunClientAction={runClientAction}
          />
        )}
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
          activeDrawType={activeDrawType}
          onCancelDraw={cancelDraw}
          drawTargetLayerId={drawTargetLayerId}
          drawTargetOptions={drawTargetOptions}
          onChangeDrawTarget={setDrawTarget}
          />
        <FeatureAttributesPanel
          feature={selectedFeature}
          onClose={closeFeaturePanel}
          onSaveAttributes={handleSaveAttributes}
          onAddColumn={handleAddColumn}
          onDeleteColumn={handleDeleteColumn}
          onDeleteFeature={handleDeleteFeature}
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