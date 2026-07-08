import GISMapEngine from "./GISMapEngine";
import esriRequest from "@arcgis/core/request";
import IdentityManager from "@arcgis/core/identity/IdentityManager";
import Graphic from "@arcgis/core/Graphic";

function makeView(hitTestResponse) {
  const response = hitTestResponse || { results: [] };
  const map = {
    removeAll: jest.fn(),
    add: jest.fn(),
    reorder: jest.fn()
  };
  return {
    map,
    on: jest.fn(() => ({ remove: jest.fn() })),
    hitTest: jest.fn().mockResolvedValue(response),
    goTo: jest.fn().mockResolvedValue(undefined),
    x: 100,
    y: 200
  };
}

describe("GISMapEngine.attachToView", () => {
  test("does nothing when view is falsy", () => {
    const engine = new GISMapEngine();
    expect(() => engine.attachToView(null)).not.toThrow();
    expect(engine.currentMap).toBeNull();
  });

  test("builds all layers, adds them in layerOrder, and binds a click handler", () => {
    const engine = new GISMapEngine();
    const view = makeView();
    engine.attachToView(view);

    expect(engine.currentMap).toBe(view.map);
    expect(engine.currentView).toBe(view);
    expect(view.map.removeAll).toHaveBeenCalled();
    expect(view.map.add).toHaveBeenCalledTimes(7);
    expect(view.on).toHaveBeenCalledWith("click", expect.any(Function));
    expect(engine.touristAttractionLayer.url).toBeDefined();
    expect(engine.sketchVM.layer).toBe(engine.drawLayer);
  });

  test("removes a previous click handle before registering a new one on reattachment", () => {
    const engine = new GISMapEngine();
    const view1 = makeView();
    engine.attachToView(view1);
    const firstHandle = engine.clickHandle;
    const removeSpy = firstHandle.remove;

    const view2 = makeView();
    engine.attachToView(view2);

    expect(removeSpy).toHaveBeenCalled();
    expect(engine.currentView).toBe(view2);
  });

  test("carries the outgoing view's extent over to the incoming view on reattachment", () => {
    const engine = new GISMapEngine();
    const view1 = makeView();
    const sentinelExtent = { xmin: 0, ymin: 0, xmax: 1, ymax: 1 };
    view1.extent = sentinelExtent;
    engine.attachToView(view1);

    const view2 = makeView();
    engine.attachToView(view2);

    expect(view2.goTo).toHaveBeenCalledWith(sentinelExtent);
  });

  test("skips goTo on the very first attachToView call, since there is no previous view", () => {
    const engine = new GISMapEngine();
    const view = makeView();
    engine.attachToView(view);

    expect(view.goTo).not.toHaveBeenCalled();
  });

  test("restores route/stop graphics and existing drawings across reattachment", () => {
    const engine = new GISMapEngine();
    const view1 = makeView();
    engine.attachToView(view1);

    engine.drawRoute({ type: "polyline", paths: [[[0, 0]]] });
    engine.drawStops({ type: "point", x: 0, y: 0 }, { type: "point", x: 1, y: 1 });
    engine.sketchVM.emit("create", {
      state: "complete",
      graphic: { attributes: {} }
    });
    engine.drawLayer.add({ symbol: { type: "simple-marker", color: "red" } });

    const view2 = makeView();
    engine.attachToView(view2);

    expect(engine.routeLayer.graphics.toArray()).toContain(engine.routeGraphic);
    expect(engine.stopLayer.graphics.toArray()).toEqual([
      engine.startGraphic,
      engine.endGraphic
    ]);
    expect(engine.drawLayer.graphics).toHaveLength(1);
  });

  test("sketchVM 'create' callback seeds attributes and fires onDrawingsChanged only when complete", () => {
    const engine = new GISMapEngine();
    const onDrawingsChanged = jest.fn();
    engine.setOnDrawingsChanged(onDrawingsChanged);
    engine.attachToView(makeView());

    const inProgressGraphic = { attributes: undefined };
    engine.sketchVM.emit("create", { state: "active", graphic: inProgressGraphic });
    expect(onDrawingsChanged).not.toHaveBeenCalled();
    expect(inProgressGraphic.attributes).toBeUndefined();

    const completedGraphic = { attributes: undefined };
    engine.sketchVM.emit("create", { state: "complete", graphic: completedGraphic });
    expect(completedGraphic.attributes).toEqual({});
    expect(onDrawingsChanged).toHaveBeenCalledTimes(1);
  });

  test("sets ground-relative elevation info on the drawings layer", () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    expect(engine.drawLayer.elevationInfo).toEqual({ mode: "on-the-ground" });
  });
});

describe("GISMapEngine.handleFeatureClick", () => {
  test("does nothing when engine isn't attached to a view", () => {
    const engine = new GISMapEngine();
    expect(() => engine.handleFeatureClick({})).not.toThrow();
  });

  test("selects a feature and notifies onFeatureSelect on a hit", async () => {
    const engine = new GISMapEngine();
    const graphic = {
      attributes: { OBJECTID: 1, name: "Test" },
      layer: null
    };
    const view = makeView({ results: [{ graphic }] });
    engine.attachToView(view);
    graphic.layer = engine.touristAttractionLayer;
    engine.touristAttractionLayer.objectIdField = "OBJECTID";
    engine.touristAttractionLayer.title = "Tourist Attractions";

    const onFeatureSelect = jest.fn();
    engine.setOnFeatureSelect(onFeatureSelect);

    const clickHandler = view.on.mock.calls[0][1];
    await clickHandler({ x: 10, y: 20 });

    expect(view.hitTest).toHaveBeenCalledWith(
      { x: 10, y: 20 },
      { include: [engine.touristAttractionLayer, engine.mrtStationLayer, engine.mrtLineLayer, engine.drawLayer] }
    );
    expect(engine.selectedGraphic).toBe(graphic);
    expect(engine.selectedLayerId).toBe("touristAttractions");
    expect(onFeatureSelect).toHaveBeenCalledWith({
      layerId: "touristAttractions",
      layerTitle: "Tourist Attractions",
      objectIdField: "OBJECTID",
      attributes: { OBJECTID: 1, name: "Test" },
      x: 10,
      y: 20
    });
  });

  test("ignores hitTest results without attributes and clears selection when nothing hit", async () => {
    const engine = new GISMapEngine();
    const view = makeView({ results: [{ graphic: { attributes: null } }] });
    engine.attachToView(view);
    engine.selectedGraphic = "stale";
    engine.selectedLayerId = "stale";
    const onFeatureSelect = jest.fn();
    engine.setOnFeatureSelect(onFeatureSelect);

    const clickHandler = view.on.mock.calls[0][1];
    await clickHandler({ x: 1, y: 2 });

    expect(engine.selectedGraphic).toBeNull();
    expect(engine.selectedLayerId).toBeNull();
    expect(onFeatureSelect).toHaveBeenCalledWith(null);
  });

  test("falls back to 'Feature' title and null objectIdField when layer metadata is missing", async () => {
    const engine = new GISMapEngine();
    const graphic = { attributes: { a: 1 }, layer: undefined };
    const view = makeView({ results: [{ graphic }] });
    engine.attachToView(view);
    const onFeatureSelect = jest.fn();
    engine.setOnFeatureSelect(onFeatureSelect);

    await view.on.mock.calls[0][1]({ x: 0, y: 0 });

    expect(onFeatureSelect).toHaveBeenCalledWith(
      expect.objectContaining({ layerId: null, layerTitle: "Feature", objectIdField: null })
    );
  });
});

describe("GISMapEngine.resolveLayerId / hostedLayerById", () => {
  test("resolves each known layer and returns null for unknown layers", () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());

    expect(engine.resolveLayerId(engine.touristAttractionLayer)).toBe("touristAttractions");
    expect(engine.resolveLayerId(engine.mrtStationLayer)).toBe("mrtStations");
    expect(engine.resolveLayerId(engine.mrtLineLayer)).toBe("mrtLines");
    expect(engine.resolveLayerId(engine.drawLayer)).toBe("drawings");
    expect(engine.resolveLayerId({})).toBeNull();
  });

  test("hostedLayerById returns the hosted FeatureLayer or null", () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());

    expect(engine.hostedLayerById("touristAttractions")).toBe(engine.touristAttractionLayer);
    expect(engine.hostedLayerById("mrtStations")).toBe(engine.mrtStationLayer);
    expect(engine.hostedLayerById("mrtLines")).toBe(engine.mrtLineLayer);
    expect(engine.hostedLayerById("drawings")).toBeNull();
    expect(engine.hostedLayerById("unknown")).toBeNull();
  });
});

describe("GISMapEngine.buildDrawingAttributes", () => {
  test("seeds default values from drawingFields and applies overrides", () => {
    const engine = new GISMapEngine();
    engine.drawingFields = [
      { name: "name", type: "esriFieldTypeString", defaultValue: "Untitled" },
      { name: "count", type: "esriFieldTypeInteger", defaultValue: null }
    ];

    expect(engine.buildDrawingAttributes()).toEqual({ name: "Untitled", count: null });
    expect(engine.buildDrawingAttributes({ count: 5, extra: "x" })).toEqual({
      name: "Untitled",
      count: 5,
      extra: "x"
    });
  });
});

describe("GISMapEngine.drawRoute / drawStops", () => {
  test("drawRoute is a no-op on the graphic layer when not attached but still stores the graphic", () => {
    const engine = new GISMapEngine();
    engine.drawRoute({ type: "polyline" });
    expect(engine.routeGraphic.geometry).toEqual({ type: "polyline" });
  });

  test("drawRoute clears the route layer and adds the new graphic when attached", () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.drawRoute({ type: "polyline" });
    engine.drawRoute({ type: "polyline", changed: true });

    expect(engine.routeLayer.graphics.toArray()).toEqual([engine.routeGraphic]);
    expect(engine.routeGraphic.geometry).toEqual({ type: "polyline", changed: true });
  });

  test("drawStops is a no-op on the graphic layer when not attached but still stores graphics", () => {
    const engine = new GISMapEngine();
    engine.drawStops({ type: "point" }, { type: "point" });
    expect(engine.startGraphic).toBeTruthy();
    expect(engine.endGraphic).toBeTruthy();
  });

  test("drawStops replaces stop layer graphics when attached", () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.drawStops({ type: "point" }, { type: "point" });

    expect(engine.stopLayer.graphics.toArray()).toEqual([engine.startGraphic, engine.endGraphic]);
    expect(engine.startGraphic.symbol.color).toBe("green");
    expect(engine.endGraphic.symbol.color).toBe("red");
  });
});

describe("GISMapEngine.toggleRoute", () => {
  test("updates visibility flag and, if attached, both route and stop layers", () => {
    const engine = new GISMapEngine();
    engine.toggleRoute(false);
    expect(engine.routeVisible).toBe(false);

    engine.attachToView(makeView());
    engine.toggleRoute(true);
    expect(engine.routeLayer.visible).toBe(true);
    expect(engine.stopLayer.visible).toBe(true);
  });
});

describe("GISMapEngine heatmap controls", () => {
  test("enableHeatmap sets visibility/intensity and clones the renderer when attached", () => {
    const engine = new GISMapEngine();
    engine.enableHeatmap(null, 80);
    expect(engine.heatVisible).toBe(true);
    expect(engine.heatIntensity).toBe(80);

    engine.attachToView(makeView());
    engine.enableHeatmap(null, 42);
    expect(engine.heatLayer.visible).toBe(true);
    expect(engine.heatLayer.renderer.maxPixelIntensity).toBe(42);
  });

  test("disableHeatmap hides the layer when attached and is safe when not", () => {
    const engine = new GISMapEngine();
    expect(() => engine.disableHeatmap()).not.toThrow();
    expect(engine.heatVisible).toBe(false);

    engine.attachToView(makeView());
    engine.enableHeatmap(null, 50);
    engine.disableHeatmap();
    expect(engine.heatLayer.visible).toBe(false);
  });

  test("updateHeatmapIntensity updates the field and, if attached, clones the renderer", () => {
    const engine = new GISMapEngine();
    engine.updateHeatmapIntensity(33);
    expect(engine.heatIntensity).toBe(33);

    engine.attachToView(makeView());
    engine.updateHeatmapIntensity(77);
    expect(engine.heatLayer.renderer.maxPixelIntensity).toBe(77);
  });
});

describe("GISMapEngine.symbolToStyleGroup / getLayers", () => {
  test("symbolToStyleGroup derives label, color, borderWidth, and outlineColor per symbol type", () => {
    const engine = new GISMapEngine();

    expect(engine.symbolToStyleGroup({ type: "simple-line", color: {}, width: 3 })).toEqual({
      symbolType: "simple-line",
      label: "Lines",
      color: "#000000",
      borderWidth: 3,
      outlineColor: undefined
    });

    expect(
      engine.symbolToStyleGroup({ type: "simple-fill", color: {}, outline: { color: {}, width: 2 } })
    ).toEqual({
      symbolType: "simple-fill",
      label: "Polygons",
      color: "#000000",
      borderWidth: 2,
      outlineColor: "#000000"
    });

    expect(engine.symbolToStyleGroup(null)).toEqual({
      symbolType: null,
      label: "Style",
      color: "#000000",
      borderWidth: null,
      outlineColor: undefined
    });

    expect(engine.symbolToStyleGroup({ type: "simple-marker" }, "Custom Label").label).toBe(
      "Custom Label"
    );
  });

  test("getLayers returns 7 layers in layerOrder with empty styleGroups before any styling exists", () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());

    const layers = engine.getLayers();
    expect(layers.map((l) => l.id)).toEqual([
      "route",
      "stops",
      "touristAttractions",
      "heat",
      "mrtStations",
      "mrtLines",
      "drawings"
    ]);
    expect(layers.find((l) => l.id === "route").styleGroups).toEqual([]);
    expect(layers.find((l) => l.id === "touristAttractions").styleGroups).toHaveLength(1);
    expect(layers.find((l) => l.id === "drawings").styleGroups).toEqual([]);
  });

  test("getLayers produces one drawings style group per distinct symbol type present", () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.drawLayer.add({ symbol: { type: "simple-marker", color: {} } });
    engine.drawLayer.add({ symbol: { type: "simple-marker", color: {} } });
    engine.drawLayer.add({ symbol: { type: "simple-line", color: {}, width: 1 } });

    const drawings = engine.getLayers().find((l) => l.id === "drawings");
    expect(drawings.styleGroups.map((g) => g.symbolType).sort()).toEqual([
      "simple-line",
      "simple-marker"
    ]);
  });

  test("getLayers includes a route style group once a route graphic exists", () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.drawRoute({ type: "polyline" });

    const route = engine.getLayers().find((l) => l.id === "route");
    expect(route.styleGroups).toHaveLength(1);
    expect(route.styleGroups[0].label).toBe("Route");
  });
});

describe("GISMapEngine.toggleLayer", () => {
  test("flips visibility for a known layer id and ignores unknown ids", () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    const before = engine.routeLayer.visible;

    engine.toggleLayer("route");
    expect(engine.routeLayer.visible).toBe(!before);

    expect(() => engine.toggleLayer("unknown")).not.toThrow();
  });
});

describe("GISMapEngine.zoomToLayer", () => {
  test("is a no-op when there is no current view", async () => {
    const engine = new GISMapEngine();
    await expect(engine.zoomToLayer("route", jest.fn())).resolves.toBeUndefined();
  });

  test("is a no-op for an unknown layer id", async () => {
    const engine = new GISMapEngine();
    const view = makeView();
    engine.attachToView(view);

    await engine.zoomToLayer("unknown", jest.fn());
    expect(view.goTo).not.toHaveBeenCalled();
  });

  test("reports nothing-to-zoom-to for an empty GraphicsLayer instead of calling goTo", async () => {
    const engine = new GISMapEngine();
    const view = makeView();
    engine.attachToView(view);
    const msg = jest.fn();

    await engine.zoomToLayer("drawings", msg);

    expect(view.goTo).not.toHaveBeenCalled();
    expect(msg).toHaveBeenCalledWith("Nothing to zoom to on this layer yet.", "error");
  });

  test("calls view.goTo with the graphics array (not the bare layer) once it has graphics", async () => {
    const engine = new GISMapEngine();
    const view = makeView();
    engine.attachToView(view);
    const graphic = { symbol: { type: "simple-marker" } };
    engine.drawLayer.add(graphic);

    await engine.zoomToLayer("drawings", jest.fn());
    expect(view.goTo).toHaveBeenCalledWith([graphic]);
  });

  test("reveals a hidden layer (and updates its visibility field) instead of zooming to nothing visible", async () => {
    const engine = new GISMapEngine();
    const view = makeView();
    engine.attachToView(view);
    engine.toggleLayer("mrtStations");
    expect(engine.mrtStationLayer.visible).toBe(false);

    await engine.zoomToLayer("mrtStations", jest.fn());

    expect(engine.mrtStationLayer.visible).toBe(true);
    expect(engine.mrtStationVisible).toBe(true);
    expect(view.goTo).toHaveBeenCalledWith(engine.mrtStationLayer.fullExtent);
  });

  test("loads the FeatureLayer and goes to its fullExtent (not the bare layer)", async () => {
    const engine = new GISMapEngine();
    const view = makeView();
    engine.attachToView(view);

    await engine.zoomToLayer("touristAttractions", jest.fn());
    expect(engine.touristAttractionLayer.load).toHaveBeenCalled();
    expect(view.goTo).toHaveBeenCalledWith(engine.touristAttractionLayer.fullExtent);
  });

  test("reports nothing-to-zoom-to when a loaded FeatureLayer has no fullExtent", async () => {
    const engine = new GISMapEngine();
    const view = makeView();
    engine.attachToView(view);
    engine.touristAttractionLayer.fullExtent = null;
    const msg = jest.fn();

    await engine.zoomToLayer("touristAttractions", msg);
    expect(view.goTo).not.toHaveBeenCalled();
    expect(msg).toHaveBeenCalledWith("Nothing to zoom to on this layer yet.", "error");
  });

  test("reports a failure toast when goTo rejects", async () => {
    const engine = new GISMapEngine();
    const view = makeView();
    view.goTo = jest.fn().mockRejectedValue(new Error("no extent"));
    engine.attachToView(view);
    const msg = jest.fn();

    await engine.zoomToLayer("touristAttractions", msg);
    expect(msg).toHaveBeenCalledWith("Could not zoom to this layer.", "error");
  });
});

describe("GISMapEngine.setLayerStyle", () => {
  let engine;
  beforeEach(() => {
    engine = new GISMapEngine();
    engine.attachToView(makeView());
  });

  test("styles touristAttractions and persists the renderer for reattachment", () => {
    engine.setLayerStyle("touristAttractions", { color: "#ff0000", borderWidth: 2 });
    expect(engine.touristAttractionLayer.renderer.symbol.color).toBe("#ff0000");
    expect(engine.touristAttractionLayer.renderer.symbol.outline.width).toBe(2);
    expect(engine.touristAttractionRenderer.symbol.color).toBe("#ff0000");
  });

  test("is a no-op for touristAttractions when there's no renderer", () => {
    engine.touristAttractionLayer.renderer = null;
    expect(() => engine.setLayerStyle("touristAttractions", { color: "#fff" })).not.toThrow();
  });

  test("styles mrtStations (simple-fill) including outline color", () => {
    engine.setLayerStyle("mrtStations", { color: "#111111", outlineColor: "#222222", borderWidth: 4 });
    expect(engine.mrtStationLayer.renderer.symbol.color).toBe("#111111");
    expect(engine.mrtStationLayer.renderer.symbol.outline.color).toBe("#222222");
    expect(engine.mrtStationLayer.renderer.symbol.outline.width).toBe(4);
    expect(engine.mrtStationRenderer.symbol.outline.color).toBe("#222222");
  });

  test("is a no-op for mrtStations when there's no renderer", () => {
    engine.mrtStationLayer.renderer = null;
    expect(() => engine.setLayerStyle("mrtStations", { color: "#fff" })).not.toThrow();
  });

  test("styles mrtLines (simple-line) using width instead of outline", () => {
    engine.setLayerStyle("mrtLines", { color: "#333333", borderWidth: 5 });
    expect(engine.mrtLineLayer.renderer.symbol.color).toBe("#333333");
    expect(engine.mrtLineLayer.renderer.symbol.width).toBe(5);
    expect(engine.mrtLineRenderer.symbol.width).toBe(5);
  });

  test("is a no-op for mrtLines when there's no renderer", () => {
    engine.mrtLineLayer.renderer = null;
    expect(() => engine.setLayerStyle("mrtLines", { color: "#fff" })).not.toThrow();
  });

  test("styles the route graphic's symbol directly", () => {
    engine.drawRoute({ type: "polyline" });
    engine.setLayerStyle("route", { color: "#444444", borderWidth: 6 });
    expect(engine.routeGraphic.symbol.color).toBe("#444444");
    expect(engine.routeGraphic.symbol.width).toBe(6);
  });

  test("is a no-op for route when there is no route graphic", () => {
    expect(() => engine.setLayerStyle("route", { color: "#fff" })).not.toThrow();
  });

  test("scopes drawings styling to the given symbolType only", () => {
    engine.drawLayer.add(new Graphic({ symbol: { type: "simple-marker", color: "red" } }));
    engine.drawLayer.add(new Graphic({ symbol: { type: "simple-line", color: "blue", width: 2 } }));

    engine.setLayerStyle("drawings", { color: "#00ff00", symbolType: "simple-marker" });

    const [pointGraphic, lineGraphic] = engine.drawLayer.graphics.toArray();
    expect(pointGraphic.symbol.color).toBe("#00ff00");
    expect(lineGraphic.symbol.color).toBe("blue");
  });

  test("styles all drawings graphics when no symbolType is given", () => {
    engine.drawLayer.add(new Graphic({ symbol: { type: "simple-marker", color: "red" } }));
    engine.drawLayer.add(new Graphic({ symbol: { type: "simple-line", color: "blue", width: 2 } }));

    engine.setLayerStyle("drawings", { color: "#abcdef" });

    engine.drawLayer.graphics.forEach((g) => expect(g.symbol.color).toBe("#abcdef"));
  });

  test("is a no-op for drawings when the draw layer is missing", () => {
    engine.drawLayer = null;
    expect(() => engine.setLayerStyle("drawings", { color: "#fff" })).not.toThrow();
  });

  test("does nothing for an unknown layer id", () => {
    expect(() => engine.setLayerStyle("unknown-id", { color: "#fff" })).not.toThrow();
  });

  test("defaults to an empty options object", () => {
    expect(() => engine.setLayerStyle("route")).not.toThrow();
  });
});

describe("GISMapEngine.reorderLayers", () => {
  test("updates layerOrder and reorders the underlying map layers when attached", () => {
    const engine = new GISMapEngine();
    const view = makeView();
    engine.attachToView(view);

    engine.reorderLayers(0, 6);
    expect(engine.layerOrder[6]).toBe("route");
    expect(view.map.reorder).toHaveBeenCalledTimes(7);
  });

  test("updates layerOrder without touching the map when not attached", () => {
    const engine = new GISMapEngine();
    engine.reorderLayers(0, 2);
    expect(engine.layerOrder[2]).toBe("route");
  });
});

describe("GISMapEngine draw-tool starters", () => {
  test("startPointDraw/startLineDraw/startPolygonDraw call sketchVM.create with the right geometry", () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());

    engine.startPointDraw();
    expect(engine.sketchVM.create).toHaveBeenCalledWith("point");

    engine.startLineDraw();
    expect(engine.sketchVM.create).toHaveBeenCalledWith("polyline");

    engine.startPolygonDraw();
    expect(engine.sketchVM.create).toHaveBeenCalledWith("polygon");
  });

  test("are no-ops when no sketchVM exists yet", () => {
    const engine = new GISMapEngine();
    expect(() => {
      engine.startPointDraw();
      engine.startLineDraw();
      engine.startPolygonDraw();
    }).not.toThrow();
  });
});

describe("GISMapEngine.getDrawnFeatures / hasDrawings", () => {
  test("collects drawing, route, and stop graphics", () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    expect(engine.hasDrawings()).toBe(false);

    engine.drawLayer.add({ symbol: {} });
    engine.drawRoute({ type: "polyline" });
    engine.drawStops({ type: "point" }, { type: "point" });

    const features = engine.getDrawnFeatures();
    expect(features).toHaveLength(4);
    expect(engine.hasDrawings()).toBe(true);
  });
});

describe("GISMapEngine.toGeoJSONGeometry", () => {
  test("converts point/polyline/polygon geometries and returns null otherwise", () => {
    const engine = new GISMapEngine();
    expect(engine.toGeoJSONGeometry(null)).toBeNull();
    expect(engine.toGeoJSONGeometry({ type: "point", x: 1, y: 2 })).toEqual({
      type: "Point",
      coordinates: [1, 2]
    });
    expect(engine.toGeoJSONGeometry({ type: "polyline", paths: [[[0, 0], [1, 1]]] })).toEqual({
      type: "LineString",
      coordinates: [[0, 0], [1, 1]]
    });
    expect(engine.toGeoJSONGeometry({ type: "polyline" })).toEqual({ type: "LineString", coordinates: [] });
    expect(engine.toGeoJSONGeometry({ type: "polygon", rings: [[[0, 0]]] })).toEqual({
      type: "Polygon",
      coordinates: [[[0, 0]]]
    });
    expect(engine.toGeoJSONGeometry({ type: "polygon" })).toEqual({ type: "Polygon", coordinates: [] });
    expect(engine.toGeoJSONGeometry({ type: "unknown" })).toBeNull();
  });
});

describe("GISMapEngine.saveDrawings", () => {
  const originalCreateObjectURL = globalThis.URL.createObjectURL;
  const originalRevokeObjectURL = globalThis.URL.revokeObjectURL;

  beforeEach(() => {
    globalThis.URL.createObjectURL = jest.fn(() => "blob:mock-url");
    globalThis.URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    globalThis.URL.createObjectURL = originalCreateObjectURL;
    globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
  });

  test("reports 'draw something' when there are no features", () => {
    const engine = new GISMapEngine();
    const msg = jest.fn();
    engine.saveDrawings(msg);
    expect(msg).toHaveBeenCalledWith("Please draw something, before saving", "error");
    expect(globalThis.URL.createObjectURL).not.toHaveBeenCalled();
  });

  test("builds and downloads a GeoJSON FeatureCollection when features exist", () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.drawLayer.add({ symbol: {}, geometry: { type: "point", x: 5, y: 6 } });

    const clickSpy = jest.fn();
    const anchor = { click: clickSpy, href: "", download: "" };
    const createElementSpy = jest.spyOn(document, "createElement").mockReturnValue(anchor);

    const msg = jest.fn();
    engine.saveDrawings(msg);

    expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
    expect(anchor.download).toBe("drawings.geojson");
    expect(clickSpy).toHaveBeenCalled();
    expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
    expect(msg).toHaveBeenCalledWith("GeoJSON downloaded", "success");

    createElementSpy.mockRestore();
  });
});

function makeFile(contents) {
  return { name: "test.geojson", text: jest.fn().mockResolvedValue(JSON.stringify(contents)) };
}

describe("GISMapEngine.uploadGeoJSON", () => {
  test("returns early when there is no file", async () => {
    const engine = new GISMapEngine();
    await expect(engine.uploadGeoJSON(null)).resolves.toBeUndefined();
  });

  test("returns early when the engine isn't attached to a view", async () => {
    const engine = new GISMapEngine();
    await engine.uploadGeoJSON(makeFile({ features: [] }));
    expect(engine.drawLayer.graphics).toHaveLength(0);
  });

  test("blocks the upload with a message when unsaved drawings already exist", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.drawLayer.add({ symbol: {} });
    const msg = jest.fn();

    await engine.uploadGeoJSON(makeFile({ features: [] }), msg);

    expect(msg).toHaveBeenCalledWith(
      "Please save your current drawing and refresh the page before uploading",
      "error"
    );
    expect(engine.drawLayer.graphics).toHaveLength(1);
  });

  test("converts Point/LineString/Polygon features into graphics and pans the view", async () => {
    const engine = new GISMapEngine();
    const view = makeView();
    engine.attachToView(view);

    const file = makeFile({
      features: [
        { type: "Feature", geometry: { type: "Point", coordinates: [1, 2] }, properties: { a: 1 } },
        { type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] }, properties: {} },
        { type: "Feature", geometry: { type: "Polygon", coordinates: [[[0, 0]]] }, properties: {} }
      ]
    });

    await engine.uploadGeoJSON(file);

    expect(engine.drawLayer.graphics).toHaveLength(3);
    const [pointGraphic, lineGraphic, polygonGraphic] = engine.drawLayer.graphics.toArray();
    expect(pointGraphic.geometry).toEqual({ type: "point", x: 1, y: 2, spatialReference: { wkid: 3857 } });
    expect(pointGraphic.symbol.type).toBe("simple-marker");
    expect(pointGraphic.attributes).toEqual({ a: 1 });
    expect(lineGraphic.symbol.type).toBe("simple-line");
    expect(polygonGraphic.symbol.type).toBe("simple-fill");
    expect(engine.uploadedLayers).toHaveLength(1);
    expect(engine.uploadedLayers[0].name).toBe("test.geojson");
    expect(view.goTo).toHaveBeenCalledWith([pointGraphic, lineGraphic, polygonGraphic]);
  });

  test("creates a graphic with null geometry for unsupported geometry types", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    const file = makeFile({
      features: [{ type: "Feature", geometry: { type: "MultiPoint" }, properties: {} }]
    });

    await engine.uploadGeoJSON(file);

    expect(engine.drawLayer.graphics.toArray()[0].geometry).toBeNull();
  });

  test("logs and swallows errors, e.g. malformed JSON", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const file = { name: "bad.geojson", text: jest.fn().mockResolvedValue("not json") };

    await expect(engine.uploadGeoJSON(file)).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith("Upload failed:", expect.any(Error));

    consoleErrorSpy.mockRestore();
  });
});

describe("GISMapEngine.updateSelectedFeatureAttributes", () => {
  test("throws when nothing is selected", async () => {
    const engine = new GISMapEngine();
    await expect(engine.updateSelectedFeatureAttributes({})).rejects.toThrow("No feature selected.");
  });

  test("mutates in-memory attributes for the drawings layer", async () => {
    const engine = new GISMapEngine();
    engine.selectedGraphic = { attributes: { name: "old" } };
    engine.selectedLayerId = "drawings";

    const result = await engine.updateSelectedFeatureAttributes({ name: "new" });

    expect(result).toEqual({ success: true, attributes: { name: "new" } });
    expect(engine.selectedGraphic.attributes.name).toBe("new");
  });

  test("throws when the hosted layer can't be resolved", async () => {
    const engine = new GISMapEngine();
    engine.selectedGraphic = { attributes: {} };
    engine.selectedLayerId = "touristAttractions";
    await expect(engine.updateSelectedFeatureAttributes({})).rejects.toThrow("Layer not found.");
  });

  test("applies edits to a hosted FeatureLayer and merges the result", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.selectedLayerId = "touristAttractions";
    engine.selectedGraphic = { attributes: { OBJECTID: 7, name: "old" } };
    engine.touristAttractionLayer.objectIdField = "OBJECTID";
    engine.touristAttractionLayer.applyEdits.mockResolvedValue({ updateFeatureResults: [{}] });

    const result = await engine.updateSelectedFeatureAttributes({ name: "new" });

    expect(engine.touristAttractionLayer.applyEdits).toHaveBeenCalledWith({
      updateFeatures: [expect.objectContaining({ attributes: { OBJECTID: 7, name: "new" } })]
    });
    expect(result).toEqual({ success: true, attributes: { OBJECTID: 7, name: "new" } });
  });

  test("throws the service error message when applyEdits reports a failure", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.selectedLayerId = "touristAttractions";
    engine.selectedGraphic = { attributes: { OBJECTID: 7 } };
    engine.touristAttractionLayer.applyEdits.mockResolvedValue({
      updateFeatureResults: [{ error: { message: "Boom" } }]
    });

    await expect(engine.updateSelectedFeatureAttributes({ name: "x" })).rejects.toThrow("Boom");
  });

  test("falls back to a generic message when the service error has none", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.selectedLayerId = "touristAttractions";
    engine.selectedGraphic = { attributes: { OBJECTID: 7 } };
    engine.touristAttractionLayer.applyEdits.mockResolvedValue({
      updateFeatureResults: [{ error: {} }]
    });

    await expect(engine.updateSelectedFeatureAttributes({})).rejects.toThrow(
      "Failed to save attribute changes."
    );
  });
});

describe("GISMapEngine.addColumnToLayer", () => {
  test("requires a field name", async () => {
    const engine = new GISMapEngine();
    await expect(engine.addColumnToLayer("drawings", "")).rejects.toThrow("Field name is required.");
  });

  test("adds a drawings field and backfills existing graphics", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.drawLayer.add({ symbol: {}, attributes: {} });

    const result = await engine.addColumnToLayer("drawings", "status", "esriFieldTypeString", "new");

    expect(result).toEqual({ success: true });
    expect(engine.drawingFields).toContainEqual({
      name: "status",
      type: "esriFieldTypeString",
      defaultValue: "new"
    });
    expect(engine.drawLayer.graphics.toArray()[0].attributes.status).toBe("new");
  });

  test("rejects duplicate drawings columns", async () => {
    const engine = new GISMapEngine();
    engine.drawingFields = [{ name: "status", type: "esriFieldTypeString", defaultValue: null }];
    await expect(engine.addColumnToLayer("drawings", "status")).rejects.toThrow(
      'Column "status" already exists.'
    );
  });

  test("does not overwrite an existing attribute already present on a graphic", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.drawLayer.add({ symbol: {}, attributes: { status: "keep-me" } });

    await engine.addColumnToLayer("drawings", "status", "esriFieldTypeString", "new");

    expect(engine.drawLayer.graphics.toArray()[0].attributes.status).toBe("keep-me");
  });

  test("throws when the hosted layer can't be resolved", async () => {
    const engine = new GISMapEngine();
    await expect(engine.addColumnToLayer("unknown-layer", "field")).rejects.toThrow("Layer not found.");
  });

  test("adds a field to a hosted layer via addToDefinition and refreshes it", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.touristAttractionLayer.url = "https://example.com/FeatureServer";
    esriRequest.mockResolvedValueOnce({ data: {} });

    const result = await engine.addColumnToLayer("touristAttractions", "newField", "esriFieldTypeString", "d");

    expect(IdentityManager.getCredential).toHaveBeenCalledWith("https://example.com/FeatureServer");
    expect(esriRequest).toHaveBeenCalledWith(
      "https://example.com/FeatureServer/0/addToDefinition",
      expect.objectContaining({ method: "post", responseType: "json" })
    );
    expect(engine.touristAttractionLayer.refresh).toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  test("throws the service error message when addToDefinition fails", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    esriRequest.mockResolvedValueOnce({ data: { error: { message: "Not authorized" } } });

    await expect(
      engine.addColumnToLayer("touristAttractions", "newField")
    ).rejects.toThrow("Not authorized");
    expect(engine.touristAttractionLayer.refresh).not.toHaveBeenCalled();
  });

  test("falls back to a generic message when addToDefinition fails without one", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    esriRequest.mockResolvedValueOnce({ data: { error: {} } });

    await expect(engine.addColumnToLayer("touristAttractions", "newField")).rejects.toThrow(
      "Failed to add column to layer."
    );
  });
});
