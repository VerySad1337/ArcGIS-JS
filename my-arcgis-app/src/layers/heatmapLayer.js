import FeatureLayer from "@arcgis/core/layers/FeatureLayer";

export function createHeatmapLayer(url) {
  return new FeatureLayer({
    url,
    outFields: ["*"],

    renderer: {
      type: "heatmap",
      colorStops: [
        { ratio: 0, color: "rgba(0,0,255,0)" },
        { ratio: 0.3, color: "blue" },
        { ratio: 0.5, color: "cyan" },
        { ratio: 0.7, color: "yellow" },
        { ratio: 1, color: "red" }
      ],
      maxPixelIntensity: 50,
      minPixelIntensity: 0
    }
  });
}