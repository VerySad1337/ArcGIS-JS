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

  routeGraphic = null;
  startGraphic = null;
  endGraphic = null;

  routeVisible = true;
  heatVisible = false;
  heatIntensity = 50;

  layerOrder = [
    "route",
    "stops",
    "touristAttractions",
    "heat",
    "mrtStations",
    "mrtLines",
    "drawings"
  ];

  touristAttractionLayer = null;
  mrtStationLayer = null;
  mrtLineLayer = null;

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

    const layerMap = {
      route: this.routeLayer,
      stops: this.stopLayer,
      touristAttractions: this.touristAttractionLayer,
      heat: this.heatLayer,
      mrtStations: this.mrtStationLayer,
      mrtLines: this.mrtLineLayer,
      drawings: this.drawLayer
    };

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
      }
    };

    return l.map((id) => lookup[id]);
  }

  toggleLayer(id) {
    const map = {
      route: this.routeLayer,
      stops: this.stopLayer,
      touristAttractions: this.touristAttractionLayer,
      heat: this.heatLayer,
      mrtStations: this.mrtStationLayer,
      mrtLines: this.mrtLineLayer,
      drawings: this.drawLayer
    };

    const layer = map[id];
    if (layer) layer.visible = !layer.visible;
  }

  // Zooms/pans the current view to the extent of one layer's content, so a
  // user can jump to e.g. just their drawings or just the MRT lines instead
  // of hunting for them at the current zoom level.
  async zoomToLayer(id, msg) {
    if (!this.currentView) return;

    const map = {
      route: this.routeLayer,
      stops: this.stopLayer,
      touristAttractions: this.touristAttractionLayer,
      heat: this.heatLayer,
      mrtStations: this.mrtStationLayer,
      mrtLines: this.mrtLineLayer,
      drawings: this.drawLayer
    };

    const layer = map[id];
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
        mrtLines: "mrtLineVisible"
      }[id];
      if (visibilityField) this[visibilityField] = true;
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

    const map = {
      route: this.routeLayer,
      stops: this.stopLayer,
      heat: this.heatLayer,
      touristAttractions: this.touristAttractionLayer,
      mrtStations: this.mrtStationLayer,
      mrtLines: this.mrtLineLayer,
      drawings: this.drawLayer
    };

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