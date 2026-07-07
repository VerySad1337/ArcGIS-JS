import FeatureLayer from "@arcgis/core/layers/FeatureLayer";
import { createHeatmapLayer } from "./heatmapLayer";

describe("createHeatmapLayer", () => {
  test("builds a FeatureLayer with the given url and a heatmap renderer", () => {
    const layer = createHeatmapLayer("https://example.com/FeatureServer");

    expect(layer).toBeInstanceOf(FeatureLayer);
    expect(layer.url).toBe("https://example.com/FeatureServer");
    expect(layer.outFields).toEqual(["*"]);
    expect(layer.renderer.type).toBe("heatmap");
    expect(layer.renderer.maxPixelIntensity).toBe(50);
    expect(layer.renderer.minPixelIntensity).toBe(0);
    expect(layer.renderer.colorStops).toHaveLength(5);
  });
});
