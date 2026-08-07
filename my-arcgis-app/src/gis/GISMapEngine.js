import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import {
  HEATMAP_FEATURE_LAYER_URL,
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

function colorToHex(color) {
  return typeof color?.toHex === "function" ? color.toHex() : "#000000";
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
  heatLayer = null;
  searchLayer = null;

  routeGraphic = null;
  startGraphic = null;
  endGraphic = null;
  searchGraphic = null;

  routeVisible = true;
  heatVisible = false;
  heatIntensity = 50;
  searchVisible = true;

  layerOrder = [
    "route",
    "stops",
    "touristAttractions",
    "heat",
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
  // route/stops/heat/searchResult are excluded for the same reasons they're
  // excluded from the Layer Styling System (knowledge/index.md): route is one
  // unattributed line, stops are two fixed markers, heat has no queryable
  // schema of its own (it renders touristAttractions' geometry), and
  // searchResult is a transient single marker replaced on every search.
  static ANALYSIS_EXCLUDED_LAYER_IDS = new Set(["route", "stops", "heat", "searchResult"]);

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
      heat: this.heatLayer,
      mrtStations: this.mrtStationLayer,
      mrtLines: this.mrtLineLayer,
      drawings: this.drawLayer,
      searchResult: this.searchLayer,
      ...Object.fromEntries(this.portalLayers)
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
      url: HEATMAP_FEATURE_LAYER_URL,
      title: "Tourist Attractions",
      visible: this.touristAttractionVisible,
      outFields: ["*"],
      renderer: this.touristAttractionRenderer
    });

    this.mrtStationLayer = new FeatureLayer({
      url: MRT_STATION_FEATURE_LAYER_URL,
      title: "MRT Stations",
      visible: this.mrtStationVisible,
      outFields: ["*"],
      renderer: this.mrtStationRenderer
    });

    this.mrtLineLayer = new FeatureLayer({
      url: MRT_LINE_FEATURE_LAYER_URL,
      title: "MRT Lines",
      visible: this.mrtLineVisible,
      outFields: ["*"],
      renderer: this.mrtLineRenderer
    });

    this.heatLayer = new FeatureLayer({
      url: HEATMAP_FEATURE_LAYER_URL,
      title: "Heat Layer",
      visible: this.heatVisible,
      opacity: 0.8,
      renderer: {
        type: "heatmap",
        radius: 25,
        colorStops: [
          { ratio: 0, color: "rgba(0,0,255,0)" },
          { ratio: 0.2, color: "blue" },
          { ratio: 0.4, color: "cyan" },
          { ratio: 0.6, color: "lime" },
          { ratio: 0.8, color: "yellow" },
          { ratio: 1, color: "red" }
        ],
        maxPixelIntensity: this.heatIntensity,
        minPixelIntensity: 1
      }
    });

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
      // geometry-appropriate shape from.
      if (meta.renderer) {
        rebuilt.load().then(() => {
          rebuilt.renderer = meta.renderer;
        }).catch(() => {});
      }
      this.portalLayers.set(id, rebuilt);
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
      (id) => !GISMapEngine.ANALYSIS_EXCLUDED_LAYER_IDS.has(id)
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

  enableHeatmap(_, intensity) {
    this.heatVisible = true;
    this.heatIntensity = intensity;

    if (!this.heatLayer) return;
    this.heatLayer.visible = true;

    const r = this.heatLayer.renderer.clone();
    r.maxPixelIntensity = intensity;
    this.heatLayer.renderer = r;
  }

  disableHeatmap() {
    this.heatVisible = false;
    if (this.heatLayer) this.heatLayer.visible = false;
  }

  updateHeatmapIntensity(v) {
    this.heatIntensity = v;
    if (!this.heatLayer) return;

    const r = this.heatLayer.renderer.clone();
    r.maxPixelIntensity = v;
    this.heatLayer.renderer = r;
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
    return {
      symbolType: type,
      label: label ?? GISMapEngine.symbolTypeLabels[type] ?? "Style",
      color: colorToHex(symbol?.color),
      borderWidth: type === "simple-line" ? symbol?.width ?? null : symbol?.outline?.width ?? null,
      outlineColor: type === "simple-fill" ? colorToHex(symbol?.outline?.color) : undefined
    };
  }

  getLayers() {
    const l = this.layerOrder;

    const routeSymbol = this.routeGraphic?.symbol;
    const touristAttractionSymbol = this.touristAttractionLayer?.renderer?.symbol;
    const mrtStationSymbol = this.mrtStationLayer?.renderer?.symbol;
    const mrtLineSymbol = this.mrtLineLayer?.renderer?.symbol;

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
      seenTypes.forEach((symbol) => drawingsGroups.push(this.symbolToStyleGroup(symbol)));
    }

    const lookup = {
      route: {
        id: "route",
        name: "Route Layer",
        visible: this.routeLayer?.visible,
        styleGroups: routeSymbol ? [this.symbolToStyleGroup(routeSymbol, "Route")] : []
      },
      stops: { id: "stops", name: "Stop Layer", visible: this.stopLayer?.visible },
      touristAttractions: {
        id: "touristAttractions",
        name: "Tourist Attractions",
        visible: this.touristAttractionLayer?.visible,
        styleGroups: touristAttractionSymbol ? [this.symbolToStyleGroup(touristAttractionSymbol, "Tourist Attractions")] : [],
        filterable: true,
        filterDescription: this.getLayerFilterDescription("touristAttractions")
      },
      heat: { id: "heat", name: "Heatmap", visible: this.heatLayer?.visible },
      mrtStations: {
        id: "mrtStations",
        name: "MRT Stations",
        visible: this.mrtStationLayer?.visible,
        styleGroups: mrtStationSymbol ? [this.symbolToStyleGroup(mrtStationSymbol, "Stations")] : [],
        filterable: true,
        filterDescription: this.getLayerFilterDescription("mrtStations")
      },
      mrtLines: {
        id: "mrtLines",
        name: "MRT Lines",
        visible: this.mrtLineLayer?.visible,
        styleGroups: mrtLineSymbol ? [this.symbolToStyleGroup(mrtLineSymbol, "Lines")] : [],
        filterable: true,
        filterDescription: this.getLayerFilterDescription("mrtLines")
      },
      drawings: {
        id: "drawings",
        name: "Drawings",
        visible: this.drawLayer?.visible,
        styleGroups: drawingsGroups,
        filterable: true,
        filterDescription: this.getLayerFilterDescription("drawings")
      },
      searchResult: { id: "searchResult", name: "Search Result", visible: this.searchLayer?.visible }
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
      // expose a color/border control for. A "simple" renderer is the one
      // shape that, like touristAttractions/mrtStations/mrtLines, owns
      // exactly one symbol - so only that shape is offered a style group.
      const portalSymbol = layer.renderer?.type === "simple" ? layer.renderer.symbol : null;
      lookup[id] = {
        id,
        name: meta?.title || "Portal Layer",
        visible: layer.visible,
        removable: true,
        styleGroups: portalSymbol ? [this.symbolToStyleGroup(portalSymbol, meta?.title || "Portal Layer")] : [],
        filterable: true,
        filterDescription: this.getLayerFilterDescription(id)
      };
    });

    return l.map((id) => lookup[id]);
  }

  toggleLayer(id) {
    const layer = this.buildLayerMap()[id];
    if (!layer) return;

    layer.visible = !layer.visible;

    // Portal layers have no dedicated engine visibility field (route/heat/
    // etc. do); portalLayerMeta.visible IS that field for them, and must be
    // kept in sync so the layer reattaches with the right visibility on the
    // next 2D/3D switch (see attachToView's portal-layer reconstruction).
    const meta = this.portalLayerMeta.get(id);
    if (meta) meta.visible = layer.visible;
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
      const visibilityField = {
        route: "routeVisible",
        touristAttractions: "touristAttractionVisible",
        heat: "heatVisible",
        mrtStations: "mrtStationVisible",
        mrtLines: "mrtLineVisible",
        searchResult: "searchVisible"
      }[id];
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
    // FeatureLayers (touristAttractions/heat/mrt*) use their
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

  // Applies a fill/line color and border (outline) thickness to a layer's
  // symbology. Only layers backed by a single, well-defined symbol are
  // supported: Tourist Attractions/MRT stations/lines (FeatureLayer simple
  // renderers), the route graphic (single simple-line), and drawings. Since the drawings
  // layer can hold any mix of point/line/polygon graphics at once,
  // `symbolType` scopes the update to only the graphics of that geometry
  // type, so each style group in the panel can be edited independently.
  // `outlineColor` only applies to polygon (`simple-fill`) symbols, which
  // have a fill color distinct from their outline/border color.
  setLayerStyle(id, { color, borderWidth, outlineColor, symbolType } = {}) {
    const applySymbolStyle = (symbol) => {
      if (!symbol) return symbol;
      const next = symbol.clone();
      if (color) next.color = color;
      if (borderWidth != null) {
        if (next.type === "simple-line") next.width = borderWidth;
        else if (next.outline) next.outline.width = borderWidth;
      }
      if (outlineColor && next.type === "simple-fill" && next.outline) {
        next.outline.color = outlineColor;
      }
      return next;
    };

    switch (id) {
      case "touristAttractions": {
        if (!this.touristAttractionLayer?.renderer) return;
        const renderer = this.touristAttractionLayer.renderer.clone();
        renderer.symbol = applySymbolStyle(renderer.symbol);
        this.touristAttractionLayer.renderer = renderer;
        this.touristAttractionRenderer = renderer;
        break;
      }
      case "mrtStations": {
        if (!this.mrtStationLayer?.renderer) return;
        const renderer = this.mrtStationLayer.renderer.clone();
        renderer.symbol = applySymbolStyle(renderer.symbol);
        this.mrtStationLayer.renderer = renderer;
        this.mrtStationRenderer = renderer;
        break;
      }
      case "mrtLines": {
        if (!this.mrtLineLayer?.renderer) return;
        const renderer = this.mrtLineLayer.renderer.clone();
        renderer.symbol = applySymbolStyle(renderer.symbol);
        this.mrtLineLayer.renderer = renderer;
        this.mrtLineRenderer = renderer;
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
        // are only stylable when their service-supplied renderer is a
        // "simple" renderer with a single symbol - the one shape that maps
        // cleanly onto a single color/border control, same as the fixed
        // hosted layers above.
        const portalLayer = this.portalLayers.get(id);
        if (portalLayer?.renderer?.type !== "simple") return;
        const renderer = portalLayer.renderer.clone();
        renderer.symbol = applySymbolStyle(renderer.symbol);
        portalLayer.renderer = renderer;
        const meta = this.portalLayerMeta.get(id);
        if (meta) meta.renderer = renderer;
        break;
      }
    }
  }

  reorderLayers(from, to) {
    const order = [...this.layerOrder];
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
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
    graphics.forEach((g) => this.applyDrawingsFilterToGraphic(g));

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
}