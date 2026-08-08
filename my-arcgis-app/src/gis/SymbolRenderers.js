// Pure (ArcGIS-import-free) logic for building "advanced" ArcGIS renderers -
// Unique Values and Class Breaks (Graduated Colors/Sizes) - plus a richer
// per-symbol style vocabulary (marker shape, line dash style, fill pattern,
// size, opacity) and a two-layer "halo" CIM point symbol. Mirrors the role
// LayerFilterExpression.js plays for filters: kept side by side from
// GISMapEngine so the renderer-building logic is unit-testable without a map,
// and so hosted-layer and drawings-layer callers can't drift into building
// renderers that mean different things for the same inputs.
//
// See knowledge/index.md's Layer Styling System for the scope calls this
// module encodes: an engineering safety ceiling (not a visible truncation)
// on how many distinct values Unique Values will fetch/color, and a halo
// implemented as a fixed two-circle CIM composite rather than an arbitrary
// symbol-layer stack.

export const QUALITATIVE_PALETTE = [
  "#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231",
  "#911eb4", "#46f0f0", "#f032e6", "#bcf60c", "#fabebe",
  "#008080", "#e6beff"
];

export const MARKER_STYLES = [
  { value: "circle", label: "Circle" },
  { value: "square", label: "Square" },
  { value: "triangle", label: "Triangle" },
  { value: "diamond", label: "Diamond" },
  { value: "cross", label: "Cross" },
  { value: "x", label: "X" }
];

export const LINE_STYLES = [
  { value: "solid", label: "Solid" },
  { value: "dash", label: "Dash" },
  { value: "dot", label: "Dot" },
  { value: "dash-dot", label: "Dash-Dot" },
  { value: "long-dash", label: "Long Dash" }
];

export const FILL_STYLES = [
  { value: "solid", label: "Solid" },
  { value: "backward-diagonal", label: "Backward Diagonal" },
  { value: "forward-diagonal", label: "Forward Diagonal" },
  { value: "cross", label: "Cross" },
  { value: "diagonal-cross", label: "Diagonal Cross" },
  { value: "horizontal", label: "Horizontal" },
  { value: "vertical", label: "Vertical" },
  { value: "none", label: "None" }
];

// Ceiling on how many distinct values a Unique Values renderer will
// fetch/color, purely to stop an accidentally-picked, genuinely unbounded
// field (an OBJECTID, a free-text field, ...) from generating a runaway
// REST query and an unusably long legend. Every value up to this ceiling
// gets its own generated color (see paletteColor below) - it is not a
// "color the first N, hide the rest" cap. Set to 1000 (a typical hosted
// ArcGIS Online feature layer's own default maxRecordCount) so an ordinary
// dataset - including a several-hundred-feature layer with a near-unique
// field - is comfortably covered rather than silently truncated partway
// through. GISMapEngine.getDistinctValues fetches up to this same number,
// imported from here so the fetch and render limits can never drift apart
// the way they did in the bug this replaced (see buildUniqueValueRenderer's
// comment).
export const DEFAULT_UNIQUE_VALUE_LIMIT = 1000;

function hexToRgb(hex) {
  const clean = String(hex || "#000000").replace("#", "");
  const full = clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean;
  const num = Number.parseInt(full, 16) || 0;
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex([r, g, b]) {
  return `#${[r, g, b]
    .map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0"))
    .join("")}`;
}

// Standard HSL -> RGB conversion (CSS Color Module Level 4's own formula),
// returned as hex. h in degrees [0, 360), s/l as percentages [0, 100].
function hslToHex(h, s, l) {
  const sat = s / 100;
  const light = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return rgbToHex([255 * f(0), 255 * f(8), 255 * f(4)]);
}

// The golden angle (~137.5°) is the standard technique for generating any
// number of well-separated hues with no upper bound: stepping by it means
// consecutive indices land far apart around the color wheel instead of
// cycling through a short, exhaustible list. Used once a Unique Values
// legend needs more colors than QUALITATIVE_PALETTE's curated 12 - below
// that count, the curated palette is used as-is (it looks better than
// generated hues for the common low-cardinality case). Regression: an
// earlier version cycled `QUALITATIVE_PALETTE[i % 12]`, which read as
// "duplicate colors" the moment a field had more than 12 distinct values.
const GOLDEN_ANGLE = 137.508;

export function paletteColor(index) {
  if (index < QUALITATIVE_PALETTE.length) return QUALITATIVE_PALETTE[index];
  const hue = (index * GOLDEN_ANGLE) % 360;
  return hslToHex(hue, 65, 55);
}

// Linear RGB interpolation between two hex colors, t clamped to [0, 1].
export function interpolateColor(startHex, endHex, t) {
  const start = hexToRgb(startHex);
  const end = hexToRgb(endHex);
  const clampedT = Math.min(1, Math.max(0, t));
  return rgbToHex(start.map((c, i) => c + (end[i] - c) * clampedT));
}

// Applies opacity as the color's alpha channel, since that's how ArcGIS
// symbol colors represent transparency ([r, g, b, a], a in [0, 1]).
function colorWithOpacity(hex, opacity) {
  if (opacity == null) return hex;
  const [r, g, b] = hexToRgb(hex);
  return [r, g, b, Math.min(1, Math.max(0, opacity))];
}

// Superset of the simple color/borderWidth/outlineColor styling GISMapEngine
// previously applied inline: adds marker shape, line dash style, fill
// pattern, marker size, and opacity. `symbol` must be a live ArcGIS Symbol
// instance (it needs `.clone()`); this module never imports ArcGIS classes
// itself, it only duck-types symbols the same way the engine's original
// inline closure did.
export function applyExtendedSymbolStyle(symbol, changes = {}) {
  if (!symbol) return symbol;
  const { color, borderWidth, outlineColor, markerStyle, lineStyle, fillStyle, size, opacity } = changes;
  const next = symbol.clone();

  if (color) {
    next.color = opacity != null ? colorWithOpacity(color, opacity) : color;
  } else if (opacity != null && next.color) {
    let currentHex = "#000000";
    if (typeof next.color.toHex === "function") currentHex = next.color.toHex();
    else if (typeof next.color === "string") currentHex = next.color;
    next.color = colorWithOpacity(currentHex, opacity);
  }

  if (borderWidth != null) {
    if (next.type === "simple-line") next.width = borderWidth;
    else if (next.outline) next.outline.width = borderWidth;
  }

  if (outlineColor && next.type === "simple-fill" && next.outline) {
    next.outline.color = outlineColor;
  }

  if (markerStyle && next.type === "simple-marker") next.style = markerStyle;
  if (lineStyle && next.type === "simple-line") next.style = lineStyle;
  if (fillStyle && next.type === "simple-fill") next.style = fillStyle;

  // Marker size only - a line's thickness is already covered by
  // borderWidth/width above, so a separate "size" control isn't offered for
  // lines to avoid two controls disagreeing about the same property.
  if (size != null && next.type === "simple-marker") next.size = size;

  return next;
}

// Two-layer CIM point symbol: a larger filled circle (the halo) behind a
// smaller filled circle (the base marker's color). Deliberately always a
// plain circle on both layers regardless of the base marker's own `style`
// (triangle/square/etc.) - faithfully reproducing every marker shape as a
// CIM composite is out of scope (see module header / knowledge base).
export function buildHaloSymbol(baseColorHex, baseSize, { color = "#ffffff", size } = {}) {
  const innerSize = baseSize || 8;
  const haloSize = size ?? innerSize + 8;
  const haloRgba = [...hexToRgb(color), 255];
  const baseRgba = [...hexToRgb(baseColorHex || "#ff0000"), 255];

  const circleLayer = (rgba) => ({
    type: "CIMPolygonSymbol",
    symbolLayers: [{ type: "CIMSolidFill", enable: true, color: rgba }]
  });

  return {
    type: "CIMSymbolReference",
    symbol: {
      type: "CIMPointSymbol",
      symbolLayers: [
        {
          type: "CIMVectorMarker",
          enable: true,
          size: haloSize,
          frame: { xmin: -5, ymin: -5, xmax: 5, ymax: 5 },
          markerGraphics: [{ type: "CIMMarkerGraphic", geometry: { x: 0, y: 0 }, symbol: circleLayer(haloRgba) }]
        },
        {
          type: "CIMVectorMarker",
          enable: true,
          size: innerSize,
          frame: { xmin: -5, ymin: -5, xmax: 5, ymax: 5 },
          markerGraphics: [{ type: "CIMMarkerGraphic", geometry: { x: 0, y: 0 }, symbol: circleLayer(baseRgba) }]
        }
      ]
    }
  };
}

// Equal Interval classification: splits [min, max] into classCount
// equal-width buckets.
export function classifyEqualInterval(values, classCount) {
  const nums = (values || []).filter((v) => Number.isFinite(v));
  if (!nums.length) return [];

  const min = Math.min(...nums);
  const rawMax = Math.max(...nums);
  const max = rawMax === min ? min + 1 : rawMax; // degenerate single-value case: avoid a zero-width class
  const count = Math.max(1, classCount);
  const step = (max - min) / count;

  return Array.from({ length: count }, (_, i) => ({
    minValue: i === 0 ? min : min + step * i,
    maxValue: i === count - 1 ? rawMax : min + step * (i + 1)
  }));
}

// Quantile classification: each bucket gets (approximately) the same number
// of observations, rather than the same value range.
export function classifyQuantile(values, classCount) {
  const nums = (values || []).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return [];

  const count = Math.max(1, Math.min(classCount, nums.length));
  const breaks = [];
  for (let i = 0; i < count; i++) {
    const startIdx = Math.floor((i * nums.length) / count);
    const endIdx = i === count - 1 ? nums.length - 1 : Math.floor(((i + 1) * nums.length) / count) - 1;
    breaks.push({ minValue: nums[startIdx], maxValue: nums[Math.max(endIdx, startIdx)] });
  }
  return breaks;
}

function formatBreakNumber(n) {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : n;
}

// Builds an ArcGIS "unique-value" renderer (JSON, suitable for assigning to
// a FeatureLayer's `renderer` or for evaluating client-side against a
// drawings graphic's own attributes) plus a `legend` array the UI can render
// directly. Every value passed in gets its own generated color (paletteColor)
// - no truncation happens here, and there is deliberately no grey
// "everything else" catch-all bucket. How many values actually reach this
// function is decided upstream, by GISMapEngine.getDistinctValues's own
// fetch ceiling (DEFAULT_UNIQUE_VALUE_LIMIT) - keeping that decision out of
// this pure function means it can't silently disagree with what was actually
// fetched. A value that exists on the live service but wasn't in the fetched
// sample (only realistic once a field's true cardinality exceeds that fetch
// ceiling) still renders with no symbol - i.e. invisible; picking a
// genuinely low-cardinality field for Unique Values (the ArcGIS Pro-correct
// usage) avoids that in practice.
export function buildUniqueValueRenderer(field, distinctValues, baseSymbol) {
  const legend = [];

  const uniqueValueInfos = (distinctValues || []).map((value, i) => {
    const color = paletteColor(i);
    legend.push({ key: String(value), label: String(value), color });
    return {
      value: String(value),
      label: String(value),
      symbol: applyExtendedSymbolStyle(baseSymbol, { color })
    };
  });

  return { renderer: { type: "unique-value", field, uniqueValueInfos }, legend };
}

// Builds an ArcGIS "class-breaks" renderer plus a `legend` array. `rampMode`
// "color" interpolates between startColor/endColor across the breaks;
// "size" interpolates marker size (or line width, via the same `size`
// property) between minSize/maxSize instead, leaving color untouched.
export function buildClassBreaksRenderer(field, values, options = {}) {
  const {
    classCount = 5,
    method = "equal-interval",
    rampMode = "color",
    startColor = "#fee5d9",
    endColor = "#a50f15",
    minSize = 6,
    maxSize = 24,
    baseSymbol
  } = options;

  const breaks = method === "quantile"
    ? classifyQuantile(values, classCount)
    : classifyEqualInterval(values, classCount);

  const legend = [];
  const classBreakInfos = breaks.map((brk, i) => {
    const t = breaks.length > 1 ? i / (breaks.length - 1) : 0;
    const changes = rampMode === "size"
      ? { size: minSize + (maxSize - minSize) * t }
      : { color: interpolateColor(startColor, endColor, t) };

    const label = `${formatBreakNumber(brk.minValue)} – ${formatBreakNumber(brk.maxValue)}`;
    const baseColorHex = typeof baseSymbol?.color?.toHex === "function" ? baseSymbol.color.toHex() : startColor;

    legend.push({
      key: i,
      label,
      color: rampMode === "size" ? baseColorHex : changes.color,
      size: rampMode === "size" ? changes.size : undefined
    });

    return {
      minValue: brk.minValue,
      maxValue: brk.maxValue,
      label,
      symbol: applyExtendedSymbolStyle(baseSymbol, changes)
    };
  });

  return { renderer: { type: "class-breaks", field, classBreakInfos }, legend };
}

// Strips a stored renderer descriptor (which also carries our own `legend`/
// `symbolType` bookkeeping - see GISMapEngine's layerRenderers field) down to
// the plain shape ArcGIS's Renderer autocasting expects, for assigning
// directly to a FeatureLayer's `renderer` property.
export function toArcGISRenderer(descriptor) {
  if (!descriptor) return descriptor;
  if (descriptor.type === "unique-value") {
    const { type, field, uniqueValueInfos, defaultSymbol, defaultLabel } = descriptor;
    return { type, field, uniqueValueInfos, ...(defaultSymbol ? { defaultSymbol, defaultLabel } : {}) };
  }
  if (descriptor.type === "class-breaks") {
    const { type, field, classBreakInfos } = descriptor;
    return { type, field, classBreakInfos };
  }
  return descriptor;
}
