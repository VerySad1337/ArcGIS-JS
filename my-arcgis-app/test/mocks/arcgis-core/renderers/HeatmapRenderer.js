// Stand-in for @arcgis/core/renderers/HeatmapRenderer.
//
// The real class stores its thresholds as maxDensity/minDensity and exposes
// maxPixelIntensity/minPixelIntensity as deprecated aliases honoured ONLY as
// post-construction property assignments - supplying them as constructor
// properties silently drops them and leaves the layer on an auto-calculated
// density (see GISMapEngine's toLiveRenderer for the full explanation).
//
// This mock reproduces that asymmetry deliberately rather than accepting the
// values either way: the constructor ignores them, plain assignment works. Any
// future code that goes back to passing them in as props therefore fails the
// tests that assert an intensity reached the layer, instead of passing here
// and regressing only in a real browser.
const { makeRenderer } = require("../_autocast");

class HeatmapRenderer {
  type = "heatmap";

  constructor(props = {}) {
    this.radius = props.radius;
    this.colorStops = (props.colorStops || []).map((s) => ({ ...s }));
    this.maxPixelIntensity = undefined;
    this.minPixelIntensity = undefined;
  }

  clone() {
    return makeRenderer({
      type: this.type,
      radius: this.radius,
      colorStops: this.colorStops,
      maxPixelIntensity: this.maxPixelIntensity,
      minPixelIntensity: this.minPixelIntensity
    });
  }
}

module.exports = HeatmapRenderer;
module.exports.default = HeatmapRenderer;
