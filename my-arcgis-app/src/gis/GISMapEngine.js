import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import {
  TOURIST_ATTRACTIONS_FEATURE_LAYER_URL,
  MRT_STATION_FEATURE_LAYER_URL,
  MRT_LINE_FEATURE_LAYER_URL,
  PORTAL_URL
} from "../config/ArcGISConfiguration";
import SketchViewModel from "@arcgis/core/widgets/Sketch/SketchViewModel";
import Slice from "@arcgis/core/widgets/Slice";
import { geodesicBuffer } from "@arcgis/core/geometry/geometryEngine";
import IdentityManager from "@arcgis/core/identity/IdentityManager";
import esriRequest from "@arcgis/core/request";
import {
  normalizeFieldType,
  buildWhereClause,
  matchesAttributes,
  describeFilter
} from "./LayerFilterExpression";
import {
  applyExtendedSymbolStyle,
  buildHaloSymbol,
  buildUniqueValueRenderer,
  buildClassBreaksRenderer,
  buildHeatmapRenderer,
  toArcGISRenderer,
  DEFAULT_UNIQUE_VALUE_LIMIT
} from "./SymbolRenderers";

// Handles both a real ArcGIS Color instance (has .toHex()) and the plain
// [r, g, b]/[r, g, b, a] arrays this file's hardcoded renderer literals use
// before they've ever been through a live layer's autocast/.clone() - without
// this fallback, reading a symbol's color before any styling edit (e.g. for
// the layer panel's initial swatch value) always came back "#000000".
function colorToHex(color) {
  if (typeof color?.toHex === "function") return color.toHex();
  if (typeof color === "string" && color.startsWith("#")) return color;
  if (Array.isArray(color) && color.length >= 3) {
    return `#${color.slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
  }
  return "#000000";
}

const UPLOAD_SYMBOL_TYPE_BY_GEOMETRY = {
  Point: "simple-marker",
  LineString: "simple-line"
};

const UPLOAD_SYMBOL_COLOR_BY_GEOMETRY = {
  Point: "red",
  LineString: "blue"
};

export default class GISMapEngine {
  currentMap = null;
  currentView = null;

  routeLayer = null;
  stopLayer = null;
  searchLayer = null;

  routeGraphic = null;
  startGraphic = null;
  endGraphic = null;
  searchGraphic = null;

  routeVisible = true;
  searchVisible = true;

  layerOrder = [
    "route",
    "stops",
    "touristAttractions",
    "mrtStations",
    "mrtLines",
    "drawings",
    "searchResult"
  ];

  touristAttractionLayer = null;
  mrtStationLayer = null;
  mrtLineLayer = null;

  // User-added layers picked from an ArcGIS portal search (see
  // addPortalLayer/removePortalLayer). portalLayers holds the live
  // FeatureLayer instances (keyed by a synthetic "portal_<itemId>" id, same
  // id space as layerOrder); portalLayerMeta holds the plain {title, url,
  // visible} data needed to recreate those FeatureLayers on every
  // attachToView call, the same way touristAttractionRenderer/etc. survive
  // reattachment for the built-in FeatureLayers.
  portalLayers = new Map();
  portalLayerMeta = new Map();

  // User-created named heatmap layers (see createHeatmapLayer/
  // removeHeatmapLayer) - the discoverable, "add to the layers card" way to
  // run heatmap analysis on a hosted/portal point layer, alongside the
  // in-place Heatmap renderer mode any eligible layer's own Symbology
  // section already offers (see knowledge/index.md's Heatmap System).
  // Structurally identical to portalLayers/portalLayerMeta above (live
  // FeatureLayer instances vs. the plain {title, url, sourceId, intensity,
  // radius, visible} data needed to recreate them on every attachToView
  // call) - kept as a separate pair of Maps, not merged into portalLayers,
  // because these layers didn't come from a portal search and conflating
  // the two would misdescribe where they came from. Keyed by a synthetic
  // "heatmap_<id>" id, same id space as layerOrder/portalLayers.
  heatmapLayers = new Map();
  heatmapLayerMeta = new Map();

  // User-saved named route-result layers (see createRouteResultLayer/
  // removeRouteResultLayer) - lets a user snapshot the current route (with
  // its start/end stops) as an independently named/toggleable/removable
  // layer in the Layers card, since the live routeLayer/stopLayer (see
  // below) are excluded from that card and always reflect only the most
  // recent route search. Structurally identical to heatmapLayers/
  // heatmapLayerMeta above but GraphicsLayer-backed (a route result has no
  // service `url` to duplicate, unlike a heatmap source) -
  // namedRouteLayerMeta stores plain-JSON snapshots of the route/stop
  // graphics (graphicToJSON/graphicFromJSON, the same shapes Project
  // Persistence already uses) so they can be rebuilt on every attachToView
  // call the same way portal/heatmap layers are. Keyed by a synthetic
  // "route_<id>" id, same id space as layerOrder/portalLayers/heatmapLayers.
  namedRouteLayers = new Map();
  namedRouteLayerMeta = new Map();

  // User-saved named search-result layers (see createSearchResultLayer/
  // removeSearchResultLayer) - the discoverable "add to the layers card" way
  // to keep a geocoded address marker around, since the live searchLayer
  // (see searchGraphic/searchVisible above) is excluded from that card and
  // always reflects only the most recent address search. Structurally
  // identical to namedRouteLayers/namedRouteLayerMeta above but snapshots a
  // single point graphic instead of a route+stops trio. Keyed by a synthetic
  // "search_<id>" id, same id space as layerOrder/portalLayers/heatmapLayers/
  // namedRouteLayers.
  namedSearchLayers = new Map();
  namedSearchLayerMeta = new Map();

  touristAttractionVisible = true;
  mrtStationVisible = true;
  mrtLineVisible = true;

  // FeatureLayers (touristAttractionLayer/mrtStationLayer/mrtLineLayer) are
  // rebuilt from scratch on every attachToView call (e.g. 2D/3D switches),
  // so their renderers can't be relied on to hold runtime style changes
  // the way the persisted route/drawings graphics do. These fields are the
  // actual source of truth for their styling: attachToView seeds each new
  // layer from here, and setLayerStyle updates both the live layer's
  // renderer and this field, so styling survives reattachment.
  touristAttractionRenderer = {
    type: "simple",
    symbol: {
      type: "simple-marker",
      color: [255, 165, 0],
      size: 8,
      outline: { color: [255, 255, 255], width: 1 }
    }
  };
  mrtStationRenderer = {
    type: "simple",
    symbol: {
      type: "simple-fill",
      color: [0, 120, 255, 0.5],
      outline: { color: [0, 0, 0], width: 1.5 }
    }
  };
  mrtLineRenderer = {
    type: "simple",
    symbol: { type: "simple-line", color: [0, 0, 0], width: 1 }
  };

  drawLayer = new GraphicsLayer({ title: "Drawings", elevationInfo: { mode: "on-the-ground" } });
  sketchVM = null;

  // Spatial Analysis (Buffer + Slice) - see the "ANALYSIS" sidebar card.
  // Both tools are deliberately restricted to the 3D SceneView: Slice is an
  // ArcGIS widget that only ever operates against a SceneView to begin
  // with, and Buffer is held under the same restriction so the card offers
  // one consistent "3D only" rule rather than one tool working in 2D and
  // the other silently failing there. sliceWidget is null whenever Slice
  // is inactive; it is bound directly to the live SceneView, so it cannot
  // survive a 2D/3D reattachment and is torn down in detachFromView.
  sliceWidget = null;

  uploadedLayers = [];

  onFeatureSelect = null;
  clickHandle = null;
  onDrawingsChanged = null;
  onDrawStateChange = null;
  activeDrawType = null;

  // Client-side "schema" for the drawings layer: drawLayer is a local
  // GraphicsLayer with no backing service, so added columns are tracked
  // here and applied to every graphic instead of via a REST field definition.
  drawingFields = [];

  // Active per-layer filters (see src/gis/LayerFilterExpression.js), keyed by
  // layerOrder/portal id. This is the actual source of truth for "is this
  // layer filtered right now" - a hosted FeatureLayer's own
  // definitionExpression and the drawings layer's per-graphic `visible`
  // flags are just the two different mechanisms used to *apply* whatever is
  // stored here, and both are re-derived from this map, never the other way
  // around. This also survives an attachToView reattachment (2D/3D switch)
  // the same way touristAttractionRenderer/etc. do for styling: the fixed
  // FeatureLayer-backed layers are fully reconstructed on every attach, so
  // their definitionExpression would otherwise silently reset.
  layerFilters = new Map();

  // Layers with a real attribute schema worth filtering/aggregating over.
  // route/stops/searchResult are excluded for the same reasons they're
  // excluded from the Layer Styling System (knowledge/index.md): route is one
  // unattributed line, stops are two fixed markers, and searchResult is a
  // transient single marker replaced on every search. Heatmap is no longer a
  // distinct layer id (see the Heatmap System section) - it's a renderer mode
  // any of the remaining, still-filterable point layers can be switched into.
  static ANALYSIS_EXCLUDED_LAYER_IDS = new Set(["route", "stops", "searchResult"]);

  // Single source of truth for "which engine field mirrors this layer's
  // visibility", shared by toggleLayer and zoomToLayer's reveal-if-hidden
  // step (previously two independent copies of the same lookup - see each
  // call site). This is also what Project Persistence (below) reads/writes,
  // so a layer hidden via the ordinary eye-icon toggle is what a saved
  // project actually remembers, not just a layer hidden via zoomToLayer's
  // reveal path.
  static VISIBILITY_FIELD_BY_LAYER_ID = {
    route: "routeVisible",
    touristAttractions: "touristAttractionVisible",
    mrtStations: "mrtStationVisible",
    mrtLines: "mrtLineVisible",
    searchResult: "searchVisible"
  };

  // Active per-layer annotation (map-label) field, keyed by layerOrder/portal
  // id - same source-of-truth role as layerFilters above, and the same
  // reason it needs to survive attachToView: the FeatureLayer-backed layers
  // this applies to are fully reconstructed on every 2D/3D switch, so a
  // layer's own `labelingInfo` can't be relied on to hold a runtime change.
  layerAnnotations = new Map();

  // Advanced renderer override (Unique Values / Class Breaks), keyed by
  // layerOrder/portal id - source of truth the same way layerFilters/
  // layerAnnotations are: when present for an id, it (not
  // touristAttractionRenderer/etc.) is what gets applied to the live layer.
  // Absence means "simple mode". Unlike layerFilters/layerAnnotations this
  // needs no fire-and-forget reapply step on attachToView: a generated
  // renderer is already a complete, self-contained JSON object (no
  // per-reattach requery), so resolveSeedRenderer just reads it synchronously
  // at layer-construction time. See knowledge/index.md's Layer Styling System.
  //
  // For "drawings" the stored value is not a ready-to-assign ArcGIS renderer
  // but the same unique-value/class-breaks JSON shape evaluated per graphic
  // by applyDrawingsRendererToGraphic, since drawLayer has no single
  // `.renderer` to assign to (each graphic owns its own `.symbol`, same
  // constraint applyDrawingsFilterToGraphic already works around for
  // filters). Only one style-group (symbolType) of drawings can have an
  // active advanced renderer at a time - see the `symbolType` field on the
  // stored descriptor.
  layerRenderers = new Map();

  // Multi-layer symbol support (see knowledge/index.md's Layer Styling
  // System "multi-layer symbols" scope note): a halo is a two-layer CIM
  // point symbol (an outer ring behind the base marker), the single most
  // common ArcGIS Pro multi-layer use case. Scoped to FeatureLayer-backed/
  // portal simple-marker renderers only - not drawings/route - because a CIM
  // composite's `.type` is "cim" rather than "simple-marker", which would
  // break the symbolType-keyed grouping drawings/filter/style rely on
  // throughout the engine. Keyed by layerOrder/portal id -> { color, size }.
  haloState = new Map();

  selectedGraphic = null;
  selectedLayerId = null;

  setOnFeatureSelect(callback) {
    this.onFeatureSelect = callback;
  }

  // Notifies the shell whenever the set of drawn graphics changes shape
  // (a new point/line/polygon completes), so the layer panel can re-derive
  // the Drawings layer's style groups instead of holding onto the stale
  // list from before the new graphic existed.
  setOnDrawingsChanged(callback) {
    this.onDrawingsChanged = callback;
  }

  // Notifies the shell when a sketch starts/stops, so the UI can show a
  // "drawing in progress" cue instead of leaving the user unsure whether
  // the map is armed after picking a draw tool.
  setOnDrawStateChange(callback) {
    this.onDrawStateChange = callback;
  }

  // Must be called BEFORE the outgoing <arcgis-map>/<arcgis-scene> custom
  // element unmounts (i.e. before the is3D state flip that swaps one for
  // the other), not just at the top of the next attachToView. The web
  // component destroys its own ArcGIS Map on disconnect, and Map#destroy()
  // cascades to destroy() every Layer still attached to it - including our
  // persistent, engine-owned layers (drawLayer, routeLayer, etc.), which
  // permanently wipes their graphics. map.removeAll() only detaches layers
  // (it does not destroy them), so calling it here, synchronously, before
  // React ever tears down the old view, gets our layers out of the blast
  // radius in time. This matters even more when the incoming view is slow
  // or fails to become ready (e.g. a WebGL hiccup): attachToView for the
  // new view may never run at all, so anything relying on it to rescue the
  // old map's layers loses them for the rest of the session.
  detachFromView() {
    this.currentMap?.removeAll();
    // sliceWidget holds a live reference into this.currentView's own UI
    // (view.ui.add), so it must be torn down here - before that view is
    // destroyed by the outgoing custom element's unmount - rather than left
    // for attachToView to discover once currentView has already been
    // overwritten with the new view.
    if (this.sliceWidget) {
      this.currentView?.ui.remove(this.sliceWidget);
      this.sliceWidget.destroy();
      this.sliceWidget = null;
    }
  }

  // Single source of truth for id -> layer resolution, used by every
  // operation that looks a layer up by its layerOrder id (attachToView,
  // toggleLayer, zoomToLayer, reorderLayers). Portal layers are spread in
  // from the live portalLayers map so they're resolvable the same way as
  // the built-in layers, without duplicating this literal at each call site.
  buildLayerMap() {
    return {
      route: this.routeLayer,
      stops: this.stopLayer,
      touristAttractions: this.touristAttractionLayer,
      mrtStations: this.mrtStationLayer,
      mrtLines: this.mrtLineLayer,
      drawings: this.drawLayer,
      searchResult: this.searchLayer,
      ...Object.fromEntries(this.portalLayers),
      ...Object.fromEntries(this.heatmapLayers),
      ...Object.fromEntries(this.namedRouteLayers),
      ...Object.fromEntries(this.namedSearchLayers)
    };
  }

  // Resolves what renderer a freshly (re)constructed FeatureLayer should
  // start with: an active advanced renderer (layerRenderers) takes priority
  // over the persisted simple base, and an active halo (haloState) is
  // composited on top of whichever simple-marker symbol results - the same
  // precedence setLayerStyle applies live, kept in one place so attachToView
  // and the portal-layer reconstruction below can't drift apart on it. Halo
  // only applies on top of a *simple* renderer (guarded by the `.symbol`
  // check), since a Unique Values/Class Breaks renderer has no single
  // top-level symbol to wrap - see the haloState field comment.
  resolveSeedRenderer(id, baseRenderer) {
    const advanced = this.layerRenderers.get(id);
    const rendererJson = advanced ? toArcGISRenderer(advanced) : baseRenderer;

    const haloEntry = this.haloState.get(id);
    if (!haloEntry || rendererJson?.symbol?.type !== "simple-marker") return rendererJson;

    return {
      ...rendererJson,
      symbol: buildHaloSymbol(colorToHex(rendererJson.symbol.color), rendererJson.symbol.size, {
        color: haloEntry.color ?? "#ffffff",
        size: haloEntry.size
      })
    };
  }

  attachToView(view) {
    if (!view) return;

    const map = view.map;
    const existingDrawings = this.drawLayer.graphics.toArray();
    const previousExtent = this.currentView?.extent;

    this.currentMap = map;
    this.currentView = view;

    map.removeAll();

    this.routeLayer = new GraphicsLayer({ title: "Route Layer", visible: this.routeVisible });
    this.stopLayer  = new GraphicsLayer({ title: "Stop Layer",  visible: this.routeVisible });
    this.searchLayer = new GraphicsLayer({ title: "Search Result", visible: this.searchVisible });

    this.touristAttractionLayer = new FeatureLayer({
      url: TOURIST_ATTRACTIONS_FEATURE_LAYER_URL,
      title: "Tourist Attractions",
      visible: this.touristAttractionVisible,
      outFields: ["*"],
      renderer: this.resolveSeedRenderer("touristAttractions", this.touristAttractionRenderer)
    });

    this.mrtStationLayer = new FeatureLayer({
      url: MRT_STATION_FEATURE_LAYER_URL,
      title: "MRT Stations",
      visible: this.mrtStationVisible,
      outFields: ["*"],
      renderer: this.resolveSeedRenderer("mrtStations", this.mrtStationRenderer)
    });

    this.mrtLineLayer = new FeatureLayer({
      url: MRT_LINE_FEATURE_LAYER_URL,
      title: "MRT Lines",
      visible: this.mrtLineVisible,
      outFields: ["*"],
      renderer: this.resolveSeedRenderer("mrtLines", this.mrtLineRenderer)
    });

    // `geometryType` (used by getLayers()'s heatmapEligible computation - see
    // isPointGeometry's comment) is only populated once each service's own
    // metadata has loaded, not synchronously off a freshly constructed
    // FeatureLayer - same timing constraint documented for `.renderer`
    // elsewhere in this file. Without this, the very first getLayers() call
    // after a fresh attachToView (which ApplicationShell makes immediately,
    // before either service could plausibly have finished loading) would
    // always report both fixed layers as heatmap-ineligible, even when
    // they're genuinely point data - onDrawingsChanged is reused here purely
    // as the existing "please refresh the layer list" signal, not because
    // this has anything to do with drawings.
    this.touristAttractionLayer.load().then(() => this.onDrawingsChanged?.()).catch(() => {});
    this.mrtStationLayer.load().then(() => this.onDrawingsChanged?.()).catch(() => {});

    // The previous SketchViewModel (if any) is still bound to the outgoing
    // view, which is about to be torn down by React unmounting the old
    // <arcgis-map>/<arcgis-scene> element. If it's left alive, a mid-sketch
    // "create" session on it never reaches "complete" (so its graphic is
    // never committed to drawLayer) and it can throw once its view is
    // destroyed. Cancel and destroy it before wiring up the new one.
    if (this.sketchVM) {
      this.sketchVM.cancel();
      this.sketchVM.destroy();
    }

    this.sketchVM = new SketchViewModel({
      view,
      layer: this.drawLayer
    });

    this.sketchVM.on("create", (event) => {
      if (event.state === "start") {
        this.onDrawStateChange?.(this.activeDrawType);
      } else if (event.state === "complete") {
        event.graphic.attributes = this.buildDrawingAttributes();
        this.applyDrawingsFilterToGraphic(event.graphic);
        this.applyDrawingsRendererToGraphic(event.graphic);
        this.onDrawingsChanged?.();
        this.activeDrawType = null;
        this.onDrawStateChange?.(null);
      } else if (event.state === "cancel") {
        this.activeDrawType = null;
        this.onDrawStateChange?.(null);
      }
    });

    if (this.routeGraphic) this.routeLayer.add(this.routeGraphic);
    if (this.startGraphic) this.stopLayer.add(this.startGraphic);
    if (this.endGraphic) this.stopLayer.add(this.endGraphic);
    if (this.searchGraphic) this.searchLayer.add(this.searchGraphic);

    if (existingDrawings.length) {
      // Defensively drop any graphic with no geometry (e.g. left over from
      // an unsupported-type GeoJSON upload prior to the fix in
      // uploadGeoJSON). A null-geometry graphic in drawLayer makes the
      // ArcGIS LayerView throw while building the Drawings layer's render
      // batch on every reattach, which hides every drawing - not just the
      // bad one - each time the view is rebuilt (e.g. every 2D/3D switch).
      const validDrawings = existingDrawings.filter((g) => g.geometry !== null);
      this.drawLayer.removeAll();
      this.drawLayer.addMany(validDrawings);
    }

    // Portal-added FeatureLayers are, like touristAttractionLayer/mrtStation
    // Layer/mrtLineLayer, fully reconstructed on every attachToView call
    // rather than reused across it - portalLayerMeta (title/url/visible) is
    // their real source of truth, so a stale/detached FeatureLayer instance
    // is never relied on to survive a 2D/3D switch.
    this.portalLayers = new Map();
    this.portalLayerMeta.forEach((meta, id) => {
      const rebuilt = new FeatureLayer({
        url: meta.url,
        title: meta.title,
        visible: meta.visible,
        outFields: ["*"]
      });
      // A persisted style (see setLayerStyle's portal-layer branch) is not
      // carried by a fresh FeatureLayer instance, so it must be reapplied
      // once the layer loads and its own renderer is available to clone the
      // geometry-appropriate shape from. resolveSeedRenderer additionally
      // layers in an active advanced renderer (layerRenderers) and/or halo
      // (haloState), same precedence as the three fixed hosted layers above.
      if (meta.renderer || this.layerRenderers.has(id) || this.haloState.has(id)) {
        rebuilt.load().then(() => {
          rebuilt.renderer = this.resolveSeedRenderer(id, meta.renderer);
        }).catch(() => {});
      }
      this.portalLayers.set(id, rebuilt);
    });

    // Named heatmap layers (see createHeatmapLayer) are reconstructed the
    // same way and for the same reason as portal layers above: a fresh
    // FeatureLayer instance is cheap, and heatmapLayerMeta (not the live
    // layer object) is the real source of truth for url/title/intensity/
    // radius/visibility across a 2D/3D reattachment.
    this.heatmapLayers = new Map();
    this.heatmapLayerMeta.forEach((meta, id) => {
      const rebuilt = new FeatureLayer({
        url: meta.url,
        title: meta.title,
        visible: meta.visible,
        outFields: ["*"],
        opacity: 0.8,
        renderer: buildHeatmapRenderer(meta.intensity, meta.radius).renderer
      });
      this.heatmapLayers.set(id, rebuilt);
    });

    // Named route-result layers (see createRouteResultLayer) are
    // reconstructed the same way and for the same reason as heatmap layers
    // above: a fresh GraphicsLayer is cheap, and namedRouteLayerMeta (not
    // the live layer object) is the real source of truth for its graphics/
    // title/visibility across a 2D/3D reattachment.
    this.namedRouteLayers = new Map();
    this.namedRouteLayerMeta.forEach((meta, id) => {
      const rebuilt = new GraphicsLayer({ title: meta.title, visible: meta.visible });
      const graphics = [meta.route, meta.start, meta.end]
        .map((g) => this.graphicFromJSON(g))
        .filter(Boolean);
      rebuilt.addMany(graphics);
      this.namedRouteLayers.set(id, rebuilt);
    });

    // Named search-result layers (see createSearchResultLayer) are
    // reconstructed the same way and for the same reason as named
    // route-result layers above: a fresh GraphicsLayer is cheap, and
    // namedSearchLayerMeta (not the live layer object) is the real source of
    // truth for its graphic/title/visibility across a 2D/3D reattachment.
    this.namedSearchLayers = new Map();
    this.namedSearchLayerMeta.forEach((meta, id) => {
      const rebuilt = new GraphicsLayer({ title: meta.title, visible: meta.visible });
      const graphic = this.graphicFromJSON(meta.marker);
      if (graphic) rebuilt.add(graphic);
      this.namedSearchLayers.set(id, rebuilt);
    });

    const layerMap = this.buildLayerMap();

    this.layerOrder.forEach((id) => {
      const layer = layerMap[id];
      if (layer) map.add(layer);
    });

    if (this.clickHandle) this.clickHandle.remove();
    this.clickHandle = view.on("click", (event) => this.handleFeatureClick(event));

    // The FeatureLayer-backed layers above are fresh instances, so any
    // definitionExpression a user had applied via setLayerFilter needs to be
    // recomputed and reassigned - see the layerFilters field comment.
    // Fire-and-forget: it depends on each layer's fields loading, which
    // attachToView itself does not (and should not) block on.
    this.reapplyPersistedFilters();

    // Same rebuild-then-fire-and-forget-reapply pattern as filters above -
    // touristAttractions/mrtStations/mrtLines/portal layers are fresh
    // FeatureLayer instances here, so any labelingInfo a user applied via
    // setLayerAnnotation needs recomputing against the new instance.
    this.reapplyPersistedAnnotations();

    if (previousExtent) {
      view.goTo(previousExtent).catch(() => {});
    }
  }

  handleFeatureClick(event) {
    if (!this.currentView) return;

    const selectableLayers = [
      this.touristAttractionLayer,
      this.mrtStationLayer,
      this.mrtLineLayer,
      this.drawLayer,
      ...this.portalLayers.values()
    ].filter(Boolean);

    this.currentView
      .hitTest(event, { include: selectableLayers })
      .then((response) => {
        const result = response.results.find((r) => r.graphic?.attributes);

        if (result) {
          const layer = result.graphic.layer;
          const layerId = this.resolveLayerId(layer);

          this.selectedGraphic = result.graphic;
          this.selectedLayerId = layerId;

          this.onFeatureSelect?.({
            layerId,
            layerTitle: layer?.title || "Feature",
            objectIdField: layer?.objectIdField || null,
            attributes: result.graphic.attributes,
            x: event.x,
            y: event.y
          });
        } else {
          this.selectedGraphic = null;
          this.selectedLayerId = null;
          this.onFeatureSelect?.(null);
        }
      });
  }

  resolveLayerId(layer) {
    if (layer === this.touristAttractionLayer) return "touristAttractions";
    if (layer === this.mrtStationLayer) return "mrtStations";
    if (layer === this.mrtLineLayer) return "mrtLines";
    if (layer === this.drawLayer) return "drawings";
    for (const [id, portalLayer] of this.portalLayers) {
      if (layer === portalLayer) return id;
    }
    return null;
  }

  hostedLayerById(layerId) {
    return {
      touristAttractions: this.touristAttractionLayer,
      mrtStations: this.mrtStationLayer,
      mrtLines: this.mrtLineLayer
    }[layerId] || this.portalLayers.get(layerId) || null;
  }

  buildDrawingAttributes(overrides = {}) {
    const attributes = {};
    this.drawingFields.forEach((field) => {
      attributes[field.name] = field.defaultValue ?? null;
    });
    return { ...attributes, ...overrides };
  }

  // ---------------------------------------------------------------------
  // Spatial Analysis System (Buffer + Slice)
  //
  // Slice is gated on isSceneView() - it wraps an ArcGIS widget that only
  // ever operates against a SceneView to begin with (see the sliceWidget
  // field comment). Buffer has no such technical constraint - geodesicBuffer
  // is pure geometry math, independent of the current view - so it works in
  // both 2D and 3D. Buffer results are added to the existing drawLayer
  // rather than a dedicated layer, so they get styling/filtering/export for
  // free through the machinery drawings already have, tagged with
  // attributes.analysisType so they're identifiable if that's ever needed.
  // ---------------------------------------------------------------------

  isSceneView() {
    return this.currentView?.type === "3d";
  }

  isSliceActive() {
    return Boolean(this.sliceWidget);
  }

  // Buffers the currently-selected feature (see handleFeatureClick) by the
  // given distance/unit and adds the resulting polygon to drawLayer. Works
  // in both 2D and 3D. msg is the shell's showToast, invoked here (rather
  // than thrown) since there is no calling code that needs to branch on
  // success/failure beyond telling the user, matching zoomToLayer/
  // uploadGeoJSON's msg-callback convention.
  bufferSelectedFeature(distance, unit = "meters", msg) {
    if (!this.selectedGraphic?.geometry) {
      msg?.("Select a feature on the map first.", "error");
      return;
    }
    if (!Number.isFinite(distance) || distance <= 0) {
      msg?.("Enter a buffer distance greater than 0.", "error");
      return;
    }

    let bufferGeometry;
    try {
      bufferGeometry = geodesicBuffer(this.selectedGraphic.geometry, distance, unit);
    } catch {
      bufferGeometry = null;
    }
    if (!bufferGeometry) {
      msg?.("Could not buffer the selected feature.", "error");
      return;
    }

    const graphic = new Graphic({
      geometry: bufferGeometry,
      symbol: {
        type: "simple-fill",
        color: [255, 140, 0, 0.3],
        outline: { color: [255, 140, 0, 0.9], width: 1.5 }
      },
      attributes: this.buildDrawingAttributes({
        analysisType: "buffer",
        bufferDistance: distance,
        bufferUnit: unit
      })
    });

    this.drawLayer.add(graphic);
    this.applyDrawingsFilterToGraphic(graphic);
    this.onDrawingsChanged?.();
    msg?.(`Buffer created (${distance} ${unit}).`, "success");
  }

  // Starts/stops the ArcGIS Slice widget, which lets the user drag out a
  // box to interactively cut away part of the 3D scene. The widget owns its
  // own on-map UI once added (view.ui.add) - there is nothing further for
  // the engine to drive once it's active.
  startSlice(msg) {
    if (!this.isSceneView()) {
      msg?.("Slice is only available in 3D view.", "error");
      return;
    }
    if (this.sliceWidget) return;

    this.sliceWidget = new Slice({ view: this.currentView });
    this.currentView.ui.add(this.sliceWidget, "top-right");
  }

  stopSlice() {
    if (!this.sliceWidget) return;
    this.currentView?.ui.remove(this.sliceWidget);
    this.sliceWidget.destroy();
    this.sliceWidget = null;
  }

  // ---------------------------------------------------------------------
  // Filter & Aggregate System
  //
  // Lets a user narrow (filter) and summarize (aggregate) any layer with a
  // real attribute schema - the hosted FeatureLayers (touristAttractions,
  // mrtStations, mrtLines, portal layers) and the local drawings layer -
  // through one shared vocabulary (src/gis/LayerFilterExpression.js) even
  // though the two layer kinds enforce a filter completely differently:
  // a FeatureLayer's `definitionExpression` (server-side) vs. the drawings
  // layer's per-graphic `visible` flag (client-side, since drawLayer has no
  // backing service to query). See the `layerFilters` field comment above
  // for why that map, not either applied mechanism, is the source of truth.
  // ---------------------------------------------------------------------

  // Every id this system will offer in the filter/aggregate UI: the three
  // fixed hosted layers, drawings, and any portal-added layers (whose ids
  // are only known at runtime, same pattern as getLayers()/searchFeatures()).
  filterableLayerIds() {
    const fixed = this.layerOrder.filter(
      (id) => !GISMapEngine.ANALYSIS_EXCLUDED_LAYER_IDS.has(id) && !id.startsWith("heatmap_")
    );
    return fixed;
  }

  getFilterableLayers() {
    const byId = new Map(this.getLayers().filter(Boolean).map((l) => [l.id, l.name]));
    return this.filterableLayerIds()
      .filter((id) => byId.has(id))
      .map((id) => ({ id, name: byId.get(id) }));
  }

  // Client-side schema for the drawings layer: drawingFields is the explicit
  // "columns" a user added (see addColumnToLayer), but uploaded GeoJSON can
  // also carry properties that were never formally added as a column, so
  // those are picked up too by sampling the graphics actually present.
  drawingsFieldSchema() {
    const known = new Map(
      this.drawingFields.map((f) => [f.name, normalizeFieldType(f.type)])
    );
    this.drawLayer.graphics.forEach((g) => {
      Object.entries(g.attributes || {}).forEach(([name, value]) => {
        if (known.has(name)) return;
        const kind =
          typeof value === "number" ? "number" : value instanceof Date ? "date" : "string";
        known.set(name, kind);
      });
    });
    return { fields: Array.from(known, ([name, kind]) => ({ name, kind })) };
  }

  // Returns { fields: [{ name, kind }] } for the given layer id, `kind`
  // being LayerFilterExpression's normalized string/number/date/other
  // vocabulary rather than the raw esriFieldType* name.
  async getLayerFieldSchema(id) {
    if (id === "drawings") return this.drawingsFieldSchema();

    const layer = this.buildLayerMap()[id];
    if (!layer || typeof layer.load !== "function") return { fields: [] };

    await layer.load();
    const fields = (layer.fields || [])
      .filter((f) => f.type !== "esriFieldTypeOID" && f.type !== "esriFieldTypeGeometry")
      .map((f) => ({ name: f.name, kind: normalizeFieldType(f.type) }));
    return { fields };
  }

  // Sets graphic.visible to reflect the currently active drawings filter (if
  // any). Called both when applying/clearing a filter over the whole layer
  // and per-graphic, for a graphic that's created *after* a filter is
  // already active (a new sketch, or an upload) - without this, a freshly
  // drawn/uploaded feature would always render regardless of the active
  // filter until the next unrelated refresh touched it.
  applyDrawingsFilterToGraphic(graphic, fields) {
    const filter = this.layerFilters.get("drawings");
    if (!filter) {
      graphic.visible = true;
      return;
    }
    const resolvedFields = fields ?? this.drawingsFieldSchema().fields;
    graphic.visible = matchesAttributes(graphic.attributes, resolvedFields, filter);
  }

  // Applies `where` (already validated/built by setLayerFilter or
  // reapplyPersistedFilters) to a hosted FeatureLayer's definitionExpression,
  // or, for drawings, re-derives every graphic's visible flag from `fields`.
  applyFilterToLayer(id, fields, where) {
    const layer = this.buildLayerMap()[id];
    if (!layer) return;

    if (id === "drawings") {
      layer.graphics.forEach((g) => this.applyDrawingsFilterToGraphic(g, fields));
      return;
    }

    if ("definitionExpression" in layer) {
      layer.definitionExpression = where || null;
    }
  }

  // Validates and stores a filter for one layer, then applies it. Throws
  // (rather than silently no-opping) on an invalid field/operator/value so
  // the shell can surface exactly what was wrong as a toast, consistent with
  // updateSelectedFeatureAttributes/addColumnToLayer/addPortalLayer's
  // throw-and-let-the-shell-toast convention.
  //
  // A filter with no usable conditions (see LayerFilterExpression's
  // usableConditions - e.g. every row still half-empty) is treated as
  // "clear this layer's filter" rather than an error, so removing the last
  // condition in the UI naturally clears filtering instead of requiring a
  // separate action.
  async setLayerFilter(id, filter) {
    const { fields } = await this.getLayerFieldSchema(id);
    const where = buildWhereClause(fields, filter);

    if (where === null) {
      this.layerFilters.delete(id);
    } else {
      this.layerFilters.set(id, filter);
    }

    this.applyFilterToLayer(id, fields, where);
    return { active: where !== null, description: describeFilter(filter) };
  }

  clearLayerFilter(id) {
    this.layerFilters.delete(id);
    this.applyFilterToLayer(id, null, null);
  }

  // Re-derives definitionExpression for every hosted layer with an active
  // filter after attachToView rebuilds them as fresh FeatureLayer instances
  // (a 2D/3D switch, in particular). Fire-and-forget: each layer's fields
  // need to load first, and attachToView itself must stay synchronous (see
  // its own call site comment). A filter that no longer validates against a
  // reloaded layer's schema (e.g. a portal service that changed shape) is
  // dropped rather than left throwing on every future reattachment.
  reapplyPersistedFilters() {
    this.layerFilters.forEach((filter, id) => {
      if (id === "drawings") return; // graphic.visible persists on the graphic objects themselves
      this.getLayerFieldSchema(id)
        .then(({ fields }) => {
          const where = buildWhereClause(fields, filter);
          this.applyFilterToLayer(id, fields, where);
        })
        .catch(() => {
          this.layerFilters.delete(id);
        });
    });
  }

  // Returns a short human-readable description of the currently active
  // filter for a layer, or null when none is active - used by the layer
  // panel/analysis panel to show what's currently narrowing a layer.
  getLayerFilterDescription(id) {
    const filter = this.layerFilters.get(id);
    return filter ? describeFilter(filter) || null : null;
  }

  // ---------------------------------------------------------------------
  // Layer Annotation (map labels)
  //
  // Lets a user pick a layer and one of its attribute fields, and have that
  // field's value rendered as a text label on every feature - ArcGIS's
  // native `labelingInfo` mechanism, not a new drawn graphic. Restricted to
  // the FeatureLayer-backed layers (the three fixed hosted layers plus any
  // portal layers): a GraphicsLayer (`drawings`, `route`, `stops`, ...) has
  // no `labelingInfo`/`labelsVisible` support in the ArcGIS JS API, so
  // "drawings" is deliberately excluded even though it is otherwise
  // filterable.
  // ---------------------------------------------------------------------

  annotatableLayerIds() {
    return this.filterableLayerIds().filter((id) => id !== "drawings");
  }

  // Applies (or clears, when field is falsy) a label on the live layer.
  // No-ops for a layer that doesn't support labelingInfo (e.g. it wasn't
  // resolved, or is a GraphicsLayer that slipped through some other path).
  applyAnnotationToLayer(id, field) {
    const layer = this.buildLayerMap()[id];
    if (!layer || !("labelingInfo" in layer)) return;

    if (!field) {
      layer.labelingInfo = null;
      layer.labelsVisible = false;
      return;
    }

    layer.labelingInfo = [
      {
        labelExpressionInfo: { expression: `$feature.${field}` },
        symbol: {
          type: "text",
          color: "black",
          haloColor: "white",
          haloSize: 1,
          font: { size: 10, weight: "bold" }
        }
      }
    ];
    layer.labelsVisible = true;
  }

  // Validates the field against the layer's own schema (throws otherwise,
  // same throw-and-let-the-shell-toast convention as setLayerFilter/
  // updateSelectedFeatureAttributes/addColumnToLayer/addPortalLayer), then
  // persists and applies it. Passing a falsy field clears the annotation.
  async setLayerAnnotation(id, field) {
    if (!field) {
      this.clearLayerAnnotation(id);
      return;
    }

    const { fields } = await this.getLayerFieldSchema(id);
    if (!fields.some((f) => f.name === field)) {
      throw new Error(`"${field}" is not a field on this layer.`);
    }

    this.layerAnnotations.set(id, field);
    this.applyAnnotationToLayer(id, field);
  }

  clearLayerAnnotation(id) {
    this.layerAnnotations.delete(id);
    this.applyAnnotationToLayer(id, null);
  }

  getLayerAnnotationField(id) {
    return this.layerAnnotations.get(id) || null;
  }

  // Re-derives labelingInfo for every hosted layer with an active annotation
  // after attachToView rebuilds them as fresh FeatureLayer instances (a
  // 2D/3D switch, in particular) - the same fire-and-forget pattern as
  // reapplyPersistedFilters, for the same reason (each layer's fields need
  // to load first, and attachToView itself must stay synchronous). A field
  // that no longer exists on a reloaded schema (e.g. a portal service that
  // changed shape) is dropped rather than left throwing on every future
  // reattachment.
  reapplyPersistedAnnotations() {
    this.layerAnnotations.forEach((field, id) => {
      this.getLayerFieldSchema(id)
        .then(({ fields }) => {
          if (!fields.some((f) => f.name === field)) {
            this.layerAnnotations.delete(id);
            return;
          }
          this.applyAnnotationToLayer(id, field);
        })
        .catch(() => {
          this.layerAnnotations.delete(id);
        });
    });
  }

  // Aggregates one layer: a feature count plus, when `field`/`statistics`
  // are supplied, numeric statistics - all computed over whatever the
  // layer's currently active filter (if any) leaves visible, so "aggregate"
  // and "filter" compose instead of being two independent views of the data.
  // `statistics` is any subset of "sum"/"avg"/"min"/"max" ("count" is always
  // included).
  async getLayerAggregate(id, { field, statistics = [] } = {}) {
    const name = this.getFilterableLayers().find((l) => l.id === id)?.name || id;
    const layer = this.buildLayerMap()[id];
    if (!layer) return { id, name, count: 0, stats: {} };

    if (id === "drawings") {
      const filter = this.layerFilters.get(id);
      const { fields } = this.drawingsFieldSchema();
      const matched = layer.graphics
        .toArray()
        .filter((g) => !filter || matchesAttributes(g.attributes, fields, filter));

      const stats = {};
      if (field && statistics.length) {
        const values = matched
          .map((g) => Number(g.attributes?.[field]))
          .filter((v) => Number.isFinite(v));
        if (statistics.includes("sum")) stats.sum = values.reduce((a, b) => a + b, 0);
        if (statistics.includes("avg")) {
          stats.avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
        }
        if (statistics.includes("min")) stats.min = values.length ? Math.min(...values) : null;
        if (statistics.includes("max")) stats.max = values.length ? Math.max(...values) : null;
      }

      return { id, name, count: matched.length, stats };
    }

    if (typeof layer.load === "function") await layer.load();
    const { fields } = await this.getLayerFieldSchema(id);

    let where = null;
    try {
      where = buildWhereClause(fields, this.layerFilters.get(id));
    } catch {
      where = null; // stale filter; aggregate the unfiltered layer rather than failing the whole request
    }

    const count = await layer.queryFeatureCount({ where: where || "1=1" });
    const stats = {};

    if (field && statistics.length) {
      const outStatistics = statistics.map((type) => ({
        statisticType: type,
        onStatisticField: field,
        outStatisticFieldName: type
      }));
      const result = await layer.queryFeatures({
        where: where || "1=1",
        outStatistics,
        returnGeometry: false
      });
      const attrs = result.features?.[0]?.attributes || {};
      statistics.forEach((type) => {
        stats[type] = attrs[type] ?? null;
      });
    }

    return { id, name, count, stats };
  }

  // Runs getLayerAggregate over several layers at once and combines them
  // into a grand total. Layers can have entirely different schemas, so the
  // caller is expected to only pass a `field` that's meaningful across all
  // selected layers (the Analysis panel only offers fields the user picked
  // per-layer); the total's sum/min/max simply combine whatever numeric
  // stats each layer actually returned, and avg is re-derived from the
  // combined sum/count rather than averaging the per-layer averages (which
  // would misweight layers with different feature counts).
  async runAnalysis(ids, options) {
    const perLayer = await Promise.all(ids.map((id) => this.getLayerAggregate(id, options)));

    const total = perLayer.reduce(
      (acc, l) => {
        acc.count += l.count || 0;
        if (typeof l.stats.sum === "number") {
          acc.sum += l.stats.sum;
          acc.hasSum = true;
        }
        if (typeof l.stats.min === "number") {
          acc.min = acc.min === null ? l.stats.min : Math.min(acc.min, l.stats.min);
        }
        if (typeof l.stats.max === "number") {
          acc.max = acc.max === null ? l.stats.max : Math.max(acc.max, l.stats.max);
        }
        return acc;
      },
      { count: 0, sum: 0, hasSum: false, min: null, max: null }
    );

    return {
      perLayer,
      total: {
        count: total.count,
        sum: total.hasSum ? total.sum : null,
        avg: total.hasSum && total.count ? total.sum / total.count : null,
        min: total.min,
        max: total.max
      }
    };
  }

  drawRoute(routeGeometry) {
    this.routeGraphic = new Graphic({
      geometry: routeGeometry,
      symbol: { type: "simple-line", color: [0, 0, 0], width: 10 }
    });

    if (!this.routeLayer) return;
    this.routeLayer.removeAll();
    this.routeLayer.add(this.routeGraphic);
  }

  drawStops(start, end) {
    // Shape (circle vs. square), not just red/green color, distinguishes
    // start from end so colorblind users aren't relying on hue alone.
    this.startGraphic = new Graphic({
      geometry: start,
      symbol: { type: "simple-marker", style: "circle", color: "green", size: 10 }
    });

    this.endGraphic = new Graphic({
      geometry: end,
      symbol: { type: "simple-marker", style: "square", color: "red", size: 10 }
    });

    if (!this.stopLayer) return;
    this.stopLayer.removeAll();
    this.stopLayer.addMany([this.startGraphic, this.endGraphic]);
  }

  toggleRoute(v) {
    this.routeVisible = v;
    if (this.routeLayer) this.routeLayer.visible = v;
    if (this.stopLayer) this.stopLayer.visible = v;
  }

  // ---------------------------------------------------------------------
  // Advanced Renderer System (Unique Values / Class Breaks)
  //
  // Lets a user replace a layer's single Simple symbol with an ArcGIS Pro-
  // style Unique Values or Class Breaks (Graduated Colors/Sizes) renderer,
  // generated off one of the layer's own fields. Persisted in layerRenderers
  // (see its field comment above) as the source of truth, the same
  // architectural role layerFilters/layerAnnotations play for their systems.
  // ---------------------------------------------------------------------

  // Clones a renderer whether it's a live autocast Renderer (has `.clone()`)
  // or a plain JSON object - e.g. a portal layer's freshly-generated default
  // base (see defaultSimpleRenderer below) or a renderer restored from a
  // saved project (see Project Persistence) - deep enough to keep
  // `symbol.outline` from being shared between the original and the
  // "clone", the same class of fix SymbolRenderers.applyExtendedSymbolStyle
  // needed for the same reason.
  cloneRenderer(renderer) {
    if (typeof renderer.clone === "function") return renderer.clone();
    return {
      ...renderer,
      symbol: renderer.symbol
        ? { ...renderer.symbol, outline: renderer.symbol.outline ? { ...renderer.symbol.outline } : undefined }
        : renderer.symbol
    };
  }

  // A last-resort Simple-mode base for a layer that has neither a persisted
  // base nor a live renderer that's already Simple - i.e. a portal layer
  // whose service's own default renderer is Unique Values/Class Breaks/
  // heatmap/dictionary/etc. (an ordinary, common case - most real-world
  // hosted feature services do NOT default to a plain Simple renderer).
  // Without this, such a layer had no symbol anywhere to clone from:
  // setLayerStyle silently no-opped (no error, the color picker just did
  // nothing) and setLayerAdvancedRenderer threw "no symbol to base a
  // renderer on yet" - together, "symbology can't be edited after adding
  // from portal". Keyed by the layer's own `geometryType` (populated after
  // `layer.load()`); an unrecognized/not-yet-loaded type returns null,
  // preserving the previous no-controls fallback for that edge case only.
  //
  // Keys are the ArcGIS JS API's own normalized geometryType values
  // ("point"/"polygon"/"polyline"/"multipoint"/"multipatch"/"mesh" - see
  // @arcgis/core/layers/mixins/FeatureLayerBase's `geometryType` property),
  // NOT the REST API's "esriGeometryPoint"-style constants. A live,
  // service-loaded FeatureLayer's `.geometryType` is already translated to
  // this shorthand form by the SDK itself (via its own service-JSON reader),
  // so keying this switch off the REST-style strings meant it silently
  // never matched anything against a real layer - this method (and every
  // geometryType comparison below that copied the same wrong format) always
  // returned null/false against live data, even though it worked in tests
  // whose mocks were set up with the (also wrong) REST-style strings.
  static defaultSimpleRenderer(geometryType) {
    const symbol = {
      point: { type: "simple-marker", color: [255, 165, 0], size: 8, outline: { color: [255, 255, 255], width: 1 } },
      multipoint: { type: "simple-marker", color: [255, 165, 0], size: 8, outline: { color: [255, 255, 255], width: 1 } },
      polyline: { type: "simple-line", color: [0, 0, 0], width: 1.5 },
      polygon: { type: "simple-fill", color: [0, 120, 255, 0.5], outline: { color: [0, 0, 0], width: 1.5 } }
    }[geometryType];
    return symbol ? { type: "simple", symbol } : null;
  }

  // Ensures the persisted Simple-mode base renderer for a layer is a real
  // symbol to clone from, bootstrapping it from the *live* layer's own
  // renderer - and, crucially, PERSISTING that bootstrap via `setBase`
  // rather than only reading it - the first time this layer's symbol is
  // needed as a template (a Simple-mode edit, or generating an advanced
  // renderer/halo) if it hasn't been already.
  //
  // Persisting (not just reading) matters because the live layer's renderer
  // can later be replaced by an advanced (Unique Values/Class Breaks)
  // renderer or a halo CIM composite - neither a valid clone template - so a
  // layer that goes straight to "Generate" without ever touching the Simple
  // controls first would otherwise have no clonable renderer left anywhere
  // once the live one is overwritten. Regression: a *second* "Generate" on
  // such a layer read the live (already-advanced) renderer's nonexistent
  // `.symbol` and threw "no symbol to base a renderer on yet".
  //
  // `live` must itself be a genuinely Simple renderer (i.e. have a `.symbol`)
  // to be used as a bootstrap source - checking only `typeof live.clone ===
  // "function"` (every renderer type has `.clone()`) previously let a portal
  // layer's own Unique Values/Class Breaks/heatmap service renderer get
  // "bootstrapped" as if it were a Simple base, producing a renderer with no
  // top-level `.symbol` that then silently broke every future Simple-mode
  // edit and Advanced-renderer generation for that layer. `geometryType`
  // (only meaningful for the portal-layer call site) is the last-resort
  // fallback once neither a persisted nor a live Simple base exists at all.
  ensureSimpleBase(base, live, setBase, geometryType) {
    if (base?.symbol) return base;
    if (live?.symbol) {
      const bootstrapped = this.cloneRenderer(live);
      setBase(bootstrapped);
      return bootstrapped;
    }
    const fallback = GISMapEngine.defaultSimpleRenderer(geometryType);
    if (fallback) setBase(fallback);
    return fallback;
  }

  // The current Simple-mode symbol to use as the shape template for a newly
  // generated advanced renderer - same symbols getLayers()/symbolToStyleGroup
  // already treat as each layer's "one coherent symbol". For drawings,
  // `symbolType` scopes which style group (point/line/polygon) is being
  // replaced, mirroring how setLayerStyle already scopes drawings edits.
  getBaseSymbolForLayer(id, symbolType) {
    switch (id) {
      case "touristAttractions": {
        const renderer = this.ensureSimpleBase(
          this.touristAttractionRenderer,
          this.touristAttractionLayer?.renderer,
          (r) => { this.touristAttractionRenderer = r; }
        );
        return renderer?.symbol || null;
      }
      case "mrtStations": {
        const renderer = this.ensureSimpleBase(
          this.mrtStationRenderer,
          this.mrtStationLayer?.renderer,
          (r) => { this.mrtStationRenderer = r; }
        );
        return renderer?.symbol || null;
      }
      case "mrtLines": {
        const renderer = this.ensureSimpleBase(
          this.mrtLineRenderer,
          this.mrtLineLayer?.renderer,
          (r) => { this.mrtLineRenderer = r; }
        );
        return renderer?.symbol || null;
      }
      case "route": return this.routeGraphic?.symbol || null;
      case "drawings": {
        const match = this.drawLayer.graphics.toArray().find((g) => !symbolType || g.symbol?.type === symbolType);
        return match?.symbol || null;
      }
      default: {
        const meta = this.portalLayerMeta.get(id);
        const portalLayer = this.portalLayers.get(id);
        const renderer = this.ensureSimpleBase(
          meta?.renderer,
          portalLayer?.renderer,
          (r) => { if (meta) meta.renderer = r; },
          portalLayer?.geometryType
        );
        return renderer?.symbol || null;
      }
    }
  }

  // Up to `limit` distinct values of `field`. Hosted layers ask the service
  // directly (returnDistinctValues); drawings dedupe client-side, the same
  // hosted-vs-local split LayerFilterExpression.js documents for filter
  // evaluation. Falls back to sampling ordinary features and deduping
  // client-side when a service doesn't support distinct queries.
  async getDistinctValues(id, field, { symbolType, limit = DEFAULT_UNIQUE_VALUE_LIMIT } = {}) {
    if (id === "drawings") {
      const seen = [];
      this.drawLayer.graphics.forEach((g) => {
        if (symbolType && g.symbol?.type !== symbolType) return;
        const v = g.attributes?.[field];
        if (v === undefined || v === null || seen.includes(v)) return;
        seen.push(v);
      });
      return seen.slice(0, limit);
    }

    const layer = this.buildLayerMap()[id];
    if (!layer || typeof layer.queryFeatures !== "function") return [];

    try {
      const result = await layer.queryFeatures({
        where: "1=1",
        outFields: [field],
        returnDistinctValues: true,
        orderByFields: [field],
        returnGeometry: false,
        num: limit
      });
      return result.features
        .map((f) => f.attributes?.[field])
        .filter((v) => v !== undefined && v !== null)
        .slice(0, limit);
    } catch {
      // Raw (non-distinct) sampling needs to scan more records than `limit`
      // to have a good chance of finding `limit` distinct values, since
      // records aren't deduplicated server-side here - capped well above a
      // typical hosted layer's own maxRecordCount rather than a small fixed
      // number, which previously undersampled anything but a small dataset
      // (a fixed 200-record sample cannot find 500 distinct values from a
      // 500-feature layer).
      const fallback = await layer.queryFeatures({
        where: "1=1",
        outFields: [field],
        returnGeometry: false,
        num: Math.min(2000, limit * 3)
      });
      const seen = [];
      fallback.features.forEach((f) => {
        const v = f.attributes?.[field];
        if (v !== undefined && v !== null && !seen.includes(v)) seen.push(v);
      });
      return seen.slice(0, limit);
    }
  }

  // All numeric values of `field`, for class-breaks classification.
  async getFieldValues(id, field, { symbolType } = {}) {
    if (id === "drawings") {
      const values = [];
      this.drawLayer.graphics.forEach((g) => {
        if (symbolType && g.symbol?.type !== symbolType) return;
        const n = Number(g.attributes?.[field]);
        if (Number.isFinite(n)) values.push(n);
      });
      return values;
    }

    const layer = this.buildLayerMap()[id];
    if (!layer || typeof layer.queryFeatures !== "function") return [];

    const result = await layer.queryFeatures({ where: "1=1", outFields: [field], returnGeometry: false });
    return result.features
      .map((f) => Number(f.attributes?.[field]))
      .filter((n) => Number.isFinite(n));
  }

  // Generates and applies a Unique Values, Class Breaks, or Heatmap renderer.
  // Throws on an unknown field (same throw-and-let-the-shell-toast convention
  // as setLayerFilter/setLayerAnnotation) or renderer type. Returns a summary
  // (rendererType/field/legend) so the panel can render the legend
  // immediately without a follow-up getLayers() round trip.
  //
  // Heatmap is a density visualization, not a per-value symbol mapping, so it
  // skips the field-schema/baseSymbol requirements the other two modes need -
  // it works on whatever point geometry the layer already has. This is what
  // lets heatmap analysis run against any point layer shown in the layers
  // card (touristAttractions, mrtStations, a portal point layer, or a
  // drawings point group) rather than being wired to one hardcoded layer/URL.
  async setLayerAdvancedRenderer(id, { type, field, symbolType, intensity, radius, ...options } = {}) {
    if (type === "heatmap") {
      const built = buildHeatmapRenderer(intensity, radius);
      const descriptor = { ...built.renderer, symbolType: id === "drawings" ? symbolType : undefined, legend: built.legend };
      this.layerRenderers.set(id, descriptor);
      this.applyRendererToLayer(id, descriptor);
      return { rendererType: type, field: null, legend: built.legend };
    }

    const { fields } = await this.getLayerFieldSchema(id);
    if (!fields.some((f) => f.name === field)) {
      throw new Error(`"${field}" is not a field on this layer.`);
    }

    const baseSymbol = this.getBaseSymbolForLayer(id, symbolType);
    if (!baseSymbol) {
      throw new Error("This layer has no symbol to base a renderer on yet.");
    }

    let built;
    if (type === "unique-value") {
      const values = await this.getDistinctValues(id, field, { symbolType });
      built = buildUniqueValueRenderer(field, values, baseSymbol);
    } else if (type === "class-breaks") {
      const values = await this.getFieldValues(id, field, { symbolType });
      built = buildClassBreaksRenderer(field, values, { ...options, baseSymbol });
    } else {
      throw new Error(`Unknown renderer type "${type}".`);
    }

    // symbolType only means anything for `drawings` (which style group this
    // descriptor applies to) - every other id has exactly one implicit
    // group and attachRendererInfo's callers always pass it `undefined` for
    // those, so storing anything other than `undefined` here would make
    // attachRendererInfo's `(descriptor.symbolType ?? null) === (symbolType
    // ?? null)` comparison fail for a renderer that IS active, permanently
    // reporting rendererType "simple" even with an advanced renderer live on
    // the layer. Regression: the panel's Simple/Unique Values/Class Breaks
    // toggle believed it was already in Simple mode, so clicking "Simple"
    // flipped the toggle's own look (driven by local click state) but never
    // called onClearRenderer - the map never actually reverted.
    const descriptor = { ...built.renderer, symbolType: id === "drawings" ? symbolType : undefined, legend: built.legend };
    this.layerRenderers.set(id, descriptor);
    this.applyRendererToLayer(id, descriptor);

    return { rendererType: type, field, legend: built.legend };
  }

  // Applies an already-computed renderer descriptor to the live layer:
  // reassigns `.renderer` for FeatureLayer/portal layers, or - since drawings
  // has no single renderer to assign - re-evaluates every graphic against the
  // descriptor. Heatmap is the one exception for drawings: it's a
  // whole-layer density visualization (like FeatureLayer/portal heatmaps),
  // not a per-value symbol lookup, so it's assigned straight to drawLayer's
  // own `.renderer` (a GraphicsLayer supports a heatmap renderer the same way
  // a FeatureLayer does) instead of being evaluated per graphic.
  applyRendererToLayer(id, descriptor) {
    if (id === "drawings" && descriptor?.type !== "heatmap") {
      this.drawLayer.graphics.forEach((g) => this.applyDrawingsRendererToGraphic(g));
      return;
    }
    const layer = this.buildLayerMap()[id];
    if (layer) layer.renderer = toArcGISRenderer(descriptor);
  }

  // Evaluates the active drawings advanced renderer (if any) against one
  // graphic's own attributes and assigns the matching symbol. No-ops when no
  // advanced renderer is active (leaves the graphic's current symbol alone)
  // or when it's scoped to a different symbolType - mirrors
  // applyDrawingsFilterToGraphic's no-op-when-inactive behavior, and is
  // called from the same three spots that method is: setLayerAdvancedRenderer
  // (via applyRendererToLayer), the sketchVM "create" complete handler, and
  // uploadGeoJSON.
  applyDrawingsRendererToGraphic(graphic) {
    const descriptor = this.layerRenderers.get("drawings");
    if (!descriptor) return;
    if (descriptor.symbolType && graphic.symbol?.type !== descriptor.symbolType) return;

    const value = graphic.attributes?.[descriptor.field];

    if (descriptor.type === "unique-value") {
      const match = descriptor.uniqueValueInfos.find((info) => info.value === String(value));
      const symbol = match?.symbol || descriptor.defaultSymbol;
      if (symbol) graphic.symbol = symbol;
      return;
    }

    if (descriptor.type === "class-breaks") {
      const numeric = Number(value);
      const match = descriptor.classBreakInfos.find((b) => numeric >= b.minValue && numeric <= b.maxValue);
      if (match) graphic.symbol = match.symbol;
    }
  }

  // Reverts a layer to Simple mode. FeatureLayer/portal layers revert to
  // their persisted simple base renderer (touristAttractionRenderer/etc. /
  // portalLayerMeta.renderer). Drawings has no snapshot to revert to - each
  // graphic's symbol was computed from its attribute value, not remembered -
  // so clearing here only stops future auto-recompute; each graphic keeps its
  // last-computed symbol, editable afterward via the ordinary Simple controls
  // for that symbolType group. This asymmetry is deliberate (see
  // knowledge/index.md's Layer Styling System) rather than an oversight.
  clearLayerAdvancedRenderer(id) {
    const wasHeatmap = this.layerRenderers.get(id)?.type === "heatmap";
    this.layerRenderers.delete(id);
    if (id === "drawings") {
      // A heatmap was assigned straight to drawLayer.renderer (see
      // applyRendererToLayer) rather than evaluated per graphic, so clearing
      // it must undo that directly - nulling it out lets each graphic's own
      // `.symbol` show through again, same as before the heatmap was applied.
      if (wasHeatmap) this.drawLayer.renderer = null;
      return;
    }

    const layer = this.buildLayerMap()[id];
    if (!layer) return;

    const baseRenderer = {
      touristAttractions: this.touristAttractionRenderer,
      mrtStations: this.mrtStationRenderer,
      mrtLines: this.mrtLineRenderer
    }[id];

    if (baseRenderer) {
      layer.renderer = this.resolveSeedRenderer(id, baseRenderer);
      return;
    }

    const meta = this.portalLayerMeta.get(id);
    if (meta) layer.renderer = this.resolveSeedRenderer(id, meta.renderer);
  }

  // Hand-tweaks one already-generated value's (unique-value, `key` = the
  // value) or break's (class-breaks, `key` = the break index) symbol, without
  // regenerating the whole renderer - e.g. the user doesn't like the
  // auto-assigned color for one category.
  updateRendererEntrySymbol(id, key, changes) {
    const descriptor = this.layerRenderers.get(id);
    if (!descriptor) return;

    const next = { ...descriptor };
    if (descriptor.type === "unique-value") {
      next.uniqueValueInfos = descriptor.uniqueValueInfos.map((info) =>
        info.value === key ? { ...info, symbol: applyExtendedSymbolStyle(info.symbol, changes) } : info
      );
    } else if (descriptor.type === "class-breaks") {
      next.classBreakInfos = descriptor.classBreakInfos.map((brk, i) =>
        i === key ? { ...brk, symbol: applyExtendedSymbolStyle(brk.symbol, changes) } : brk
      );
    } else {
      return;
    }

    next.legend = descriptor.legend.map((entry) =>
      entry.key === key
        ? { ...entry, color: changes.color ?? entry.color, size: changes.size ?? entry.size }
        : entry
    );

    this.layerRenderers.set(id, next);
    this.applyRendererToLayer(id, next);
  }

  // Builds one style-group descriptor from a single symbol. A "style group"
  // is what the layer panel renders as one row of color/border controls.
  static symbolTypeLabels = {
    "simple-marker": "Points",
    "simple-line": "Lines",
    "simple-fill": "Polygons"
  };

  symbolToStyleGroup(symbol, label) {
    const type = symbol?.type ?? null;
    const colorObj = symbol?.color;
    return {
      symbolType: type,
      label: label ?? GISMapEngine.symbolTypeLabels[type] ?? "Style",
      color: colorToHex(colorObj),
      borderWidth: type === "simple-line" ? symbol?.width ?? null : symbol?.outline?.width ?? null,
      outlineColor: type === "simple-fill" ? colorToHex(symbol?.outline?.color) : undefined,
      markerStyle: type === "simple-marker" ? symbol?.style ?? "circle" : undefined,
      lineStyle: type === "simple-line" ? symbol?.style ?? "solid" : undefined,
      fillStyle: type === "simple-fill" ? symbol?.style ?? "solid" : undefined,
      size: type === "simple-marker" ? symbol?.size ?? null : undefined,
      opacity:
        typeof colorObj?.a === "number"
          ? colorObj.a
          : Array.isArray(colorObj) && colorObj.length === 4
          ? colorObj[3]
          : 1
    };
  }

  // Merges a style group with its current renderer-mode metadata: whether
  // this group (a layer, or - for drawings - one symbolType within it) is in
  // Simple mode or has an active Unique Values/Class Breaks renderer, plus
  // (id !== "drawings" only - see haloState's field comment) its current
  // halo state. `symbolType` is only meaningful for drawings, where each
  // style group is independently in Simple or Advanced mode; single-symbol
  // layers pass `undefined`, which matches how their layerRenderers/haloState
  // entries (if any) are always stored with no symbolType.
  // `heatmapEligible` scopes the Heatmap renderer mode to point geometry -
  // see getLayers()'s call sites for how each layer kind decides it (a fixed
  // hosted layer's own known geometry, or a portal/drawings layer's runtime
  // geometryType/symbolType). A line/polygon layer never gets the option.
  attachRendererInfo(group, id, symbolType, heatmapEligible = false) {
    const descriptor = this.layerRenderers.get(id);
    const applies = Boolean(descriptor) && (descriptor.symbolType ?? null) === (symbolType ?? null);
    const halo = id === "drawings" ? null : this.haloState.get(id);

    return {
      ...group,
      rendererType: applies ? descriptor.type : "simple",
      rendererField: applies ? descriptor.field : null,
      rendererLegend: applies ? descriptor.legend : null,
      rendererIntensity: applies && descriptor.type === "heatmap" ? descriptor.maxPixelIntensity : null,
      heatmapEligible,
      haloEnabled: Boolean(halo),
      haloColor: halo?.color ?? null,
      haloSize: halo?.size ?? null
    };
  }

  // Whether a layer's own (SDK-normalized, lowercase - see
  // defaultSimpleRenderer's comment) geometryType is point-like, i.e. a
  // real candidate for heatmap density analysis. Used uniformly for every
  // FeatureLayer-backed layer's heatmapEligible computation - the fixed
  // hosted layers (touristAttractions/mrtStations) included. These two used
  // to be hardcoded `true` on the assumption that they're "known point
  // layers" by construction/config; that assumption doesn't actually hold
  // if the configured feature service's real data isn't point geometry
  // (e.g. a station represented as a small polygon footprint rather than a
  // single coordinate) - the layer's own rendering as a marker symbol says
  // nothing about its underlying geometry type. Checking the live layer's
  // geometryType instead means eligibility reflects what the service
  // actually contains, the same way it already does for portal layers.
  static isPointGeometry(geometryType) {
    return geometryType === "point" || geometryType === "multipoint";
  }

  getLayers() {
    const l = this.layerOrder;

    const touristAttractionsIsPoint = GISMapEngine.isPointGeometry(this.touristAttractionLayer?.geometryType);
    const mrtStationsIsPoint = GISMapEngine.isPointGeometry(this.mrtStationLayer?.geometryType);

    // Read from the persisted simple-mode base fields, not the live layer's
    // renderer - the live renderer can currently be a Unique Values/Class
    // Breaks renderer (no top-level `.symbol`) or a halo CIM composite
    // (`.symbol.type` "cim"), neither of which is a valid source for the
    // Simple-mode color/border/shape controls. The base fields are never
    // touched by setLayerAdvancedRenderer/halo application (see their
    // comments), so they always hold the last genuine simple symbol.
    const touristAttractionSymbol = this.touristAttractionRenderer?.symbol;
    const mrtStationSymbol = this.mrtStationRenderer?.symbol;
    const mrtLineSymbol = this.mrtLineRenderer?.symbol;

    // The drawings layer has no restriction on what geometry types coexist
    // in it, so it can hold any mix of points, lines, and polygons at once.
    // Rather than styling the whole layer off one arbitrarily-chosen
    // graphic, build one style group per distinct symbol type actually
    // present, so each geometry kind gets its own color/border controls.
    const drawingsGroups = [];
    if (this.drawLayer?.graphics?.length) {
      const seenTypes = new Map();
      this.drawLayer.graphics.forEach((g) => {
        const type = g.symbol?.type;
        if (type && !seenTypes.has(type)) seenTypes.set(type, g.symbol);
      });
      seenTypes.forEach((symbol, type) => {
        drawingsGroups.push(
          this.attachRendererInfo(this.symbolToStyleGroup(symbol), "drawings", type, type === "simple-marker")
        );
      });
    }

    const lookup = {
      touristAttractions: {
        id: "touristAttractions",
        name: "Tourist Attractions",
        visible: this.touristAttractionLayer?.visible,
        styleGroups: touristAttractionSymbol
          ? [this.attachRendererInfo(this.symbolToStyleGroup(touristAttractionSymbol, "Tourist Attractions"), "touristAttractions", undefined, touristAttractionsIsPoint)]
          : [],
        filterable: true,
        filterDescription: this.getLayerFilterDescription("touristAttractions"),
        annotatable: true,
        annotationField: this.getLayerAnnotationField("touristAttractions")
      },
      mrtStations: {
        id: "mrtStations",
        name: "MRT Stations",
        visible: this.mrtStationLayer?.visible,
        styleGroups: mrtStationSymbol
          ? [this.attachRendererInfo(this.symbolToStyleGroup(mrtStationSymbol, "Stations"), "mrtStations", undefined, mrtStationsIsPoint)]
          : [],
        filterable: true,
        filterDescription: this.getLayerFilterDescription("mrtStations"),
        annotatable: true,
        annotationField: this.getLayerAnnotationField("mrtStations")
      },
      mrtLines: {
        id: "mrtLines",
        name: "MRT Lines",
        visible: this.mrtLineLayer?.visible,
        styleGroups: mrtLineSymbol
          ? [this.attachRendererInfo(this.symbolToStyleGroup(mrtLineSymbol, "Lines"), "mrtLines")]
          : [],
        filterable: true,
        filterDescription: this.getLayerFilterDescription("mrtLines"),
        annotatable: true,
        annotationField: this.getLayerAnnotationField("mrtLines")
      },
      drawings: {
        id: "drawings",
        name: "Drawings",
        visible: this.drawLayer?.visible,
        styleGroups: drawingsGroups,
        filterable: true,
        filterDescription: this.getLayerFilterDescription("drawings")
      },
    };

    // Portal-added layers have no fixed slot in `lookup` above since their
    // number and ids are dynamic (one per added portal item). They carry
    // `removable: true` so LayerControlPanel can offer a remove control that
    // the built-in layers don't get, and `filterable: true` for the same
    // reason as the fixed hosted layers above.
    this.portalLayers.forEach((layer, id) => {
      const meta = this.portalLayerMeta.get(id);
      // A portal-supplied renderer can be anything (unique-value, class-
      // breaks, dictionary, ...), most of which have no single symbol to
      // expose a color/border control for. ensureSimpleBase prefers the
      // persisted simple base (meta.renderer - set the moment this layer is
      // ever styled/haloed, see setLayerStyle) since, like the fixed hosted
      // layers above, the live layer.renderer can currently be an advanced/
      // halo renderer; falls back to the live service-supplied renderer only
      // when it's still "simple"; and - for a layer whose service default
      // was never Simple to begin with - synthesizes a generated default
      // symbol (by geometryType) so this layer is never left with no
      // Symbology controls at all. This is the same bootstrap
      // setLayerStyle/getBaseSymbolForLayer use, so what the panel shows as
      // "current style" always matches what a subsequent edit clones from.
      const portalRenderer = this.ensureSimpleBase(
        meta?.renderer,
        layer.renderer,
        (r) => { if (meta) meta.renderer = r; },
        layer.geometryType
      );
      const portalSymbol = portalRenderer?.symbol || null;
      // Heatmap is only offered for point/multipoint services - see
      // isPointGeometry's comment.
      const portalIsPoint = GISMapEngine.isPointGeometry(layer.geometryType);
      lookup[id] = {
        id,
        name: meta?.title || "Portal Layer",
        visible: layer.visible,
        removable: true,
        styleGroups: portalSymbol
          ? [this.attachRendererInfo(this.symbolToStyleGroup(portalSymbol, meta?.title || "Portal Layer"), id, undefined, portalIsPoint)]
          : [],
        filterable: true,
        filterDescription: this.getLayerFilterDescription(id),
        annotatable: true,
        annotationField: this.getLayerAnnotationField(id)
      };
    });

    // Named heatmap layers (see createHeatmapLayer) - removable like a
    // portal layer, but with no Symbology/Filter/Annotate sections (there's
    // nothing to edit beyond the intensity it was created with) and
    // `heatmap: true` plus `heatmapIntensity` so LayerControlPanel can show
    // the same intensity slider the old hardcoded heat layer used to have,
    // scoped to just this one named layer.
    this.heatmapLayers.forEach((layer, id) => {
      const meta = this.heatmapLayerMeta.get(id);
      lookup[id] = {
        id,
        name: meta?.title || "Heatmap",
        visible: layer.visible,
        removable: true,
        heatmap: true,
        heatmapIntensity: meta?.intensity ?? 50,
        styleGroups: []
      };
    });

    // Named route-result layers (see createRouteResultLayer) - removable
    // like a portal/heatmap layer, no Filter/Annotate sections (no
    // attribute schema worth filtering on), but - unlike heatmap layers -
    // DOES get a Symbology section: it's a GraphicsLayer holding real
    // symbol'd graphics (the route line plus its two stop markers), same as
    // `drawings`, not a renderer-only layer with nothing to restyle. Only
    // the route line (`simple-line`) is exposed as a style group, though -
    // the two stop markers are deliberately left out, for the same reason
    // the live `stops` layer itself is excluded from Simple styling
    // (knowledge/index.md's Layer Styling System): they're intentionally
    // green-circle/red-square, and a single shared "marker" group edit
    // would overwrite that start/end distinction.
    this.namedRouteLayers.forEach((layer, id) => {
      const meta = this.namedRouteLayerMeta.get(id);
      const lineGraphic = layer.graphics.toArray().find((g) => g.symbol?.type === "simple-line");
      lookup[id] = {
        id,
        name: meta?.title || "Route",
        visible: layer.visible,
        removable: true,
        styleGroups: lineGraphic
          ? [this.attachRendererInfo(this.symbolToStyleGroup(lineGraphic.symbol, "Route"), id)]
          : []
      };
    });

    // Named search-result layers (see createSearchResultLayer) - removable
    // like a portal/heatmap/route-result layer, no Filter/Annotate sections
    // (a single geocoded point has no attribute schema worth filtering on),
    // but DOES get a Symbology section: it's a GraphicsLayer holding one
    // real symbol'd graphic (the marker), same reasoning as the named
    // route-result layer's line style group above.
    this.namedSearchLayers.forEach((layer, id) => {
      const meta = this.namedSearchLayerMeta.get(id);
      const markerGraphic = layer.graphics.toArray().find((g) => g.symbol?.type === "simple-marker");
      lookup[id] = {
        id,
        name: meta?.title || "Search Result",
        visible: layer.visible,
        removable: true,
        styleGroups: markerGraphic
          ? [this.attachRendererInfo(this.symbolToStyleGroup(markerGraphic.symbol, "Marker"), id)]
          : []
      };
    });

    // route/stops/searchResult are deliberately excluded from the Layers
    // card: they're the live, always-overwritten-on-next-search working
    // state (visibility is controlled by Route Search's own "Hide/Show
    // Route" toggle, or the Search card's own marker, not a card row), not
    // something a user browses/reorders/removes there. A user who wants a
    // persistent, named entry uses "Add to Layers" in Route Search
    // (createRouteResultLayer) or the Search card (createSearchResultLayer)
    // instead, which each produce an ordinary card row like any other layer.
    return l
      .filter((id) => id !== "route" && id !== "stops" && id !== "searchResult")
      .map((id) => lookup[id]);
  }

  toggleLayer(id) {
    const layer = this.buildLayerMap()[id];
    if (!layer) return;

    layer.visible = !layer.visible;

    // Fixed layers (route/touristAttractions/mrtStations/mrtLines/
    // searchResult) have a dedicated engine visibility field that seeds
    // their reconstruction in attachToView (a 2D/3D switch rebuilds these
    // as fresh layer instances - see the field comments above `layerOrder`)
    // and that Project Persistence reads/writes - see
    // VISIBILITY_FIELD_BY_LAYER_ID's comment.
    const visibilityField = GISMapEngine.VISIBILITY_FIELD_BY_LAYER_ID[id];
    if (visibilityField) this[visibilityField] = layer.visible;

    // Portal layers have no dedicated engine visibility field (route/etc.
    // do); portalLayerMeta.visible IS that field for them, and must be
    // kept in sync so the layer reattaches with the right visibility on the
    // next 2D/3D switch (see attachToView's portal-layer reconstruction).
    const meta = this.portalLayerMeta.get(id);
    if (meta) meta.visible = layer.visible;

    // Named heatmap layers need the same visible-sync as portal layers, for
    // the same reason - see attachToView's heatmap-layer reconstruction.
    const heatmapMeta = this.heatmapLayerMeta.get(id);
    if (heatmapMeta) heatmapMeta.visible = layer.visible;

    // Named route-result layers need the same visible-sync, for the same
    // reason - see attachToView's route-result-layer reconstruction.
    const namedRouteMeta = this.namedRouteLayerMeta.get(id);
    if (namedRouteMeta) namedRouteMeta.visible = layer.visible;

    // Named search-result layers need the same visible-sync, for the same
    // reason - see attachToView's search-result-layer reconstruction.
    const namedSearchMeta = this.namedSearchLayerMeta.get(id);
    if (namedSearchMeta) namedSearchMeta.visible = layer.visible;
  }

  // Adds a layer picked from PortalService.searchPortalLayers as a live
  // FeatureLayer, using the same toggle/reorder/zoom/style plumbing as every
  // built-in layer (via buildLayerMap + layerOrder). `item` is one of the
  // plain objects that service returns ({ id, title, url, ... }). Adding the
  // same portal item twice is a no-op (returns the existing layer's id)
  // rather than creating a duplicate layer.
  // Portal search lists items that are publicly *discoverable* but whose
  // backing service may not be publicly *accessible*: Esri subscription
  // content answers an anonymous request with error 499 ("Token Required for
  // subscription content"), and another user's restricted item answers with
  // 403 even when the app's API key is attached. Both are ordinary results in
  // a normal search - `access: "public"` on the item says nothing about the
  // service behind it.
  //
  // Letting a FeatureLayer hit that failure means IdentityManager answers the
  // 499/403 by opening its own sign-in modal, so picking the wrong search
  // result appears to make the whole app demand a login. Probing first with
  // authMode "no-prompt" keeps the failure ours to report: the request fails
  // instead of prompting, and the shell shows an ordinary toast.
  async canAccessPortalService(url) {
    try {
      const response = await esriRequest(url, {
        query: { f: "json" },
        responseType: "json",
        authMode: "no-prompt"
      });
      // ArcGIS REST reports authorization failures as HTTP 200 with an error
      // body, so a resolved promise is not on its own proof of access.
      return !response?.data?.error;
    } catch {
      return false;
    }
  }

  async addPortalLayer(item) {
    if (!item?.url) throw new Error("This portal item has no queryable layer URL.");

    const layerId = `portal_${item.id}`;
    if (this.portalLayerMeta.has(layerId)) return layerId;

    if (!(await this.canAccessPortalService(item.url))) {
      throw new Error(
        `"${item.title || "This layer"}" needs an ArcGIS account with access to it — it isn't available anonymously.`
      );
    }

    // `renderer` starts unset (service default). Once a user restyles this
    // layer via setLayerStyle, the resulting renderer is written back here so
    // it survives a 2D/3D reattachment, the same way touristAttractionRenderer/
    // mrtStationRenderer/mrtLineRenderer persist style for the fixed layers.
    const meta = { title: item.title || "Portal Layer", url: item.url, visible: true, renderer: null };
    this.portalLayerMeta.set(layerId, meta);
    this.layerOrder = [...this.layerOrder, layerId];

    const layer = new FeatureLayer({
      url: meta.url,
      title: meta.title,
      visible: meta.visible,
      outFields: ["*"]
    });
    this.portalLayers.set(layerId, layer);

    if (this.currentMap) this.currentMap.add(layer);

    // `layer.renderer` is only populated once the service's metadata has
    // loaded — it is not available synchronously off a freshly constructed
    // FeatureLayer. addPortalLayer is already awaited by the shell before it
    // calls refreshLayers()/getLayers(), so awaiting the load here (rather
    // than leaving it to happen in the background) is what makes a portal
    // layer's Symbology controls appear on the very first render of its row
    // instead of only after some unrelated action later triggers a refresh.
    await layer.load().catch(() => {});

    return layerId;
  }

  // Removes a portal-added layer entirely (not just hides it), since unlike
  // the fixed built-in layers, these were opted into by the user and should
  // be droppable the same way. Only valid for ids this engine added itself
  // (i.e. present in portalLayerMeta) - the built-in layers can't be removed
  // this way.
  removePortalLayer(id) {
    if (!this.portalLayerMeta.has(id)) return;

    const layer = this.portalLayers.get(id);
    if (layer && this.currentMap) this.currentMap.remove(layer);

    this.portalLayers.delete(id);
    this.portalLayerMeta.delete(id);
    this.layerOrder = this.layerOrder.filter((x) => x !== id);
  }

  // ---------------------------------------------------------------------
  // Named Heatmap Layers
  //
  // The discoverable way to run heatmap analysis: rather than requiring a
  // user to find a source layer's own Symbology section and switch it into
  // Heatmap mode in place (still available - see the Advanced Renderer
  // System above), this creates a brand-new, separately named/toggleable/
  // removable layer in the layers card, so the source layer's own styling
  // is left untouched and the heatmap itself is as visible/manageable as
  // any other layer. Only offered for layers with a real hosted URL and
  // point geometry - a heatmap needs point features to compute density
  // from, and only a FeatureLayer-backed source (hosted or portal) has a
  // `url` cheap to duplicate into a second, independently-rendered layer.
  // ---------------------------------------------------------------------

  // Every layer id (fixed hosted + portal) eligible as a heatmap analysis
  // source, for populating the "source layer" picker in the UI. Mirrors the
  // heatmapEligible computation getLayers() does per style group, but as a
  // flat, UI-ready list rather than embedded in each layer's styleGroups.
  heatmapEligibleSourceLayers() {
    const results = [];
    if (GISMapEngine.isPointGeometry(this.touristAttractionLayer?.geometryType)) {
      results.push({ id: "touristAttractions", name: "Tourist Attractions" });
    }
    if (GISMapEngine.isPointGeometry(this.mrtStationLayer?.geometryType)) {
      results.push({ id: "mrtStations", name: "MRT Stations" });
    }
    this.portalLayers.forEach((layer, id) => {
      if (GISMapEngine.isPointGeometry(layer.geometryType)) {
        results.push({ id, name: this.portalLayerMeta.get(id)?.title || "Portal Layer" });
      }
    });
    return results;
  }

  // Creates a new, independently named/toggleable/removable heatmap layer
  // from a point source layer's own hosted URL. Throws (same throw-and-
  // let-the-shell-toast convention as addPortalLayer/setLayerFilter/etc.)
  // on a missing name or an ineligible source, rather than silently no-
  // opping or falling back to a generated name - a heatmap layer with no
  // name of its own would be indistinguishable from its source in the
  // layers card.
  createHeatmapLayer(sourceId, { name, intensity = 50, radius = 25 } = {}) {
    const trimmedName = (name || "").trim();
    if (!trimmedName) throw new Error("Please give the heatmap layer a name.");

    const eligible = this.heatmapEligibleSourceLayers();
    if (!eligible.some((l) => l.id === sourceId)) {
      throw new Error("Choose a point layer (Tourist Attractions, MRT Stations, or an eligible portal layer) to analyze.");
    }

    const sourceLayer = this.buildLayerMap()[sourceId];
    const id = `heatmap_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const meta = { title: trimmedName, url: sourceLayer.url, sourceId, intensity, radius, visible: true };
    this.heatmapLayerMeta.set(id, meta);
    this.layerOrder = [...this.layerOrder, id];

    const layer = new FeatureLayer({
      url: meta.url,
      title: meta.title,
      visible: meta.visible,
      outFields: ["*"],
      opacity: 0.8,
      renderer: buildHeatmapRenderer(intensity, radius).renderer
    });
    this.heatmapLayers.set(id, layer);

    if (this.currentMap) this.currentMap.add(layer);

    return { id, name: trimmedName };
  }

  // Adjusts an existing named heatmap layer's intensity (same clone-then-
  // reassign pattern setLayerStyle/resolveSeedRenderer use elsewhere), and
  // persists it to heatmapLayerMeta so the value survives a 2D/3D
  // reattachment instead of resetting to whatever it was created with.
  updateHeatmapLayerIntensity(id, intensity) {
    const meta = this.heatmapLayerMeta.get(id);
    if (!meta) return;
    meta.intensity = intensity;

    const layer = this.heatmapLayers.get(id);
    if (!layer) return;
    const r = layer.renderer.clone();
    r.maxPixelIntensity = intensity;
    layer.renderer = r;
  }

  // Removes a named heatmap layer entirely, the same remove-not-hide
  // behavior removePortalLayer gives user-added portal layers, since this
  // layer only exists because a user explicitly created it.
  removeHeatmapLayer(id) {
    if (!this.heatmapLayerMeta.has(id)) return;

    const layer = this.heatmapLayers.get(id);
    if (layer && this.currentMap) this.currentMap.remove(layer);

    this.heatmapLayers.delete(id);
    this.heatmapLayerMeta.delete(id);
    this.layerOrder = this.layerOrder.filter((x) => x !== id);
  }

  // Snapshots the current route search result (the route line plus its
  // start/end stop markers) as a new, independently named/toggleable/
  // removable layer in the Layers card - the discoverable "save this route"
  // entry point, since the live routeLayer/stopLayer (see routeVisible/
  // toggleRoute) are excluded from that card and always get overwritten by
  // the next route search. Throws (same throw-and-let-the-shell-toast
  // convention as createHeatmapLayer/addPortalLayer) on a blank name or when
  // there is no route currently drawn, rather than silently no-opping.
  createRouteResultLayer(name) {
    const trimmedName = (name || "").trim();
    if (!trimmedName) throw new Error("Please give the route layer a name.");
    if (!this.routeGraphic) throw new Error("Search a route first, then add it to the layers card.");

    const id = `route_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const meta = {
      title: trimmedName,
      route: this.graphicToJSON(this.routeGraphic),
      start: this.graphicToJSON(this.startGraphic),
      end: this.graphicToJSON(this.endGraphic),
      visible: true
    };
    this.namedRouteLayerMeta.set(id, meta);

    const layer = new GraphicsLayer({ title: trimmedName, visible: true });
    const graphics = [meta.route, meta.start, meta.end].map((g) => this.graphicFromJSON(g)).filter(Boolean);
    layer.addMany(graphics);
    this.namedRouteLayers.set(id, layer);
    this.layerOrder = [...this.layerOrder, id];

    if (this.currentMap) this.currentMap.add(layer);

    return { id, name: trimmedName };
  }

  // Removes a named route-result layer entirely, the same remove-not-hide
  // behavior removeHeatmapLayer/removePortalLayer give other user-created
  // layers.
  removeRouteResultLayer(id) {
    if (!this.namedRouteLayerMeta.has(id)) return;

    const layer = this.namedRouteLayers.get(id);
    if (layer && this.currentMap) this.currentMap.remove(layer);

    this.namedRouteLayers.delete(id);
    this.namedRouteLayerMeta.delete(id);
    this.layerOrder = this.layerOrder.filter((x) => x !== id);
  }

  // Snapshots the current geocoded search-result marker as a new,
  // independently named/toggleable/removable layer in the Layers card - the
  // discoverable "save this search result" entry point, since the live
  // searchLayer (see searchGraphic/searchVisible) is excluded from that card
  // and always gets overwritten by the next address search. Throws (same
  // throw-and-let-the-shell-toast convention as createRouteResultLayer) on a
  // blank name or when there is no search result currently placed.
  createSearchResultLayer(name) {
    const trimmedName = (name || "").trim();
    if (!trimmedName) throw new Error("Please give the search result layer a name.");
    if (!this.searchGraphic) throw new Error("Search an address first, then add it to the layers card.");

    const id = `search_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
    const meta = {
      title: trimmedName,
      marker: this.graphicToJSON(this.searchGraphic),
      visible: true
    };
    this.namedSearchLayerMeta.set(id, meta);

    const layer = new GraphicsLayer({ title: trimmedName, visible: true });
    const graphic = this.graphicFromJSON(meta.marker);
    if (graphic) layer.add(graphic);
    this.namedSearchLayers.set(id, layer);
    this.layerOrder = [...this.layerOrder, id];

    if (this.currentMap) this.currentMap.add(layer);

    return { id, name: trimmedName };
  }

  // Clears the live, transient search-result marker (searchGraphic/
  // searchLayer) - called once its contents have been snapshotted into a
  // named layer (see createSearchResultLayer/ApplicationShell), so the
  // Search card returns to its empty initial state instead of leaving a
  // now-redundant marker (duplicating the one just saved) on the map.
  clearSearchResult() {
    this.searchGraphic = null;
    this.searchLayer?.removeAll();
  }

  // Removes a named search-result layer entirely, the same remove-not-hide
  // behavior removeRouteResultLayer/removeHeatmapLayer/removePortalLayer
  // give other user-created layers.
  removeSearchResultLayer(id) {
    if (!this.namedSearchLayerMeta.has(id)) return;

    const layer = this.namedSearchLayers.get(id);
    if (layer && this.currentMap) this.currentMap.remove(layer);

    this.namedSearchLayers.delete(id);
    this.namedSearchLayerMeta.delete(id);
    this.layerOrder = this.layerOrder.filter((x) => x !== id);
  }

  // Zooms/pans the current view to the extent of one layer's content, so a
  // user can jump to e.g. just their drawings or just the MRT lines instead
  // of hunting for them at the current zoom level.
  async zoomToLayer(id, msg) {
    if (!this.currentView) return;

    const layer = this.buildLayerMap()[id];
    if (!layer) return;

    // A hidden layer would otherwise make "zoom to layer" look like it did
    // nothing: the camera moves, but there's nothing visible to show for it.
    // Reveal it, and keep the engine's own visibility field in sync so it
    // doesn't reset to hidden on the next 2D/3D reattachment.
    if (layer.visible === false) {
      layer.visible = true;
      const visibilityField = GISMapEngine.VISIBILITY_FIELD_BY_LAYER_ID[id];
      if (visibilityField) this[visibilityField] = true;

      const portalMeta = this.portalLayerMeta.get(id);
      if (portalMeta) portalMeta.visible = true;
    }

    // A bare Layer instance is NOT a valid `view.goTo()` target (the ArcGIS
    // SDK's GoToTarget2D/3D union only accepts Geometry/Graphic/Viewpoint,
    // not Layer) — passing one silently rejects, which is why this looked
    // like it did nothing regardless of visibility. GraphicsLayers
    // (route/stops/drawings) have no SDK-computed extent, so goTo targets
    // their graphics array directly (Graphic[] is a valid target);
    // FeatureLayers (touristAttractions/mrt*) use their
    // service-provided fullExtent, available once loaded.
    if (layer.graphics) {
      const graphics = layer.graphics.toArray();
      if (graphics.length === 0) {
        msg?.("Nothing to zoom to on this layer yet.", "error");
        return;
      }
      try {
        await this.currentView.goTo(graphics);
      } catch {
        msg?.("Could not zoom to this layer.", "error");
      }
      return;
    }

    try {
      if (typeof layer.load === "function") await layer.load();
      if (!layer.fullExtent) {
        msg?.("Nothing to zoom to on this layer yet.", "error");
        return;
      }
      await this.currentView.goTo(layer.fullExtent);
    } catch {
      msg?.("Could not zoom to this layer.", "error");
    }
  }

  // Applies Simple-mode symbology - fill/line color, border (outline)
  // thickness/color, marker shape/line dash style/fill pattern, marker size,
  // opacity, and (FeatureLayer-backed/portal simple-marker layers only) halo
  // - to a layer's symbol. Only layers backed by a single, well-defined
  // symbol are supported: Tourist Attractions/MRT stations/lines (FeatureLayer
  // simple renderers), the route graphic (single simple-line), drawings, and
  // stylable portal layers. Since the drawings layer can hold any mix of
  // point/line/polygon graphics at once, `symbolType` scopes the update to
  // only the graphics of that geometry type, so each style group in the
  // panel can be edited independently. `outlineColor` only applies to
  // polygon (`simple-fill`) symbols, which have a fill color distinct from
  // their outline/border color. See SymbolRenderers.js's
  // applyExtendedSymbolStyle for the full set of per-type properties.
  setLayerStyle(id, { color, borderWidth, outlineColor, symbolType, markerStyle, lineStyle, fillStyle, size, opacity, halo, haloColor, haloSize } = {}) {
    const applySymbolStyle = (symbol) =>
      applyExtendedSymbolStyle(symbol, { color, borderWidth, outlineColor, markerStyle, lineStyle, fillStyle, size, opacity });

    // Only ever sent by the UI for a simple-marker style group, but harmless
    // (a no-op) for any other id/group since it's gated on `halo !== undefined`.
    if (halo !== undefined) {
      if (halo) this.haloState.set(id, { color: haloColor, size: haloSize });
      else this.haloState.delete(id);
    }

    // Named route-result layers (see createRouteResultLayer) have a
    // dynamic, per-instance id ("route_<id>"), so they can't be a `switch`
    // case literal like the fixed layers below - checked first instead.
    // Only the route line (`simple-line`) is a style group getLayers()
    // exposes for this layer (see its comment - the two stop markers are
    // deliberately excluded, same reason `stops` itself is), so this only
    // ever touches that one graphic regardless of what `symbolType` is sent.
    // The edited symbol is written back into `namedRouteLayerMeta` (not just
    // the live graphic) so it survives a 2D/3D reattachment, which rebuilds
    // this layer's graphics from that meta snapshot - see attachToView.
    if (this.namedRouteLayers.has(id)) {
      const layer = this.namedRouteLayers.get(id);
      const lineGraphic = layer?.graphics.toArray().find((g) => g.symbol?.type === "simple-line");
      if (!lineGraphic) return;
      lineGraphic.symbol = applySymbolStyle(lineGraphic.symbol);
      const meta = this.namedRouteLayerMeta.get(id);
      if (meta) meta.route = this.graphicToJSON(lineGraphic);
      return;
    }

    // Named search-result layers (see createSearchResultLayer) have a
    // dynamic, per-instance id ("search_<id>"), so they can't be a `switch`
    // case literal either - checked the same way namedRouteLayers is above.
    // The edited symbol is written back into `namedSearchLayerMeta` (not
    // just the live graphic) so it survives a 2D/3D reattachment, which
    // rebuilds this layer's graphic from that meta snapshot - see
    // attachToView.
    if (this.namedSearchLayers.has(id)) {
      const layer = this.namedSearchLayers.get(id);
      const markerGraphic = layer?.graphics.toArray().find((g) => g.symbol?.type === "simple-marker");
      if (!markerGraphic) return;
      markerGraphic.symbol = applySymbolStyle(markerGraphic.symbol);
      const meta = this.namedSearchLayerMeta.get(id);
      if (meta) meta.marker = this.graphicToJSON(markerGraphic);
      return;
    }

    switch (id) {
      case "touristAttractions": {
        const template = this.ensureSimpleBase(
          this.touristAttractionRenderer,
          this.touristAttractionLayer?.renderer,
          (r) => { this.touristAttractionRenderer = r; }
        );
        if (!template) return;
        const renderer = this.cloneRenderer(template);
        renderer.symbol = applySymbolStyle(renderer.symbol);
        this.touristAttractionRenderer = renderer;
        if (this.touristAttractionLayer) {
          this.touristAttractionLayer.renderer = this.resolveSeedRenderer("touristAttractions", renderer);
        }
        break;
      }
      case "mrtStations": {
        const template = this.ensureSimpleBase(
          this.mrtStationRenderer,
          this.mrtStationLayer?.renderer,
          (r) => { this.mrtStationRenderer = r; }
        );
        if (!template) return;
        const renderer = this.cloneRenderer(template);
        renderer.symbol = applySymbolStyle(renderer.symbol);
        this.mrtStationRenderer = renderer;
        if (this.mrtStationLayer) {
          this.mrtStationLayer.renderer = this.resolveSeedRenderer("mrtStations", renderer);
        }
        break;
      }
      case "mrtLines": {
        const template = this.ensureSimpleBase(
          this.mrtLineRenderer,
          this.mrtLineLayer?.renderer,
          (r) => { this.mrtLineRenderer = r; }
        );
        if (!template) return;
        const renderer = this.cloneRenderer(template);
        renderer.symbol = applySymbolStyle(renderer.symbol);
        this.mrtLineRenderer = renderer;
        if (this.mrtLineLayer) {
          this.mrtLineLayer.renderer = this.resolveSeedRenderer("mrtLines", renderer);
        }
        break;
      }
      case "route": {
        if (!this.routeGraphic) return;
        this.routeGraphic.symbol = applySymbolStyle(this.routeGraphic.symbol);
        break;
      }
      case "drawings": {
        if (!this.drawLayer) return;
        this.drawLayer.graphics.forEach((graphic) => {
          if (symbolType && graphic.symbol?.type !== symbolType) return;
          graphic.symbol = applySymbolStyle(graphic.symbol);
        });
        break;
      }
      default: {
        // Portal-added layers (see getLayers()'s portal-layer branch above)
        // go through the same ensureSimpleBase bootstrap as the three fixed
        // hosted layers - including its fallback to a generated default
        // symbol (keyed by the layer's own geometryType) when the portal
        // service's own renderer isn't already Simple. Without that
        // fallback, a portal layer added from a service whose default
        // renderer was Unique Values/Class Breaks/heatmap/etc. (an ordinary,
        // common case) had no symbol anywhere to clone from, and this branch
        // silently did nothing - see ensureSimpleBase's comment.
        const portalLayer = this.portalLayers.get(id);
        const meta = this.portalLayerMeta.get(id);
        const template = this.ensureSimpleBase(
          meta?.renderer,
          portalLayer?.renderer,
          (r) => { if (meta) meta.renderer = r; },
          portalLayer?.geometryType
        );
        if (!template) return;

        const renderer = this.cloneRenderer(template);
        renderer.symbol = applySymbolStyle(renderer.symbol);
        if (meta) meta.renderer = renderer;
        if (portalLayer) portalLayer.renderer = this.resolveSeedRenderer(id, renderer);
        break;
      }
    }
  }

  // `from`/`to` are indices into what the Layers card actually displays
  // (LayerControlPanel's `layers` prop, i.e. getLayers()'s output), not raw
  // positions in `this.layerOrder` - route/stops/searchResult occupy
  // layerOrder slots but are filtered out of getLayers() (see its comment),
  // so a naive splice directly on layerOrder would be off by however many
  // hidden ids precede the touched position. Reorder within the
  // card-visible id subsequence instead, then reinsert each hidden id back
  // at its own original absolute layerOrder position (never touched by this
  // method, since nothing offers a way to move them from the UI).
  reorderLayers(from, to) {
    const hidden = [];
    const visible = [];
    this.layerOrder.forEach((id, i) => {
      if (id === "route" || id === "stops" || id === "searchResult") hidden.push({ id, i });
      else visible.push(id);
    });

    const [moved] = visible.splice(from, 1);
    visible.splice(to, 0, moved);

    const order = [...visible];
    hidden.forEach(({ id, i }) => order.splice(i, 0, id));
    this.layerOrder = order;

    if (!this.currentMap) return;

    const map = this.buildLayerMap();

    order.forEach((id, i) => {
      const layer = map[id];
      if (layer) this.currentMap.reorder(layer, i);
    });
  }

  startPointDraw() { this.activeDrawType = "point"; this.sketchVM?.create("point"); }
  startLineDraw()  { this.activeDrawType = "polyline"; this.sketchVM?.create("polyline"); }
  startPolygonDraw(){ this.activeDrawType = "polygon"; this.sketchVM?.create("polygon"); }
  cancelDraw() { this.sketchVM?.cancel(); }

  getDrawnFeatures() {
    const f = [];

    if (this.drawLayer) f.push(...this.drawLayer.graphics.toArray());
    if (this.routeGraphic) f.push(this.routeGraphic);
    if (this.startGraphic) f.push(this.startGraphic);
    if (this.endGraphic) f.push(this.endGraphic);

    return f;
  }

  hasDrawings() {
    return this.getDrawnFeatures().length > 0;
  }

  toGeoJSONGeometry(g) {
    if (!g) return null;

    if (g.type === "point") return { type: "Point", coordinates: [g.x, g.y] };
    if (g.type === "polyline") return { type: "LineString", coordinates: g.paths?.[0] || [] };
    if (g.type === "polygon") return { type: "Polygon", coordinates: g.rings || [] };

    return null;
  }

  saveDrawings(msg) {
    const f = this.getDrawnFeatures();
    if (!f.length) return msg?.("Please draw something, before saving", "error");

    const geojson = {
      type: "FeatureCollection",
      features: f.map(x => ({
        type: "Feature",
        geometry: this.toGeoJSONGeometry(x.geometry),
        properties: {}
      }))
    };

    const url = URL.createObjectURL(new Blob([JSON.stringify(geojson)], { type: "application/json" }));

    const a = document.createElement("a");
    a.href = url;
    a.download = "drawings.geojson";
    a.click();

    URL.revokeObjectURL(url);
    msg?.("GeoJSON downloaded", "success");
  }

  async uploadGeoJSON(file, msg) {
  if (!file || !this.currentMap || !this.currentView) return;

  try {
    // 🚨 BLOCK UPLOAD IF UNSAVED DRAWINGS EXIST
    if (this.drawLayer?.graphics?.length > 0) {
      msg?.("Please save your current drawing and refresh the page before uploading", "error");
      return;
    }

    const geojson = JSON.parse(await file.text());

    const graphics = geojson.features
      .map(f => {
        const g = f.geometry;

        let geometry = null;

        if (g.type === "Point") {
          geometry = {
            type: "point",
            x: g.coordinates[0],
            y: g.coordinates[1],
            spatialReference: { wkid: 3857 }
          };
        }

        if (g.type === "LineString") {
          geometry = {
            type: "polyline",
            paths: [g.coordinates],
            spatialReference: { wkid: 3857 }
          };
        }

        if (g.type === "Polygon") {
          geometry = {
            type: "polygon",
            rings: g.coordinates,
            spatialReference: { wkid: 3857 }
          };
        }

        // Unsupported geometry types (e.g. MultiPoint/MultiLineString/
        // MultiPolygon) have no conversion above and would otherwise produce
        // a Graphic with geometry: null. Adding that to drawLayer doesn't
        // fail quietly - the ArcGIS LayerView throws while building the
        // Drawings layerview's render batch, which kills rendering for every
        // graphic on the layer (not just this one), and the failure recurs
        // on every future attachToView (2D/3D switch) since the bad graphic
        // stays in drawLayer. Skip it instead of creating it.
        if (!geometry) return null;

        return new Graphic({
          geometry,
          attributes: this.buildDrawingAttributes(f.properties || {}),
          symbol: {
            type: UPLOAD_SYMBOL_TYPE_BY_GEOMETRY[g.type] ?? "simple-fill",
            color: UPLOAD_SYMBOL_COLOR_BY_GEOMETRY[g.type] ?? [0, 120, 255, 0.3],
            size: g.type === "Point" ? 8 : undefined,
            width: g.type === "LineString" ? 2 : undefined
          }
        });
      })
      .filter(Boolean);

    const skippedCount = geojson.features.length - graphics.length;

    // Respect any active drawings filter (see setLayerFilter) for newly
    // uploaded graphics too, so uploading into an already-filtered view
    // doesn't silently show features the user just asked to hide.
    graphics.forEach((g) => {
      this.applyDrawingsFilterToGraphic(g);
      this.applyDrawingsRendererToGraphic(g);
    });

    this.drawLayer.addMany(graphics);

    this.uploadedLayers.push({
      id: `upload_${Date.now()}`,
      name: file.name,
      layer: this.drawLayer
    });

    // A bare GraphicsLayer isn't a valid goTo target (see zoomToLayer); the
    // uploaded graphics array is.
    await this.currentView.goTo(graphics);

    const skippedNote = skippedCount > 0
      ? ` (${skippedCount} unsupported feature(s) skipped)`
      : "";
    msg?.(`Uploaded ${graphics.length} feature(s) from "${file.name}".${skippedNote}`, "success");

  } catch (err) {
    console.error("Upload failed:", err);
    msg?.("Upload failed: the file could not be read as valid GeoJSON.", "error");
  }
}

  // Global feature search: queries every hosted FeatureLayer's string fields
  // for a case-insensitive substring match, plus the local drawings layer's
  // in-memory attributes. Field names come from the layer's own schema (not
  // user input), and the search text is escaped (doubling single quotes)
  // before being interpolated into the `where` clause - queryFeatures has no
  // parameterized-query option, so this is the closest equivalent available
  // for the ArcGIS REST query language.
  static escapeForWhereClause(text) {
    return text.replace(/'/g, "''");
  }

  pickSearchLabel(attributes, candidateFields) {
    if (!attributes) return null;
    for (const field of candidateFields) {
      if (attributes[field]) return String(attributes[field]);
    }
    const firstValue = Object.values(attributes).find((v) => v != null && v !== "");
    return firstValue != null ? String(firstValue) : null;
  }

  async searchHostedLayer(id, layer, title, text) {
    if (!layer) return [];
    try {
      await layer.load();
      const stringFields = (layer.fields || [])
        .filter((f) => f.type === "string")
        .map((f) => f.name);
      if (!stringFields.length) return [];

      const escaped = GISMapEngine.escapeForWhereClause(text);
      const where = stringFields
        .map((f) => `UPPER(${f}) LIKE UPPER('%${escaped}%')`)
        .join(" OR ");

      const result = await layer.queryFeatures({
        where,
        outFields: ["*"],
        returnGeometry: true,
        num: 10
      });

      return result.features.map((feature) => ({
        type: "feature",
        layerId: id,
        layerTitle: title,
        label: this.pickSearchLabel(feature.attributes, stringFields) || title,
        attributes: feature.attributes,
        objectIdField: layer.objectIdField,
        geometry: feature.geometry,
        graphic: feature
      }));
    } catch (err) {
      console.error(`Search failed for layer "${title}":`, err);
      return [];
    }
  }

  searchDrawings(text) {
    const needle = text.toLowerCase();
    return this.drawLayer.graphics
      .filter((g) =>
        Object.values(g.attributes || {}).some((v) =>
          String(v ?? "").toLowerCase().includes(needle)
        )
      )
      .toArray()
      .slice(0, 10)
      .map((g) => ({
        type: "feature",
        layerId: "drawings",
        layerTitle: "Drawings",
        label: this.pickSearchLabel(g.attributes, Object.keys(g.attributes || {})) || "Drawing",
        attributes: g.attributes,
        objectIdField: null,
        geometry: g.geometry,
        graphic: g
      }));
  }

  // Returns up to 10 matches per layer across Tourist Attractions, MRT
  // Stations, MRT Lines, Drawings, and any portal-added layers. Address
  // geocoding is handled by ApplicationShell (via GeocodingService) rather
  // than here, consistent with the existing rule that stateless services
  // are called from the shell, not from the engine.
  async searchFeatures(query) {
    const text = query?.trim();
    if (!text) return [];

    const hostedTargets = [
      { id: "touristAttractions", layer: this.touristAttractionLayer, title: "Tourist Attractions" },
      { id: "mrtStations", layer: this.mrtStationLayer, title: "MRT Stations" },
      { id: "mrtLines", layer: this.mrtLineLayer, title: "MRT Lines" },
      ...Array.from(this.portalLayers, ([id, layer]) => ({
        id,
        layer,
        title: this.portalLayerMeta.get(id)?.title || layer.title || "Portal Layer"
      }))
    ];

    const hostedResults = await Promise.all(
      hostedTargets.map(({ id, layer, title }) => this.searchHostedLayer(id, layer, title, text))
    );

    return [...hostedResults.flat(), ...this.searchDrawings(text)];
  }

  // Zooms to and selects a feature search result, reusing the same
  // onFeatureSelect callback the click-to-select flow uses so the attribute
  // panel opens identically either way. Screen coordinates for the panel's
  // position are derived from the view after the camera move completes,
  // since a search result (unlike a click) has no originating pointer event.
  async zoomToSearchResult(result) {
    if (!this.currentView || !result?.geometry) return;

    try {
      await this.currentView.goTo(result.geometry);
    } catch {
      return;
    }

    const screenPoint = this.currentView.toScreen(result.geometry);

    this.selectedGraphic = result.graphic || null;
    this.selectedLayerId = result.layerId;

    this.onFeatureSelect?.({
      layerId: result.layerId,
      layerTitle: result.layerTitle,
      objectIdField: result.objectIdField,
      attributes: result.attributes,
      x: screenPoint.x,
      y: screenPoint.y
    });
  }

  // Zooms to a geocoded address point and drops a pin-style marker there, so
  // geocoding a search result is visibly confirmed on the map instead of
  // just moving the camera with nothing to show for it. No feature/attribute
  // panel applies here since an address match has no backing layer graphic.
  // The marker is kept on its own dedicated searchLayer (rather than e.g.
  // the route's stop markers) so it doesn't get confused with or overwritten
  // by unrelated route/drawing graphics, and persists across 2D/3D
  // reattachment the same way routeGraphic/startGraphic/endGraphic do.
  async zoomToPoint(longitude, latitude) {
    if (!this.currentView) return;

    const point = { type: "point", longitude, latitude, spatialReference: { wkid: 4326 } };

    this.searchGraphic = new Graphic({
      geometry: point,
      symbol: {
        type: "simple-marker",
        style: "diamond",
        color: [56, 189, 248],
        size: 14,
        outline: { color: "white", width: 1.5 }
      }
    });

    if (this.searchLayer) {
      this.searchLayer.removeAll();
      this.searchLayer.add(this.searchGraphic);
    }

    // `view.goTo()`'s `target` requires a real Geometry/Graphic instance -
    // unlike Graphic's own `geometry` setter (used just above), it does not
    // coerce a plain `{ type: "point", ... }` JSON object. Passing the raw
    // `point` object here silently failed to navigate (no error visible to
    // the user), leaving the camera wherever it already was while the
    // marker got added off-screen - looking like the search "didn't work"
    // even though the marker was rendered. Passing the Graphic itself is
    // both a valid goTo target and guaranteed to carry the real, converted
    // Point geometry.
    try {
      await this.currentView.goTo({ target: this.searchGraphic, zoom: 15 });
    } catch {
      // Ignore navigation failures (e.g. an interrupted animation).
    }
  }

  async updateSelectedFeatureAttributes(updates) {
    if (!this.selectedGraphic || !this.selectedLayerId) {
      throw new Error("No feature selected.");
    }

    if (this.selectedLayerId === "drawings") {
      Object.assign(this.selectedGraphic.attributes, updates);
      return { success: true, attributes: { ...this.selectedGraphic.attributes } };
    }

    const layer = this.hostedLayerById(this.selectedLayerId);
    if (!layer) throw new Error("Layer not found.");

    // A hosted service the current identity can't write to rejects applyEdits
    // with a 403, and IdentityManager answers a 403 by opening its own
    // sign-in modal - forcing a login on a user who only wanted to look at
    // the map. The app's public API key is a read-only identity for these
    // services, so that was the default experience. Checking the layer's
    // advertised capabilities first turns it into an ordinary error toast
    // and leaves the app fully usable read-only.
    if (layer.capabilities?.operations?.supportsUpdate === false) {
      throw new Error(
        `"${layer.title}" is read-only for the current user. Sign in with an account that can edit it.`
      );
    }

    const objectIdField = layer.objectIdField;
    const objectId = this.selectedGraphic.attributes[objectIdField];

    const edit = new Graphic({
      attributes: { [objectIdField]: objectId, ...updates }
    });

    const result = await layer.applyEdits({ updateFeatures: [edit] });
    const updateResult = result.updateFeatureResults?.[0];

    if (updateResult?.error) {
      throw new Error(updateResult.error.message || "Failed to save attribute changes.");
    }

    Object.assign(this.selectedGraphic.attributes, updates);
    return { success: true, attributes: { ...this.selectedGraphic.attributes } };
  }

  async addColumnToLayer(layerId, fieldName, fieldType = "esriFieldTypeString", defaultValue = null) {
    if (!fieldName) throw new Error("Field name is required.");

    if (layerId === "drawings") {
      if (this.drawingFields.some((f) => f.name === fieldName)) {
        throw new Error(`Column "${fieldName}" already exists.`);
      }

      this.drawingFields.push({ name: fieldName, type: fieldType, defaultValue });
      this.drawLayer.graphics.forEach((g) => {
        if (!(fieldName in g.attributes)) g.attributes[fieldName] = defaultValue;
      });

      return { success: true };
    }

    const layer = this.hostedLayerById(layerId);
    if (!layer) throw new Error("Layer not found.");

    // Adding a field to a hosted feature service is an admin schema change:
    // it requires a token from a user with edit/admin privileges on the item,
    // not just the app's public API key.
    //
    // getCredential() ACQUIRES a credential, which means opening the SDK's
    // own sign-in modal whenever there isn't one - so this call used to
    // force a login unconditionally, every time, on an app that is meant to
    // work anonymously. findCredential() is the non-prompting lookup: it
    // returns undefined instead of prompting, letting us fail with our own
    // toast. Both the service URL and the portal are checked because an
    // ArcGIS Online sign-in registers a portal credential that federates to
    // the hosted service rather than a per-service one. When a credential
    // does exist, the getCredential() below resolves from it silently.
    const existingCredential =
      IdentityManager.findCredential(layer.url) ||
      IdentityManager.findCredential(`${PORTAL_URL}/sharing`);

    if (!existingCredential) {
      throw new Error("Sign in with an account that owns this layer to add a column.");
    }

    const credential = await IdentityManager.getCredential(layer.url);
    const addToDefinitionUrl = `${layer.url}/${layer.layerId ?? 0}/addToDefinition`;

    const body = new FormData();
    body.append("f", "json");
    body.append("token", credential.token);
    body.append(
      "addToDefinition",
      JSON.stringify({
        fields: [
          {
            name: fieldName,
            type: fieldType,
            alias: fieldName,
            nullable: true,
            editable: true,
            defaultValue
          }
        ]
      })
    );

    const response = await esriRequest(addToDefinitionUrl, {
      method: "post",
      responseType: "json",
      body
    });

    if (response.data?.error) {
      throw new Error(response.data.error.message || "Failed to add column to layer.");
    }

    await layer.refresh();
    return { success: true };
  }

  // ---------------------------------------------------------------------
  // Project Persistence (Save/Load Project)
  //
  // The ArcGIS Pro ".aprx" analog: a single downloadable JSON snapshot of
  // every piece of engine-owned session state, re-uploadable later (a new
  // browser session, a different machine) to pick up exactly where the user
  // left off, the same way saveDrawings/uploadGeoJSON round-trip drawings
  // alone but for the whole map - layer order/visibility, Simple/Advanced
  // symbology, halo, filters, annotations, portal layers, drawings (with
  // attributes, unlike saveDrawings), route/stops, the search marker, and
  // the current camera extent/2D-3D mode.
  //
  // Every field this reads already documents itself elsewhere as the actual
  // source of truth for its concern (touristAttractionRenderer/layerFilters/
  // layerAnnotations/layerRenderers/haloState/portalLayerMeta - see each
  // field's own comment above), so this is a plain aggregation, not a new
  // parallel state mechanism.
  //
  // Geometries/symbols/renderers are hand-serialized to plain JSON (not via
  // each object's own ArcGIS-provided `.toJSON()`) because that method
  // returns Esri REST-dialect `type` strings (e.g. "esriSMS"), whereas this
  // file's own symbol/renderer comparisons throughout (symbolToStyleGroup,
  // resolveSeedRenderer's halo gate, getBaseSymbolForLayer's switch, ...)
  // all key off the JS API dialect ("simple-marker"). Round-tripping through
  // the REST dialect would silently break every one of those comparisons on
  // reload. The shapes built here intentionally match the plain literals
  // already used for touristAttractionRenderer/mrtStationRenderer/etc., so a
  // reloaded value bootstraps through the exact same "plain base, cloned
  // from the live layer on first edit" path (ensureSimpleBase/
  // rendererTemplate) as a layer that was never touched this session.
  // ---------------------------------------------------------------------

  static PROJECT_STATE_VERSION = 1;

  // Reads a Color instance/hex string/[r,g,b]/[r,g,b,a] array down to a
  // plain [r,g,b,a] array (alpha 0-1, matching this file's own literals,
  // e.g. mrtStationRenderer's `[0, 120, 255, 0.5]`) - unlike colorToHex
  // (used for UI swatches), this deliberately keeps alpha rather than
  // discarding it, since a dropped alpha would visibly change a
  // semi-transparent fill on reload.
  colorToJSON(color) {
    if (!color) return null;
    if (typeof color === "string") return color;
    if (Array.isArray(color)) return color;
    if (typeof color.r === "number") return [color.r, color.g, color.b, color.a ?? 1];
    return null;
  }

  // Plain-JSON snapshot of a symbol, covering only the symbol shapes this
  // app itself ever constructs (simple-marker/simple-line/simple-fill - see
  // setLayerStyle/applyExtendedSymbolStyle). Anything else (a portal
  // service's own untouched default symbol, or a live "cim" halo composite -
  // haloState's plain {color,size} is what's persisted for halo, and
  // resolveSeedRenderer recomposites it from that on reload, so the CIM
  // symbol itself never needs to round-trip) is dropped rather than
  // guessed at.
  symbolToPlainJSON(symbol) {
    if (!symbol) return null;
    const outline = symbol.outline
      ? { color: this.colorToJSON(symbol.outline.color), width: symbol.outline.width }
      : undefined;
    switch (symbol.type) {
      case "simple-marker":
        return { type: "simple-marker", style: symbol.style, color: this.colorToJSON(symbol.color), size: symbol.size, outline };
      case "simple-line":
        return { type: "simple-line", style: symbol.style, color: this.colorToJSON(symbol.color), width: symbol.width };
      case "simple-fill":
        return { type: "simple-fill", style: symbol.style, color: this.colorToJSON(symbol.color), outline };
      default:
        return null;
    }
  }

  // touristAttractionRenderer/mrtStationRenderer/mrtLineRenderer/portal
  // meta.renderer are always plain "simple" renderers (setLayerStyle keeps
  // them that way deliberately, per haloState's field comment), so there is
  // exactly one shape to serialize here.
  rendererToPlainJSON(renderer) {
    const symbol = this.symbolToPlainJSON(renderer?.symbol);
    return symbol ? { type: "simple", symbol } : null;
  }

  // layerRenderers descriptors (Unique Values / Class Breaks) carry live,
  // cloned Symbol instances inside uniqueValueInfos/classBreakInfos (see
  // buildUniqueValueRenderer/buildClassBreaksRenderer's use of
  // applyExtendedSymbolStyle) - the rest of the descriptor (field,
  // min/maxValue, legend) is already plain per SymbolRenderers.js's own
  // "ArcGIS-import-free" contract.
  layerRendererDescriptorToPlainJSON(descriptor) {
    if (!descriptor) return null;
    const plain = { ...descriptor };
    if (descriptor.type === "unique-value") {
      plain.uniqueValueInfos = descriptor.uniqueValueInfos.map((info) => ({
        ...info,
        symbol: this.symbolToPlainJSON(info.symbol)
      }));
      if (descriptor.defaultSymbol) plain.defaultSymbol = this.symbolToPlainJSON(descriptor.defaultSymbol);
    } else if (descriptor.type === "class-breaks") {
      plain.classBreakInfos = descriptor.classBreakInfos.map((brk) => ({
        ...brk,
        symbol: this.symbolToPlainJSON(brk.symbol)
      }));
    }
    return plain;
  }

  // Plain-JSON snapshot of a geometry, covering the same point/polyline/
  // polygon/extent shapes uploadGeoJSON already hand-builds - kept
  // consistent with that existing pattern (an explicit JS-API-dialect
  // `type` tag) rather than each geometry's own `.toJSON()`, for the same
  // dialect reason as symbols above.
  geometryToPlainJSON(geometry) {
    if (!geometry) return null;
    const spatialReference = geometry.spatialReference
      ? { wkid: geometry.spatialReference.wkid, wkt: geometry.spatialReference.wkt }
      : undefined;
    switch (geometry.type) {
      case "point":
        return { type: "point", x: geometry.x, y: geometry.y, spatialReference };
      case "polyline":
        return { type: "polyline", paths: geometry.paths, spatialReference };
      case "polygon":
        return { type: "polygon", rings: geometry.rings, spatialReference };
      case "extent":
        return {
          type: "extent",
          xmin: geometry.xmin,
          ymin: geometry.ymin,
          xmax: geometry.xmax,
          ymax: geometry.ymax,
          spatialReference
        };
      default:
        return null;
    }
  }

  graphicToJSON(graphic) {
    if (!graphic) return null;
    return {
      geometry: this.geometryToPlainJSON(graphic.geometry),
      symbol: this.symbolToPlainJSON(graphic.symbol),
      attributes: { ...(graphic.attributes || {}) }
    };
  }

  graphicFromJSON(entry) {
    if (!entry?.geometry) return null;
    return new Graphic({
      geometry: entry.geometry,
      symbol: entry.symbol || undefined,
      attributes: entry.attributes || {}
    });
  }

  buildProjectState() {
    return {
      version: GISMapEngine.PROJECT_STATE_VERSION,
      savedAt: new Date().toISOString(),
      is3D: this.isSceneView(),
      extent: this.currentView ? this.geometryToPlainJSON(this.currentView.extent) : null,
      layerOrder: [...this.layerOrder],
      visibility: {
        route: this.routeVisible,
        touristAttractions: this.touristAttractionVisible,
        mrtStations: this.mrtStationVisible,
        mrtLines: this.mrtLineVisible,
        search: this.searchVisible
      },
      renderers: {
        touristAttractions: this.rendererToPlainJSON(this.touristAttractionRenderer),
        mrtStations: this.rendererToPlainJSON(this.mrtStationRenderer),
        mrtLines: this.rendererToPlainJSON(this.mrtLineRenderer)
      },
      layerFilters: Object.fromEntries(this.layerFilters),
      layerAnnotations: Object.fromEntries(this.layerAnnotations),
      layerRenderers: Object.fromEntries(
        Array.from(this.layerRenderers, ([id, d]) => [id, this.layerRendererDescriptorToPlainJSON(d)])
      ),
      haloState: Object.fromEntries(this.haloState),
      portalLayers: Object.fromEntries(
        Array.from(this.portalLayerMeta, ([id, meta]) => [
          id,
          { title: meta.title, url: meta.url, visible: meta.visible, renderer: this.rendererToPlainJSON(meta.renderer) }
        ])
      ),
      heatmapLayers: Object.fromEntries(this.heatmapLayerMeta),
      namedRouteLayers: Object.fromEntries(this.namedRouteLayerMeta),
      namedSearchLayers: Object.fromEntries(this.namedSearchLayerMeta),
      drawingFields: [...this.drawingFields],
      drawings: this.drawLayer.graphics.toArray().map((g) => this.graphicToJSON(g)),
      route: this.graphicToJSON(this.routeGraphic),
      stops: { start: this.graphicToJSON(this.startGraphic), end: this.graphicToJSON(this.endGraphic) },
      searchMarker: this.graphicToJSON(this.searchGraphic)
    };
  }

  // Downloads the current session as a project file, mirroring
  // saveDrawings's msg-callback/anchor-download convention.
  saveProjectState(msg) {
    let state;
    try {
      state = this.buildProjectState();
    } catch (err) {
      console.error("Save project failed:", err);
      msg?.("Could not save the project.", "error");
      return;
    }

    const url = URL.createObjectURL(new Blob([JSON.stringify(state)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "project.json";
    a.click();
    URL.revokeObjectURL(url);
    msg?.("Project saved.", "success");
  }

  // Restores a previously saved project. Rebuilds every persisted field
  // first, then - if a view is already attached - calls attachToView again
  // so the change is reflected immediately against whatever view type
  // (2D/3D) is currently mounted; the caller (ApplicationShell) compares
  // the returned `is3D` against its own state and switches view mode if
  // they differ, which triggers a second, ordinary attachToView through the
  // usual handleViewReady path. That second rebuild re-reads the exact same
  // (already-updated) persisted fields, so it converges on the correct
  // result rather than reverting anything - a deliberately accepted minor
  // redundancy in exchange for not needing a view-ready promise/callback
  // threaded through this method.
  async loadProjectState(file, msg) {
    if (!file) return null;

    let state;
    try {
      state = JSON.parse(await file.text());
      if (!state || typeof state !== "object" || !Array.isArray(state.layerOrder)) {
        throw new Error("Not a recognized project file.");
      }
    } catch (err) {
      console.error("Load project failed:", err);
      msg?.("Load failed: the file could not be read as a valid project.", "error");
      return null;
    }

    // Filters out a stale "heat" id from a project file saved before heatmap
    // became a per-layer renderer mode (see the Heatmap System section) -
    // that id no longer resolves to anything in getLayers()'s lookup, which
    // would otherwise leave a hole in the restored layer list.
    this.layerOrder = state.layerOrder.filter((id) => id !== "heat");

    const visibility = state.visibility || {};
    this.routeVisible = visibility.route ?? this.routeVisible;
    this.touristAttractionVisible = visibility.touristAttractions ?? this.touristAttractionVisible;
    this.mrtStationVisible = visibility.mrtStations ?? this.mrtStationVisible;
    this.mrtLineVisible = visibility.mrtLines ?? this.mrtLineVisible;
    this.searchVisible = visibility.search ?? this.searchVisible;

    const renderers = state.renderers || {};
    if (renderers.touristAttractions) this.touristAttractionRenderer = renderers.touristAttractions;
    if (renderers.mrtStations) this.mrtStationRenderer = renderers.mrtStations;
    if (renderers.mrtLines) this.mrtLineRenderer = renderers.mrtLines;

    this.layerFilters = new Map(Object.entries(state.layerFilters || {}));
    this.layerAnnotations = new Map(Object.entries(state.layerAnnotations || {}));
    this.layerRenderers = new Map(Object.entries(state.layerRenderers || {}));
    this.haloState = new Map(Object.entries(state.haloState || {}));
    this.drawingFields = Array.isArray(state.drawingFields) ? [...state.drawingFields] : [];

    this.portalLayerMeta = new Map(Object.entries(state.portalLayers || {}));
    this.heatmapLayerMeta = new Map(Object.entries(state.heatmapLayers || {}));
    this.namedRouteLayerMeta = new Map(Object.entries(state.namedRouteLayers || {}));
    this.namedSearchLayerMeta = new Map(Object.entries(state.namedSearchLayers || {}));

    this.routeGraphic = this.graphicFromJSON(state.route);
    this.startGraphic = this.graphicFromJSON(state.stops?.start);
    this.endGraphic = this.graphicFromJSON(state.stops?.end);
    this.searchGraphic = this.graphicFromJSON(state.searchMarker);

    this.drawLayer.removeAll();
    const drawings = (state.drawings || []).map((entry) => this.graphicFromJSON(entry)).filter(Boolean);
    if (drawings.length) this.drawLayer.addMany(drawings);

    if (this.currentView) {
      this.attachToView(this.currentView);
      if (state.extent) {
        try {
          await this.currentView.goTo(state.extent);
        } catch {
          // Ignore navigation failures (e.g. an interrupted animation).
        }
      }
    }

    msg?.("Project loaded.", "success");

    return {
      is3D: Boolean(state.is3D),
      routeVisible: this.routeVisible,
      hasSearchResult: Boolean(this.searchGraphic)
    };
  }
}