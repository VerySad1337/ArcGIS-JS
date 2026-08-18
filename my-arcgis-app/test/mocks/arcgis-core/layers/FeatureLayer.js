const { makeRenderer } = require("../_autocast");

class FeatureLayer {
  constructor(props = {}) {
    this.url = props.url;
    this.title = props.title;
    this.visible = props.visible ?? true;
    this.opacity = props.opacity ?? 1;
    this.outFields = props.outFields;
    this.objectIdField = props.objectIdField ?? "OBJECTID";
    this.layerId = props.layerId ?? 0;
    this.renderer = makeRenderer(props.renderer);
    this.applyEdits = jest.fn().mockResolvedValue({ updateFeatureResults: [{}] });
    this.refresh = jest.fn().mockResolvedValue(undefined);
    this.fullExtent = props.fullExtent ?? { xmin: 0, ymin: 0, xmax: 1, ymax: 1 };
    this.load = jest.fn().mockResolvedValue(undefined);
    this.fields = props.fields ?? [];
    this.definitionExpression = props.definitionExpression ?? null;
    this.queryFeatures = jest.fn().mockResolvedValue({ features: [] });
    this.queryFeatureCount = jest.fn().mockResolvedValue(0);
    // Unlike fullExtent, a real queryExtent honours definitionExpression -
    // which is the whole reason zoomToLayer consults it for a filtered layer
    // (see GISMapEngine.zoomToLayer). Defaults to "one feature, degenerate
    // extent" so the single-feature framing path is what a test exercising a
    // filtered zoom gets unless it says otherwise.
    this.queryExtent = jest
      .fn()
      .mockResolvedValue({ count: 1, extent: { xmin: 5, ymin: 5, xmax: 5, ymax: 5, center: { x: 5, y: 5 } } });
  }
}

module.exports = FeatureLayer;
module.exports.default = FeatureLayer;
