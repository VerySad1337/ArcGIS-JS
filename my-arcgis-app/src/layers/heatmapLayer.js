import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import HeatmapRenderer from "@arcgis/core/renderers/HeatmapRenderer";

export function createHeatmapLayer(url) {
  // maxPixelIntensity/minPixelIntensity have to be assigned as properties on a
  // real HeatmapRenderer, not passed as constructor/autocast properties, or
  // the SDK drops them and renders an auto-calculated density instead. See
  // GISMapEngine's toLiveRenderer, which is the live app's version of this.
  const renderer = new HeatmapRenderer({
    colorStops: [
      { ratio: 0, color: "rgba(0,0,255,0)" },
      { ratio: 0.3, color: "blue" },
      { ratio: 0.5, color: "cyan" },
      { ratio: 0.7, color: "yellow" },
      { ratio: 1, color: "red" }
    ]
  });
  renderer.maxPixelIntensity = 50;
  renderer.minPixelIntensity = 0;

  return new FeatureLayer({ url, outFields: ["*"], renderer });
}