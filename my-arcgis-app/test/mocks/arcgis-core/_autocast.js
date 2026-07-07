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
  const next = { ...renderer };
  if (next.symbol) next.symbol = makeSymbol(next.symbol);
  if (next.colorStops) next.colorStops = next.colorStops.map((s) => ({ ...s }));
  next.clone = () => makeRenderer(next);
  return next;
}

module.exports = { makeSymbol, makeRenderer };
