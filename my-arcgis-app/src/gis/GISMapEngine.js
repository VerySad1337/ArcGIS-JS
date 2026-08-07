import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import {
  HEATMAP_FEATURE_LAYER_URL,
  MRT_STATION_FEATURE_LAYER_URL,
  MRT_LINE_FEATURE_LAYER_URL
} from "../config/ArcGISConfiguration";
import SketchViewModel from "@arcgis/core/widgets/Sketch/SketchViewModel";
import IdentityManager from "@arcgis/core/identity/IdentityManager";
import esriRequest from "@arcgis/core/request";

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
      this.portalLayers.set(
        id,
        new FeatureLayer({
          url: meta.url,
          title: meta.title,
          visible: meta.visible,
          outFields: ["*"]
        })
      );
    });

    const layerMap = this.buildLayerMap();

    this.layerOrder.forEach((id) => {
      const layer = layerMap[id];
      if (layer) map.add(layer);
    });

    if (this.clickHandle) this.clickHandle.remove();
    this.clickHandle = view.on("click", (event) => this.handleFeatureClick(event));

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
      this.drawLayer
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
    return null;
  }

  hostedLayerById(layerId) {
    return {
      touristAttractions: this.touristAttractionLayer,
      mrtStations: this.mrtStationLayer,
      mrtLines: this.mrtLineLayer
    }[layerId] || null;
  }

  buildDrawingAttributes(overrides = {}) {
    const attributes = {};
    this.drawingFields.forEach((field) => {
      attributes[field.name] = field.defaultValue ?? null;
    });
    return { ...attributes, ...overrides };
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
        styleGroups: touristAttractionSymbol ? [this.symbolToStyleGroup(touristAttractionSymbol, "Tourist Attractions")] : []
      },
      heat: { id: "heat", name: "Heatmap", visible: this.heatLayer?.visible },
      mrtStations: {
        id: "mrtStations",
        name: "MRT Stations",
        visible: this.mrtStationLayer?.visible,
        styleGroups: mrtStationSymbol ? [this.symbolToStyleGroup(mrtStationSymbol, "Stations")] : []
      },
      mrtLines: {
        id: "mrtLines",
        name: "MRT Lines",
        visible: this.mrtLineLayer?.visible,
        styleGroups: mrtLineSymbol ? [this.symbolToStyleGroup(mrtLineSymbol, "Lines")] : []
      },
      drawings: {
        id: "drawings",
        name: "Drawings",
        visible: this.drawLayer?.visible,
        styleGroups: drawingsGroups
      },
      searchResult: { id: "searchResult", name: "Search Result", visible: this.searchLayer?.visible }
    };

    // Portal-added layers have no fixed slot in `lookup` above since their
    // number and ids are dynamic (one per added portal item). They carry
    // `removable: true` so LayerControlPanel can offer a remove control that
    // the built-in layers don't get.
    this.portalLayers.forEach((layer, id) => {
      const meta = this.portalLayerMeta.get(id);
      lookup[id] = {
        id,
        name: meta?.title || "Portal Layer",
        visible: layer.visible,
        removable: true
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
  addPortalLayer(item) {
    if (!item?.url) throw new Error("This portal item has no queryable layer URL.");

    const layerId = `portal_${item.id}`;
    if (this.portalLayerMeta.has(layerId)) return layerId;

    const meta = { title: item.title || "Portal Layer", url: item.url, visible: true };
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
      default:
        break;
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
  // Stations, MRT Lines, and Drawings. Address geocoding is handled by
  // ApplicationShell (via GeocodingService) rather than here, consistent
  // with the existing rule that stateless services are called from the
  // shell, not from the engine.
  async searchFeatures(query) {
    const text = query?.trim();
    if (!text) return [];

    const hostedTargets = [
      { id: "touristAttractions", layer: this.touristAttractionLayer, title: "Tourist Attractions" },
      { id: "mrtStations", layer: this.mrtStationLayer, title: "MRT Stations" },
      { id: "mrtLines", layer: this.mrtLineLayer, title: "MRT Lines" }
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