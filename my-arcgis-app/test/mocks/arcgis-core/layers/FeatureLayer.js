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
  }
}

module.exports = FeatureLayer;
module.exports.default = FeatureLayer;
