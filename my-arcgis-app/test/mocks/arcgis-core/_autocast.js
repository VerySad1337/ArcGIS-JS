// Lightweight stand-ins for ArcGIS's autocast behavior: constructing a layer
// or graphic with a plain-object `symbol`/`renderer` normally produces a real
// Symbol/Renderer instance with a `.clone()` method. GISMapEngine relies on
// `.clone()` being present (see setLayerStyle/enableHeatmap), so these mocks
// replicate just that shape.
function makeSymbol(symbol) {
  if (!symbol) return symbol;
  const next = { ...symbol };
  if (next.outline) next.outline = { ...next.outline };
  next.clone = () => makeSymbol(next);
  return next;
}

function makeRenderer(renderer) {
  if (!renderer) return renderer;
  // Autocast only ever converts PLAIN objects. An already-constructed renderer
  // instance (e.g. the HeatmapRenderer GISMapEngine's toLiveRenderer builds) is
  // passed through untouched by the real SDK, so it must be here too - not
  // re-spread into a plain object, which would strip the very properties that
  // only survive on a real instance.
  if (Object.getPrototypeOf(renderer) !== Object.prototype) return renderer;
  const next = { ...renderer };
  if (next.symbol) next.symbol = makeSymbol(next.symbol);
  if (next.colorStops) next.colorStops = next.colorStops.map((s) => ({ ...s }));
  // Autocasting a plain-object HEATMAP renderer drops maxPixelIntensity/
  // minPixelIntensity on the real SDK - they are deprecated aliases over
  // maxDensity/minDensity that only take effect as post-construction property
  // assignments, so the layer silently keeps an auto-calculated density
  // instead (see GISMapEngine's toLiveRenderer). Modelled here so a heatmap
  // handed to ArcGIS as plain JSON fails the tests that assert an intensity
  // reached the layer, rather than passing here and regressing in a browser.
  if (next.type === "heatmap") {
    next.maxPixelIntensity = undefined;
    next.minPixelIntensity = undefined;
  }
  next.clone = () => makeRenderer(next);
  return next;
}

module.exports = { makeSymbol, makeRenderer };
