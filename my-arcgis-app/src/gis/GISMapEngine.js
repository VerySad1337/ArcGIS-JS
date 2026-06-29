import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import {HEATMAP_FEATURE_LAYER_URL} from "../config/ArcGISConfiguration.js";

export default class GISMapEngine {
constructor() {
this.routeLayer = null;
this.stopLayer = null;

this.routeGraphic = null;
this.startGraphic = null;
this.endGraphic = null;

this.heatLayer = null;

this.currentMap = null;

this.heatIntensity = 50;

}

attachToView(view) {
if (!view) return;

const map = view.map;

if (this.currentMap === map) {
  return;
}

this.currentMap = map;

this.routeLayer = new GraphicsLayer({
  title: "Route Layer"
});

this.stopLayer = new GraphicsLayer({
  title: "Stop Layer"
});

if (this.routeGraphic) {
  this.routeLayer.add(
    this.routeGraphic
  );
}

if (this.startGraphic) {
  this.stopLayer.add(
    this.startGraphic
  );
}

if (this.endGraphic) {
  this.stopLayer.add(
    this.endGraphic
  );
}

map.add(this.routeLayer);
map.add(this.stopLayer);

if (
  this.heatLayer &&
  !map.layers.includes(
    this.heatLayer
  )
) {
  map.add(this.heatLayer);
}

}

drawRoute(routeGeometry) {
this.routeGraphic =
new Graphic({
geometry: routeGeometry,
symbol: {
type: "simple-line",
color: [255, 0, 0],
width: 6
}
});

if (!this.routeLayer) {
  return;
}

this.routeLayer.removeAll();

this.routeLayer.add(
  this.routeGraphic
);

}

drawStops(start, end) {
this.startGraphic =
new Graphic({
geometry: start,
symbol: {
type: "simple-marker",
color: "green",
size: 10
}
});

this.endGraphic =
  new Graphic({
    geometry: end,
    symbol: {
      type: "simple-marker",
      color: "red",
      size: 10
    }
  });

if (!this.stopLayer) {
  return;
}

this.stopLayer.removeAll();

this.stopLayer.addMany([
  this.startGraphic,
  this.endGraphic
]);

}

toggleRoute(visible) {
if (this.routeLayer) {
this.routeLayer.visible =
visible;
}

if (this.stopLayer) {
  this.stopLayer.visible =
    visible;
}

}

enableHeatmap(
view,
intensity
) {
this.heatIntensity =
intensity;

if (this.heatLayer) {
  this.heatLayer.visible =
    true;

  const renderer =
    this.heatLayer.renderer.clone();

  renderer.maxPixelIntensity =
    intensity;

  this.heatLayer.renderer =
    renderer;

  return;
}

this.heatLayer =
  new FeatureLayer({
    url:
      HEATMAP_FEATURE_LAYER_URL,

    opacity: 0.8,

    renderer: {
      type: "heatmap",

      radius: 25,

      colorStops: [
        {
          ratio: 0,
          color:
            "rgba(0,0,255,0)"
        },
        {
          ratio: 0.2,
          color: "blue"
        },
        {
          ratio: 0.4,
          color: "cyan"
        },
        {
          ratio: 0.6,
          color: "lime"
        },
        {
          ratio: 0.8,
          color: "yellow"
        },
        {
          ratio: 1,
          color: "red"
        }
      ],

      maxPixelIntensity:
        intensity,

      minPixelIntensity: 1
    }
  });

view.map.add(
  this.heatLayer
);

}

disableHeatmap() {
if (!this.heatLayer) {
return;
}

this.heatLayer.visible =
  false;

}

updateHeatmapIntensity(
value
) {
this.heatIntensity =
value;

if (!this.heatLayer) {
  return;
}

const renderer =
  this.heatLayer.renderer.clone();

renderer.maxPixelIntensity =
  value;

this.heatLayer.renderer =
  renderer;

}
}