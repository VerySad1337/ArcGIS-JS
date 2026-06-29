import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";

export default class GISMapEngine {
constructor() {
this.routeLayer = new GraphicsLayer();
this.stopLayer = new GraphicsLayer();
this.heatLayer = null;
}

attachToView(view) {
if (!view) return;

if (!view.map.layers.includes(this.routeLayer)) {
  view.map.add(this.routeLayer);
}

if (!view.map.layers.includes(this.stopLayer)) {
  view.map.add(this.stopLayer);
}

}

drawRoute(routeGeometry) {
this.routeLayer.removeAll();

this.routeLayer.add(
  new Graphic({
    geometry: routeGeometry,
    symbol: {
      type: "simple-line",
      color: [255, 0, 0],
      width: 6
    }
  })
);

}

drawStops(start, end) {
this.stopLayer.removeAll();

this.stopLayer.add(
  new Graphic({
    geometry: start,
    symbol: {
      type: "simple-marker",
      color: "green",
      size: 10
    }
  })
);

this.stopLayer.add(
  new Graphic({
    geometry: end,
    symbol: {
      type: "simple-marker",
      color: "red",
      size: 10
    }
  })
);

}

toggleRoute(visible) {
this.routeLayer.visible = visible;
this.stopLayer.visible = visible;
}

enableHeatmap(view, intensity) {
  this.heatIntensity = intensity;

  if (this.heatLayer) {
    this.heatLayer.visible = true;

    const renderer = this.heatLayer.renderer.clone();
    renderer.maxPixelIntensity = intensity;
    this.heatLayer.renderer = renderer;

    return;
  }

  this.heatLayer = new FeatureLayer({
    url: "https://services2.arcgis.com/j80Jz20at6Bi0thr/arcgis/rest/services/Tourist_Attractions/FeatureServer",
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
      maxPixelIntensity: intensity,
      minPixelIntensity: 1
    }
  });

  view.map.add(this.heatLayer);
}
disableHeatmap() {
  if (!this.heatLayer) return;

  this.heatLayer.visible = false;
}

updateHeatmapIntensity(value) {
  this.heatIntensity = value;

  if (!this.heatLayer) return;

  const renderer = this.heatLayer.renderer.clone();

  renderer.maxPixelIntensity = value;

  this.heatLayer.renderer = renderer;
}
}