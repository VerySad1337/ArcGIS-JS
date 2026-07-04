import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import {
  HEATMAP_FEATURE_LAYER_URL,
  MRT_STATION_FEATURE_LAYER_URL,
  MRT_LINE_FEATURE_LAYER_URL
} from "../config/ArcGISConfiguration";
import SketchViewModel from "@arcgis/core/widgets/Sketch/SketchViewModel";

export default class GISMapEngine {
  constructor() {
    this.currentMap = null;
    this.currentView = null;

    this.routeLayer = null;
    this.stopLayer = null;
    this.heatLayer = null;

    this.routeGraphic = null;
    this.startGraphic = null;
    this.endGraphic = null;

    this.routeVisible = true;
    this.heatVisible = false;
    this.heatIntensity = 50;

    this.layerOrder = [
      "route",
      "stops",
      "touristAttractions",
      "heat",
      "mrtStations",
      "mrtLines",
      "drawings"
    ];

    this.touristAttractionLayer = null;
    this.mrtStationLayer = null;
    this.mrtLineLayer = null;

    this.touristAttractionVisible = true;
    this.mrtStationVisible = true;
    this.mrtLineVisible = true;

    this.drawLayer = new GraphicsLayer({ title: "Drawings" });
    this.sketchVM = null;

    this.uploadedLayers = [];
  }

  attachToView(view) {
    if (!view) return;

    const map = view.map;
    const existingDrawings = this.drawLayer.graphics.toArray();

    this.currentMap = map;
    this.currentView = view;

    map.removeAll();

    this.routeLayer = new GraphicsLayer({ title: "Route Layer", visible: this.routeVisible });
    this.stopLayer  = new GraphicsLayer({ title: "Stop Layer",  visible: this.routeVisible });

    this.touristAttractionLayer = new FeatureLayer({
      url: HEATMAP_FEATURE_LAYER_URL,
      title: "Tourist Attractions",
      visible: this.touristAttractionVisible
    });

    this.mrtStationLayer = new FeatureLayer({
      url: MRT_STATION_FEATURE_LAYER_URL,
      title: "MRT Stations",
      visible: this.mrtStationVisible,
      renderer: {
        type: "simple",
        symbol: {
          type: "simple-fill",
          color: [0, 120, 255, 0.5],
          outline: { color: [0, 0, 0], width: 1.5 }
        }
      }
    });

    this.mrtLineLayer = new FeatureLayer({
      url: MRT_LINE_FEATURE_LAYER_URL,
      title: "MRT Lines",
      visible: this.mrtLineVisible,
      renderer: {
        type: "simple",
        symbol: { type: "simple-line", color: [0, 0, 0], width: 1 }
      }
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

    this.sketchVM = new SketchViewModel({
      view,
      layer: this.drawLayer
    });

    if (this.routeGraphic) this.routeLayer.add(this.routeGraphic);
    if (this.startGraphic) this.stopLayer.add(this.startGraphic);
    if (this.endGraphic) this.stopLayer.add(this.endGraphic);

    if (existingDrawings.length) {
      this.drawLayer.removeAll();
      this.drawLayer.addMany(existingDrawings);
    }

    this.drawLayer.elevationInfo = { mode: "on-the-ground" };

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
    this.startGraphic = new Graphic({
      geometry: start,
      symbol: { type: "simple-marker", color: "green", size: 10 }
    });

    this.endGraphic = new Graphic({
      geometry: end,
      symbol: { type: "simple-marker", color: "red", size: 10 }
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

  getLayers() {
    const l = this.layerOrder;

    const lookup = {
      route: { id: "route", name: "Route Layer", visible: this.routeLayer?.visible },
      stops: { id: "stops", name: "Stop Layer", visible: this.stopLayer?.visible },
      touristAttractions: { id: "touristAttractions", name: "Tourist Attractions", visible: this.touristAttractionLayer?.visible },
      heat: { id: "heat", name: "Heatmap", visible: this.heatLayer?.visible },
      mrtStations: { id: "mrtStations", name: "MRT Stations", visible: this.mrtStationLayer?.visible },
      mrtLines: { id: "mrtLines", name: "MRT Lines", visible: this.mrtLineLayer?.visible },
      drawings: { id: "drawings", name: "Drawings", visible: this.drawLayer?.visible }
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

  startPointDraw() { this.sketchVM?.create("point"); }
  startLineDraw()  { this.sketchVM?.create("polyline"); }
  startPolygonDraw(){ this.sketchVM?.create("polygon"); }

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
    if (!f.length) return msg?.("Please draw something, before saving");

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
    msg?.("GeoJSON downloaded");
  }

  async uploadGeoJSON(file, msg) {
  if (!file || !this.currentMap || !this.currentView) return;

  try {
    // 🚨 BLOCK UPLOAD IF UNSAVED DRAWINGS EXIST
    if (this.drawLayer?.graphics?.length > 0) {
      msg?.("Please save current drawings before uploading new file.");
      return;
    }

    const geojson = JSON.parse(await file.text());

    const graphics = geojson.features.map(f => {
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

      return new Graphic({
        geometry,
        symbol: {
          type:
            g.type === "Point"
              ? "simple-marker"
              : g.type === "LineString"
              ? "simple-line"
              : "simple-fill",

          color:
            g.type === "Point"
              ? "red"
              : g.type === "LineString"
              ? "blue"
              : [0, 120, 255, 0.3],

          size: g.type === "Point" ? 8 : undefined,
          width: g.type === "LineString" ? 2 : undefined
        }
      });
    });

    // 🔥 IMPORTANT FIX: bind to YOUR draw layer
    this.drawLayer.addMany(graphics);

    this.uploadedLayers.push({
      id: `upload_${Date.now()}`,
      name: file.name,
      layer: this.drawLayer
    });

    await this.currentView.goTo(this.drawLayer);

  } catch (err) {
    console.error("Upload failed:", err);
  }
}
}