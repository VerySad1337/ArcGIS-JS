import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import { HEATMAP_FEATURE_LAYER_URL } from "../config/ArcGISConfiguration";

export default class GISMapEngine {
  constructor() {
    this.currentMap = null;
    this.routeLayer = null;
    this.stopLayer = null;
    this.heatLayer = null;
    this.routeGraphic = null;
    this.startGraphic = null;
    this.endGraphic = null;
    this.routeVisible = true;
    this.heatVisible = false;
    this.heatIntensity = 50;
    this.layerOrder = ["route", "stops", "heat"];
  }

  attachToView(view) {
    if (!view) return;
    const map = view.map;
    this.currentMap = map;
    map.removeAll();
    this.routeLayer = new GraphicsLayer({
      title: "Route Layer",
      visible: this.routeVisible
    });

    this.stopLayer = new GraphicsLayer({
      title: "Stop Layer",
      visible: this.routeVisible
    });

    if (this.routeGraphic) this.routeLayer.add(this.routeGraphic);
    if (this.startGraphic) this.stopLayer.add(this.startGraphic);
    if (this.endGraphic) this.stopLayer.add(this.endGraphic);

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

    const layerMap = {
      route: this.routeLayer,
      stops: this.stopLayer,
      heat: this.heatLayer
    };

    this.layerOrder.forEach((id) => {
      const layer = layerMap[id];
      if (layer) map.add(layer);
    });
  }

  drawRoute(routeGeometry) {
    this.routeGraphic = new Graphic({
      geometry: routeGeometry,
      symbol: {
        type: "simple-line",
        color: [0, 0, 0],
        width: 10
      }
    });

    if (!this.routeLayer) return;
    this.routeLayer.removeAll();
    this.routeLayer.add(this.routeGraphic);
  }

  drawStops(start, end) {
    this.startGraphic = new Graphic({
      geometry: start,
      symbol: {
        type: "simple-marker",
        color: "green",
        size: 10
      }
    });

    this.endGraphic = new Graphic({
      geometry: end,
      symbol: {
        type: "simple-marker",
        color: "red",
        size: 10
      }
    });

    if (!this.stopLayer) return;
    this.stopLayer.removeAll();
    this.stopLayer.addMany([this.startGraphic, this.endGraphic]);
  }

  toggleRoute(visible) {
    this.routeVisible = visible;

    if (this.routeLayer) this.routeLayer.visible = visible;
    if (this.stopLayer) this.stopLayer.visible = visible;
  }

  enableHeatmap(view, intensity) {
    this.heatVisible = true;
    this.heatIntensity = intensity;

    if (!this.heatLayer) return;

    this.heatLayer.visible = true;

    const renderer = this.heatLayer.renderer.clone();
    renderer.maxPixelIntensity = intensity;
    this.heatLayer.renderer = renderer;
  }

  disableHeatmap() {
    this.heatVisible = false;

    if (this.heatLayer) this.heatLayer.visible = false;
  }

  updateHeatmapIntensity(value) {
    this.heatIntensity = value;

    if (!this.heatLayer) return;

    const renderer = this.heatLayer.renderer.clone();
    renderer.maxPixelIntensity = value;
    this.heatLayer.renderer = renderer;
  }

  getLayers() {
    const lookup = {
      route: {
        id: "route",
        name: "Route Layer",
        visible: this.routeLayer?.visible ?? true
      },
      stops: {
        id: "stops",
        name: "Stop Layer",
        visible: this.stopLayer?.visible ?? true
      },
      heat: {
        id: "heat",
        name: "Heat Layer",
        visible: this.heatLayer?.visible ?? false
      }
    };

    return this.layerOrder.map((id) => lookup[id]);
  }

  toggleLayer(id) {
    const layerMap = {
      route: this.routeLayer,
      stops: this.stopLayer,
      heat: this.heatLayer
    };

    const layer = layerMap[id];
    if (layer) layer.visible = !layer.visible;
  }

  reorderLayers(fromIndex, toIndex) {
    const order = [...this.layerOrder];

    const moved = order.splice(fromIndex, 1)[0];
    order.splice(toIndex, 0, moved);

    this.layerOrder = order;

    if (!this.currentMap) return;

    const layerMap = {
      route: this.routeLayer,
      stops: this.stopLayer,
      heat: this.heatLayer
    };

    order.forEach((id, index) => {
      const layer = layerMap[id];
      if (layer) this.currentMap.reorder(layer, index);
    });
  }
}