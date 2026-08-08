import {
  interpolateColor,
  applyExtendedSymbolStyle,
  buildHaloSymbol,
  classifyEqualInterval,
  classifyQuantile,
  buildUniqueValueRenderer,
  buildClassBreaksRenderer,
  toArcGISRenderer,
  paletteColor,
  QUALITATIVE_PALETTE
} from "./SymbolRenderers";

// Minimal clonable symbol stand-in, mirroring the shape
// test/mocks/arcgis-core/_autocast.js gives GISMapEngine's own tests.
function makeSymbol(props) {
  const symbol = { ...props };
  symbol.clone = () => makeSymbol(symbol);
  return symbol;
}

describe("interpolateColor", () => {
  test("returns the start color at t=0 and end color at t=1", () => {
    expect(interpolateColor("#000000", "#ffffff", 0)).toBe("#000000");
    expect(interpolateColor("#000000", "#ffffff", 1)).toBe("#ffffff");
  });

  test("clamps t outside [0, 1]", () => {
    expect(interpolateColor("#000000", "#ffffff", -1)).toBe("#000000");
    expect(interpolateColor("#000000", "#ffffff", 2)).toBe("#ffffff");
  });

  test("interpolates midpoint", () => {
    expect(interpolateColor("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
});

describe("applyExtendedSymbolStyle", () => {
  test("returns the input unchanged when no symbol is given", () => {
    expect(applyExtendedSymbolStyle(null, { color: "#fff" })).toBeNull();
  });

  test("applies color, borderWidth, and outlineColor for a simple-fill symbol", () => {
    const symbol = makeSymbol({ type: "simple-fill", color: "#000", outline: { color: "#000", width: 1 } });
    const next = applyExtendedSymbolStyle(symbol, { color: "#123456", outlineColor: "#654321", borderWidth: 3 });
    expect(next.color).toBe("#123456");
    expect(next.outline.color).toBe("#654321");
    expect(next.outline.width).toBe(3);
  });

  test("applies width (not outline) for a simple-line symbol", () => {
    const symbol = makeSymbol({ type: "simple-line", color: "#000", width: 1 });
    const next = applyExtendedSymbolStyle(symbol, { borderWidth: 5, lineStyle: "dash" });
    expect(next.width).toBe(5);
    expect(next.style).toBe("dash");
  });

  test("applies shape and size for a simple-marker symbol", () => {
    const symbol = makeSymbol({ type: "simple-marker", color: "#000", size: 8 });
    const next = applyExtendedSymbolStyle(symbol, { markerStyle: "square", size: 14 });
    expect(next.style).toBe("square");
    expect(next.size).toBe(14);
  });

  test("does not apply size to a line symbol (borderWidth already covers thickness)", () => {
    const symbol = makeSymbol({ type: "simple-line", color: "#000", width: 1 });
    const next = applyExtendedSymbolStyle(symbol, { size: 20 });
    expect(next.width).toBe(1);
  });

  test("applies opacity as the color's alpha channel", () => {
    const symbol = makeSymbol({ type: "simple-marker", color: "#ff0000" });
    const next = applyExtendedSymbolStyle(symbol, { opacity: 0.5 });
    expect(next.color).toEqual([255, 0, 0, 0.5]);
  });

  test("combines a new color with opacity in one call", () => {
    const symbol = makeSymbol({ type: "simple-marker", color: "#000000" });
    const next = applyExtendedSymbolStyle(symbol, { color: "#00ff00", opacity: 0.25 });
    expect(next.color).toEqual([0, 255, 0, 0.25]);
  });
});

describe("classifyEqualInterval", () => {
  test("splits into equal-width buckets", () => {
    const breaks = classifyEqualInterval([0, 10, 20, 30, 40, 50], 5);
    expect(breaks).toHaveLength(5);
    expect(breaks[0].minValue).toBe(0);
    expect(breaks.at(-1).maxValue).toBe(50);
  });

  test("returns an empty array for no finite values", () => {
    expect(classifyEqualInterval([], 5)).toEqual([]);
  });

  test("does not produce a zero-width class when every value is identical", () => {
    const breaks = classifyEqualInterval([7, 7, 7], 3);
    expect(breaks).toHaveLength(3);
    expect(breaks.every((b) => Number.isFinite(b.minValue) && Number.isFinite(b.maxValue))).toBe(true);
  });
});

describe("classifyQuantile", () => {
  test("splits into buckets with roughly equal counts", () => {
    const breaks = classifyQuantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
    expect(breaks).toHaveLength(5);
    expect(breaks[0].minValue).toBe(1);
    expect(breaks.at(-1).maxValue).toBe(10);
  });

  test("caps class count at the number of available values", () => {
    expect(classifyQuantile([1, 2], 5)).toHaveLength(2);
  });
});

describe("buildUniqueValueRenderer", () => {
  const baseSymbol = makeSymbol({ type: "simple-marker", color: "#000000", size: 8 });

  test("assigns one palette color per distinct value, with no grey 'Other' catch-all", () => {
    const { renderer, legend } = buildUniqueValueRenderer("CATEGORY", ["A", "B", "C"], baseSymbol);
    expect(renderer.type).toBe("unique-value");
    expect(renderer.field).toBe("CATEGORY");
    expect(renderer.uniqueValueInfos).toHaveLength(3);
    expect(renderer.uniqueValueInfos.map((i) => i.value)).toEqual(["A", "B", "C"]);
    expect(legend).toHaveLength(3);
    expect(legend[0].color).toBe(QUALITATIVE_PALETTE[0]);
    expect(renderer.defaultSymbol).toBeUndefined();
  });

  test("keeps generating distinct colors past the curated palette's own length, with no repeats", () => {
    const values = Array.from({ length: 40 }, (_, i) => `V${i}`);
    const { renderer, legend } = buildUniqueValueRenderer("CATEGORY", values, baseSymbol);
    expect(renderer.uniqueValueInfos).toHaveLength(40);
    expect(legend).toHaveLength(40);
    // Regression: this used to be QUALITATIVE_PALETTE[i % 12], which repeated
    // every 12 values ("duplicate colors") once a field exceeded 12 distinct
    // values - a very ordinary case (e.g. station names). Golden-angle hue
    // stepping past the curated palette means every one of these 40 colors
    // is unique.
    expect(new Set(legend.map((entry) => entry.color)).size).toBe(40);
  });

  test("does not truncate - the caller decides how many values to pass in", () => {
    const values = Array.from({ length: 15 }, (_, i) => `V${i}`);
    const { renderer, legend } = buildUniqueValueRenderer("CATEGORY", values, baseSymbol);
    expect(renderer.uniqueValueInfos).toHaveLength(15);
    expect(legend).toHaveLength(15);
    expect(renderer.defaultSymbol).toBeUndefined();
  });
});

describe("paletteColor", () => {
  test("uses the curated palette for the first QUALITATIVE_PALETTE.length indices", () => {
    QUALITATIVE_PALETTE.forEach((color, i) => expect(paletteColor(i)).toBe(color));
  });

  test("generates a distinct, valid hex color beyond the curated palette", () => {
    const color = paletteColor(QUALITATIVE_PALETTE.length);
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
    expect(QUALITATIVE_PALETTE).not.toContain(color);
  });

  test("never repeats across a large run of indices", () => {
    const colors = Array.from({ length: 100 }, (_, i) => paletteColor(i));
    expect(new Set(colors).size).toBe(100);
  });
});

describe("buildClassBreaksRenderer", () => {
  const baseSymbol = makeSymbol({ type: "simple-marker", color: "#000000", size: 8 });

  test("builds color-ramp class breaks by default", () => {
    const { renderer, legend } = buildClassBreaksRenderer("RATING", [1, 2, 3, 4, 5], { baseSymbol, classCount: 3 });
    expect(renderer.type).toBe("class-breaks");
    expect(renderer.classBreakInfos).toHaveLength(3);
    expect(legend).toHaveLength(3);
    expect(legend[0].size).toBeUndefined();
    expect(renderer.classBreakInfos[0].symbol.color).toBeDefined();
  });

  test("builds a size ramp instead of a color ramp when rampMode is 'size'", () => {
    const { renderer, legend } = buildClassBreaksRenderer("RATING", [1, 2, 3, 4, 5], {
      baseSymbol,
      classCount: 3,
      rampMode: "size",
      minSize: 6,
      maxSize: 24
    });
    expect(renderer.classBreakInfos[0].symbol.size).toBe(6);
    expect(renderer.classBreakInfos.at(-1).symbol.size).toBe(24);
    expect(legend[0].size).toBe(6);
  });

  test("uses quantile classification when requested", () => {
    const { renderer } = buildClassBreaksRenderer("RATING", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], {
      baseSymbol,
      classCount: 5,
      method: "quantile"
    });
    expect(renderer.classBreakInfos).toHaveLength(5);
  });
});

describe("buildHaloSymbol", () => {
  test("produces a two-layer CIM point symbol with halo behind the base marker", () => {
    const cim = buildHaloSymbol("#ff0000", 8, { color: "#ffffff", size: 16 });
    expect(cim.type).toBe("CIMSymbolReference");
    expect(cim.symbol.symbolLayers).toHaveLength(2);
    expect(cim.symbol.symbolLayers[0].size).toBe(16); // halo layer, drawn first (behind)
    expect(cim.symbol.symbolLayers[1].size).toBe(8); // base marker layer, drawn last (on top)
  });

  test("defaults halo size to base size + 8 when not given", () => {
    const cim = buildHaloSymbol("#ff0000", 10, { color: "#ffffff" });
    expect(cim.symbol.symbolLayers[0].size).toBe(18);
  });
});

describe("toArcGISRenderer", () => {
  test("strips bookkeeping keys (symbolType, legend) from a unique-value descriptor", () => {
    const descriptor = {
      type: "unique-value",
      field: "CATEGORY",
      uniqueValueInfos: [{ value: "A", symbol: {} }],
      symbolType: "simple-marker",
      legend: [{ key: "A", label: "A", color: "#fff" }]
    };
    expect(toArcGISRenderer(descriptor)).toEqual({
      type: "unique-value",
      field: "CATEGORY",
      uniqueValueInfos: descriptor.uniqueValueInfos
    });
  });

  test("strips bookkeeping keys from a class-breaks descriptor", () => {
    const descriptor = {
      type: "class-breaks",
      field: "RATING",
      classBreakInfos: [{ minValue: 0, maxValue: 5, symbol: {} }],
      symbolType: undefined,
      legend: []
    };
    expect(toArcGISRenderer(descriptor)).toEqual({
      type: "class-breaks",
      field: "RATING",
      classBreakInfos: descriptor.classBreakInfos
    });
  });

  test("passes through a falsy descriptor unchanged", () => {
    expect(toArcGISRenderer(null)).toBeNull();
  });
});
