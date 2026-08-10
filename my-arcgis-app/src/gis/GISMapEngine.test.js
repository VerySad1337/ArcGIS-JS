import GISMapEngine from "./GISMapEngine";
import esriRequest from "@arcgis/core/request";
import IdentityManager from "@arcgis/core/identity/IdentityManager";
import Graphic from "@arcgis/core/Graphic";

function makeView(hitTestResponse) {
  const response = hitTestResponse || { results: [] };
  const map = {
    removeAll: jest.fn(),
    add: jest.fn(),
    remove: jest.fn(),
    reorder: jest.fn()
  };
  return {
    map,
    on: jest.fn(() => ({ remove: jest.fn() })),
    hitTest: jest.fn().mockResolvedValue(response),
    goTo: jest.fn().mockResolvedValue(undefined),
    // Default: already-finished LayerView, so tests that don't care about
    // the heatmap resync's timing (see resyncHeatmapRendererOnceRendered)
    // aren't forced to simulate it. Tests that DO care override this.
    whenLayerView: jest.fn().mockResolvedValue({ updating: false, watch: jest.fn(() => ({ remove: jest.fn() })) }),
    x: 100,
    y: 200
  };
}

describe("GISMapEngine.detachFromView", () => {
  test("does nothing when there is no current map yet", () => {
    const engine = new GISMapEngine();
    expect(() => engine.detachFromView()).not.toThrow();
  });

  test("removes all layers from the outgoing map without touching engine state", () => {
    // Regression test for drawings vanishing permanently on a 2D/3D switch:
    // the outgoing <arcgis-map>/<arcgis-scene> destroys its own Map on
    // unmount, which cascades to destroy() every layer still attached to
    // it (including the persistent drawLayer). detachFromView must be
    // called before that unmount to pull layers off the doomed map first.
    const engine = new GISMapEngine();
    const view = makeView();
    engine.attachToView(view);
    engine.drawLayer.add({ symbol: { type: "simple-marker" }, geometry: { type: "point", x: 0, y: 0 } });

    engine.detachFromView();

    expect(view.map.removeAll).toHaveBeenCalledTimes(2); // once in attachToView, once here
    expect(engine.drawLayer.graphics).toHaveLength(1); // detaching from the map must not clear the layer itself
    expect(engine.currentMap).toBe(view.map);
  });
});

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
    expect(view.map.add).toHaveBeenCalledTimes(8);
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

  test("drops null-geometry graphics on reattachment instead of re-adding them", () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());

    engine.drawLayer.add({ symbol: { type: "simple-marker" }, geometry: { type: "point", x: 0, y: 0 } });
    engine.drawLayer.add({ symbol: { type: "simple-fill" }, geometry: null });

    engine.attachToView(makeView());

    expect(engine.drawLayer.graphics).toHaveLength(1);
    expect(engine.drawLayer.graphics.toArray()[0].geometry).not.toBeNull();
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

describe("GISMapEngine heatmap renderer mode", () => {
  test("setLayerAdvancedRenderer('heatmap') applies a heatmap renderer to a point layer without requiring a field", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());

    const result = await engine.setLayerAdvancedRenderer("touristAttractions", { type: "heatmap", intensity: 80 });
    expect(result.rendererType).toBe("heatmap");
    expect(engine.touristAttractionLayer.renderer.type).toBe("heatmap");
    expect(engine.touristAttractionLayer.renderer.maxPixelIntensity).toBe(80);

    const layers = engine.getLayers();
    const group = layers.find((l) => l.id === "touristAttractions").styleGroups[0];
    expect(group.rendererType).toBe("heatmap");
    expect(group.rendererIntensity).toBe(80);
  });

  test("clearLayerAdvancedRenderer reverts a heatmapped layer back to its Simple base", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());

    await engine.setLayerAdvancedRenderer("touristAttractions", { type: "heatmap", intensity: 60 });
    engine.clearLayerAdvancedRenderer("touristAttractions");

    expect(engine.touristAttractionLayer.renderer.type).not.toBe("heatmap");
  });

  test("heatmap on drawings assigns the layer's own renderer instead of per-graphic symbols, and clearing nulls it back out", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.drawLayer.add({ symbol: { type: "simple-marker", color: {} } });

    await engine.setLayerAdvancedRenderer("drawings", { type: "heatmap", symbolType: "simple-marker", intensity: 50 });
    expect(engine.drawLayer.renderer.type).toBe("heatmap");

    engine.clearLayerAdvancedRenderer("drawings");
    expect(engine.drawLayer.renderer).toBeNull();
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
      outlineColor: undefined,
      markerStyle: undefined,
      lineStyle: "solid",
      fillStyle: undefined,
      size: undefined,
      opacity: 1
    });

    expect(
      engine.symbolToStyleGroup({ type: "simple-fill", color: {}, outline: { color: {}, width: 2 } })
    ).toEqual({
      symbolType: "simple-fill",
      label: "Polygons",
      color: "#000000",
      borderWidth: 2,
      outlineColor: "#000000",
      markerStyle: undefined,
      lineStyle: undefined,
      fillStyle: "solid",
      size: undefined,
      opacity: 1
    });

    expect(engine.symbolToStyleGroup(null)).toEqual({
      symbolType: null,
      label: "Style",
      color: "#000000",
      borderWidth: null,
      outlineColor: undefined,
      markerStyle: undefined,
      lineStyle: undefined,
      fillStyle: undefined,
      size: undefined,
      opacity: 1
    });

    expect(engine.symbolToStyleGroup({ type: "simple-marker" }, "Custom Label").label).toBe(
      "Custom Label"
    );
  });

  test("getLayers excludes route/stops/searchResult/drawings (they have no Layers-card row) and returns the other 3 in layerOrder", () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());

    const layers = engine.getLayers();
    expect(layers.map((l) => l.id)).toEqual([
      "touristAttractions",
      "mrtStations",
      "mrtLines"
    ]);
    expect(layers.find((l) => l.id === "route")).toBeUndefined();
    expect(layers.find((l) => l.id === "searchResult")).toBeUndefined();
    expect(layers.find((l) => l.id === "drawings")).toBeUndefined();
    expect(layers.find((l) => l.id === "touristAttractions").styleGroups).toHaveLength(1);
  });

  test("createRouteResultLayer snapshots the current route into a new, named Layers-card row", () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.drawRoute({ type: "polyline", paths: [[[0, 0], [1, 1]]] });
    engine.drawStops({ type: "point", x: 0, y: 0 }, { type: "point", x: 1, y: 1 });

    const { id, name } = engine.createRouteResultLayer("My Commute");
    expect(name).toBe("My Commute");

    const saved = engine.getLayers().find((l) => l.id === id);
    expect(saved.name).toBe("My Commute");
    expect(saved.removable).toBe(true);
    // Exposes a Symbology group for its route line, unlike a named heatmap
    // layer (no editable renderer at all), same as any other stylable layer.
    expect(saved.styleGroups).toHaveLength(1);
    expect(saved.styleGroups[0].symbolType).toBe("simple-line");
  });

  test("setLayerStyle restyles a named route layer's line and persists it across a 2D/3D reattachment", () => {
    const engine = new GISMapEngine();
    const view = makeView();
    engine.attachToView(view);
    engine.drawRoute({ type: "polyline", paths: [[[0, 0], [1, 1]]] });
    engine.drawStops({ type: "point", x: 0, y: 0 }, { type: "point", x: 1, y: 1 });
    const { id } = engine.createRouteResultLayer("My Commute");

    engine.setLayerStyle(id, { color: "#00ff00", borderWidth: 5 });

    let group = engine.getLayers().find((l) => l.id === id).styleGroups[0];
    expect(group.color).toBe("#00ff00");
    expect(group.borderWidth).toBe(5);

    engine.attachToView(makeView());
    group = engine.getLayers().find((l) => l.id === id).styleGroups[0];
    expect(group.color).toBe("#00ff00");
    expect(group.borderWidth).toBe(5);
  });

  test("createRouteResultLayer throws on a blank name or when no route is drawn yet", () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());

    expect(() => engine.createRouteResultLayer("")).toThrow("Please give the route layer a name.");
    expect(() => engine.createRouteResultLayer("My Commute")).toThrow(
      "Search a route first, then add it to the layers card."
    );
  });

  test("createSearchResultLayer snapshots the current search marker into a new, named Layers-card row", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    await engine.zoomToPoint(103.8198, 1.3521);

    const { id, name } = engine.createSearchResultLayer("Client Site");
    expect(name).toBe("Client Site");

    const saved = engine.getLayers().find((l) => l.id === id);
    expect(saved.name).toBe("Client Site");
    expect(saved.removable).toBe(true);
    expect(saved.styleGroups).toHaveLength(1);
    expect(saved.styleGroups[0].symbolType).toBe("simple-marker");
  });

  test("setLayerStyle restyles a named search-result layer's marker and persists it across a 2D/3D reattachment", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    await engine.zoomToPoint(103.8198, 1.3521);
    const { id } = engine.createSearchResultLayer("Client Site");

    engine.setLayerStyle(id, { color: "#00ff00", borderWidth: 5 });

    let group = engine.getLayers().find((l) => l.id === id).styleGroups[0];
    expect(group.color).toBe("#00ff00");
    expect(group.borderWidth).toBe(5);

    engine.attachToView(makeView());
    group = engine.getLayers().find((l) => l.id === id).styleGroups[0];
    expect(group.color).toBe("#00ff00");
    expect(group.borderWidth).toBe(5);
  });

  test("createSearchResultLayer throws on a blank name or when no search result is placed yet", () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());

    expect(() => engine.createSearchResultLayer("")).toThrow(
      "Please give the search result layer a name."
    );
    expect(() => engine.createSearchResultLayer("Client Site")).toThrow(
      "Search an address first, then add it to the layers card."
    );
  });

  test("removeSearchResultLayer removes the layer from the map and layerOrder", async () => {
    const engine = new GISMapEngine();
    const view = makeView();
    engine.attachToView(view);
    await engine.zoomToPoint(103.8198, 1.3521);
    const { id } = engine.createSearchResultLayer("Client Site");

    engine.removeSearchResultLayer(id);

    expect(engine.layerOrder).not.toContain(id);
    expect(engine.getLayers().find((l) => l.id === id)).toBeUndefined();
  });

  test("clearSearchResult clears the live marker/graphic without touching a saved named layer", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    await engine.zoomToPoint(103.8198, 1.3521);
    const { id } = engine.createSearchResultLayer("Client Site");

    engine.clearSearchResult();

    expect(engine.searchGraphic).toBeNull();
    expect(engine.searchLayer.graphics.length).toBe(0);
    // The saved named layer is a snapshot, independent of the live marker.
    expect(engine.getLayers().find((l) => l.id === id)).toBeDefined();
    expect(engine.namedSearchLayers.get(id).graphics.length).toBe(1);
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
  // from/to are indices into the Layers card's own displayed order
  // (getLayers()'s output: touristAttractions, mrtStations, mrtLines,
  // drawings), not raw this.layerOrder positions - route/stops/searchResult/
  // buffer are excluded from the card and are never touched by this method,
  // but still occupy their original absolute layerOrder slots (0, 1, 6, 7).
  test("updates layerOrder and reorders the underlying map layers when attached, leaving route/stops/searchResult pinned", () => {
    const engine = new GISMapEngine();
    const view = makeView();
    engine.attachToView(view);

    engine.reorderLayers(0, 3);
    expect(engine.layerOrder[0]).toBe("route");
    expect(engine.layerOrder[1]).toBe("stops");
    expect(engine.layerOrder[5]).toBe("touristAttractions");
    expect(engine.layerOrder[6]).toBe("searchResult");
    expect(engine.layerOrder[7]).toBe("buffer");
    expect(view.map.reorder).toHaveBeenCalledTimes(8);
  });

  test("updates layerOrder without touching the map when not attached", () => {
    const engine = new GISMapEngine();
    engine.reorderLayers(0, 2);
    expect(engine.layerOrder[0]).toBe("route");
    expect(engine.layerOrder[1]).toBe("stops");
    expect(engine.layerOrder[4]).toBe("touristAttractions");
  });
});

describe("GISMapEngine portal layers", () => {
  const portalItem = { id: "abc123", title: "Parks", url: "https://example.com/Parks/FeatureServer" };

  test("addPortalLayer rejects an item with no url", async () => {
    const engine = new GISMapEngine();
    await expect(engine.addPortalLayer({ id: "x", title: "No URL" })).rejects.toThrow(
      "This portal item has no queryable layer URL."
    );
  });

  test("refuses a portal item whose service is not anonymously accessible, instead of forcing a sign-in", async () => {
    // Portal search happily returns items that are publicly *listed* but whose
    // service is Esri subscription content (error 499) or another user's
    // restricted item (403). Letting the FeatureLayer hit that makes
    // IdentityManager open its own sign-in modal, so the app appears to demand
    // a login. The engine must probe first and report it as a normal error.
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    esriRequest.mockResolvedValueOnce({
      data: { error: { code: 499, message: "Token Required for subscription content" } }
    });

    await expect(engine.addPortalLayer(portalItem)).rejects.toThrow(
      '"Parks" needs an ArcGIS account with access to it'
    );
    expect(engine.portalLayers.size).toBe(0);
    expect(engine.layerOrder).not.toContain("portal_abc123");
  });

  test("probes the service without prompting for credentials", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    esriRequest.mockClear();

    await engine.addPortalLayer(portalItem);

    expect(esriRequest).toHaveBeenCalledWith(
      portalItem.url,
      expect.objectContaining({ authMode: "no-prompt" })
    );
  });

  test("refuses when the probe request itself rejects", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    esriRequest.mockRejectedValueOnce(new Error("network down"));

    await expect(engine.addPortalLayer(portalItem)).rejects.toThrow(
      "needs an ArcGIS account with access to it"
    );
  });

  test("addPortalLayer registers the layer, appends it to layerOrder, and adds it to an attached map", async () => {
    const engine = new GISMapEngine();
    const view = makeView();
    engine.attachToView(view);

    const id = await engine.addPortalLayer(portalItem);

    expect(id).toBe("portal_abc123");
    expect(engine.layerOrder).toContain(id);
    expect(engine.portalLayers.get(id).url).toBe(portalItem.url);
    expect(view.map.add).toHaveBeenCalledWith(engine.portalLayers.get(id));
  });

  test("addPortalLayer is a no-op (returns the existing id) when the same item is added twice", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());

    const firstId = await engine.addPortalLayer(portalItem);
    const layerBefore = engine.portalLayers.get(firstId);
    const secondId = await engine.addPortalLayer(portalItem);

    expect(secondId).toBe(firstId);
    expect(engine.layerOrder.filter((x) => x === firstId)).toHaveLength(1);
    expect(engine.portalLayers.get(firstId)).toBe(layerBefore);
  });

  test("addPortalLayer works before the engine is attached to a view", async () => {
    const engine = new GISMapEngine();
    const id = await engine.addPortalLayer(portalItem);
    expect(engine.portalLayers.get(id)).toBeDefined();
  });

  test("portal layers appear in getLayers as removable and survive a 2D/3D reattachment", async () => {
    const engine = new GISMapEngine();
    const view1 = makeView();
    engine.attachToView(view1);
    const id = await engine.addPortalLayer(portalItem);

    const entry = engine.getLayers().find((l) => l.id === id);
    expect(entry).toEqual({
      id,
      name: "Parks",
      visible: true,
      removable: true,
      renamable: true,
      createdAt: expect.any(Number),
      layerType: "Feature Layer",
      styleGroups: [],
      filterable: true,
      filterDescription: null,
      annotatable: true,
      annotationField: null,
      editable: false,
      canBeDrawTarget: false,
      geometryType: null
    });

    const view2 = makeView();
    engine.attachToView(view2);

    expect(engine.portalLayers.has(id)).toBe(true);
    expect(engine.portalLayerMeta.has(id)).toBe(true);
    expect(view2.map.add).toHaveBeenCalledWith(engine.portalLayers.get(id));
  });

  test("a portal layer with a simple renderer exposes a style group and setLayerStyle restyles + persists it across reattachment", async () => {
    const engine = new GISMapEngine();
    const view1 = makeView();
    engine.attachToView(view1);
    const id = await engine.addPortalLayer(portalItem);

    // Simulates the service metadata that would normally arrive via
    // layer.load() resolving with a simple renderer/symbol.
    const makeSymbol = (color) => ({
      type: "simple-marker",
      color,
      outline: { width: 1 },
      clone() {
        return makeSymbol(this.color);
      }
    });
    const layer = engine.portalLayers.get(id);
    layer.renderer = {
      type: "simple",
      symbol: makeSymbol([0, 0, 0]),
      clone() {
        return { type: this.type, symbol: this.symbol.clone() };
      }
    };

    const before = engine.getLayers().find((l) => l.id === id);
    expect(before.styleGroups).toHaveLength(1);
    expect(before.styleGroups[0].symbolType).toBe("simple-marker");

    engine.setLayerStyle(id, { color: "#ff0000", borderWidth: 3 });

    expect(engine.portalLayers.get(id).renderer.symbol.color).toBe("#ff0000");
    expect(engine.portalLayerMeta.get(id).renderer.symbol.color).toBe("#ff0000");

    const view2 = makeView();
    engine.attachToView(view2);
    await Promise.resolve();
    await Promise.resolve();

    expect(engine.portalLayers.get(id).renderer).toBe(engine.portalLayerMeta.get(id).renderer);
  });

  describe("a portal layer whose service default renderer isn't Simple (regression: symbology couldn't be edited)", () => {
    // Simulates the common real-world case: the portal service's own
    // metadata resolves to a Unique Values renderer (or Class Breaks,
    // heatmap, dictionary, ...), which has no top-level `.symbol`. Before
    // the fix, getLayers() reported an empty styleGroups (no Symbology
    // section at all), setLayerStyle silently did nothing, and
    // setLayerAdvancedRenderer threw "no symbol to base a renderer on yet".
    function attachNonSimpleRenderer(engine, id) {
      const layer = engine.portalLayers.get(id);
      layer.geometryType = "point";
      layer.renderer = { type: "unique-value", field: "KIND", uniqueValueInfos: [] };
      return layer;
    }

    test("getLayers() still exposes a style group, generated from the layer's geometryType", async () => {
      const engine = new GISMapEngine();
      engine.attachToView(makeView());
      const id = await engine.addPortalLayer(portalItem);
      attachNonSimpleRenderer(engine, id);

      const entry = engine.getLayers().find((l) => l.id === id);

      expect(entry.styleGroups).toHaveLength(1);
      expect(entry.styleGroups[0].symbolType).toBe("simple-marker");
      // The live (Unique Values) renderer is left alone until the user
      // actually edits something, so the portal's own authored symbology
      // still displays on the map in the meantime.
      expect(engine.portalLayers.get(id).renderer.type).toBe("unique-value");
    });

    test("setLayerStyle actually applies a color change instead of silently no-opping", async () => {
      const engine = new GISMapEngine();
      engine.attachToView(makeView());
      const id = await engine.addPortalLayer(portalItem);
      attachNonSimpleRenderer(engine, id);

      engine.setLayerStyle(id, { color: "#00ff00" });

      expect(engine.portalLayerMeta.get(id).renderer.symbol.color).toBe("#00ff00");
      expect(engine.portalLayers.get(id).renderer.symbol.color).toBe("#00ff00");
      expect(engine.portalLayers.get(id).renderer.type).toBe("simple");
    });

    test("setLayerAdvancedRenderer no longer throws 'no symbol to base a renderer on yet'", async () => {
      const engine = new GISMapEngine();
      engine.attachToView(makeView());
      const id = await engine.addPortalLayer(portalItem);
      const layer = attachNonSimpleRenderer(engine, id);
      layer.fields = [{ name: "KIND", type: "esriFieldTypeString" }];
      layer.queryFeatures.mockResolvedValue({ features: [{ attributes: { KIND: "A" } }] });

      await expect(
        engine.setLayerAdvancedRenderer(id, { type: "unique-value", field: "KIND" })
      ).resolves.toEqual(expect.objectContaining({ rendererType: "unique-value", field: "KIND" }));
    });

    test("a layer with no recognizable geometryType still falls back to no style controls, not a crash", async () => {
      const engine = new GISMapEngine();
      engine.attachToView(makeView());
      const id = await engine.addPortalLayer(portalItem);
      engine.portalLayers.get(id).renderer = { type: "unique-value", field: "KIND", uniqueValueInfos: [] };
      // geometryType left unset - simulates a layer whose load() hasn't
      // resolved that field yet.

      const entry = engine.getLayers().find((l) => l.id === id);
      expect(entry.styleGroups).toEqual([]);
      expect(() => engine.setLayerStyle(id, { color: "#00ff00" })).not.toThrow();
    });
  });

  test("toggleLayer flips a portal layer's visibility and keeps portalLayerMeta in sync across reattachment", async () => {
    const engine = new GISMapEngine();
    const view1 = makeView();
    engine.attachToView(view1);
    const id = await engine.addPortalLayer(portalItem);

    engine.toggleLayer(id);
    expect(engine.portalLayers.get(id).visible).toBe(false);
    expect(engine.portalLayerMeta.get(id).visible).toBe(false);

    engine.attachToView(makeView());
    expect(engine.portalLayers.get(id).visible).toBe(false);
  });

  test("removePortalLayer removes it from the map, layerOrder, and internal maps", async () => {
    const engine = new GISMapEngine();
    const view = makeView();
    engine.attachToView(view);
    const id = await engine.addPortalLayer(portalItem);
    const layer = engine.portalLayers.get(id);

    engine.removePortalLayer(id);

    expect(view.map.remove).toHaveBeenCalledWith(layer);
    expect(engine.portalLayers.has(id)).toBe(false);
    expect(engine.portalLayerMeta.has(id)).toBe(false);
    expect(engine.layerOrder).not.toContain(id);
  });

  test("removePortalLayer is a no-op for an id it didn't add", () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    expect(() => engine.removePortalLayer("touristAttractions")).not.toThrow();
    expect(engine.touristAttractionLayer).toBeTruthy();
  });

  test("renameLayer updates a portal layer's title in meta, the live layer, and getLayers()", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    const id = await engine.addPortalLayer(portalItem);

    engine.renameLayer(id, "  Renamed Parks  ");

    expect(engine.portalLayerMeta.get(id).title).toBe("Renamed Parks");
    expect(engine.portalLayers.get(id).title).toBe("Renamed Parks");
    expect(engine.getLayers().find((l) => l.id === id).name).toBe("Renamed Parks");
  });

  test("renameLayer throws on a blank name", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    const id = await engine.addPortalLayer(portalItem);
    expect(() => engine.renameLayer(id, "   ")).toThrow();
  });

  test("renameLayer throws for a fixed layer with no *LayerMeta entry", () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    expect(() => engine.renameLayer("touristAttractions", "New Name")).toThrow();
  });
});

describe("GISMapEngine named heatmap layers", () => {
  test("heatmapEligibleSourceLayers lists the fixed point layers plus eligible portal layers", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.touristAttractionLayer.geometryType = "point";
    engine.mrtStationLayer.geometryType = "point";
    await engine.addPortalLayer({ id: "pts", title: "Points", url: "https://example.com/Points/FeatureServer" });
    engine.portalLayers.get("portal_pts").geometryType = "point";
    await engine.addPortalLayer({ id: "lns", title: "Lines", url: "https://example.com/Lines/FeatureServer" });
    engine.portalLayers.get("portal_lns").geometryType = "polyline";

    const ids = engine.heatmapEligibleSourceLayers().map((l) => l.id);
    expect(ids).toEqual(["touristAttractions", "mrtStations", "portal_pts"]);
  });

  // Regression: touristAttractions/mrtStations used to be hardcoded as
  // always heatmap-eligible on the assumption that they're "known point
  // layers." That assumption doesn't hold if the configured feature
  // service's real data isn't point geometry (e.g. MRT stations modeled as
  // small polygon footprints rather than single coordinates) - the layer's
  // marker-styled renderer says nothing about its actual geometry.
  test("excludes touristAttractions/mrtStations from both eligibility checks when their real geometryType is not point/multipoint", () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.touristAttractionLayer.geometryType = "polygon";
    engine.mrtStationLayer.geometryType = "polygon";

    expect(engine.heatmapEligibleSourceLayers()).toEqual([]);

    const layers = engine.getLayers();
    expect(layers.find((l) => l.id === "touristAttractions").styleGroups[0].heatmapEligible).toBe(false);
    expect(layers.find((l) => l.id === "mrtStations").styleGroups[0].heatmapEligible).toBe(false);
  });

  test("includes touristAttractions/mrtStations once their real geometryType is confirmed point/multipoint", () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.touristAttractionLayer.geometryType = "point";
    engine.mrtStationLayer.geometryType = "multipoint";

    const ids = engine.heatmapEligibleSourceLayers().map((l) => l.id);
    expect(ids).toEqual(["touristAttractions", "mrtStations"]);

    const layers = engine.getLayers();
    expect(layers.find((l) => l.id === "touristAttractions").styleGroups[0].heatmapEligible).toBe(true);
    expect(layers.find((l) => l.id === "mrtStations").styleGroups[0].heatmapEligible).toBe(true);
  });

  test("createHeatmapLayer rejects touristAttractions as a source once its real geometryType is confirmed non-point", () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.touristAttractionLayer.geometryType = "polygon";

    expect(() => engine.createHeatmapLayer("touristAttractions", { name: "Density" })).toThrow(
      "Choose a point layer"
    );
  });

  test("attachToView refreshes the layer list once touristAttractions/mrtStations finish loading, so eligibility isn't stuck reflecting an unloaded (geometryType-less) state", async () => {
    const engine = new GISMapEngine();
    const onDrawingsChanged = jest.fn();
    engine.setOnDrawingsChanged(onDrawingsChanged);

    engine.attachToView(makeView());
    expect(onDrawingsChanged).not.toHaveBeenCalled();

    await Promise.resolve();
    await Promise.resolve();

    expect(onDrawingsChanged).toHaveBeenCalled();
  });

  test("createHeatmapLayer throws when given no name", () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    expect(() => engine.createHeatmapLayer("touristAttractions", { name: "  " })).toThrow(
      "Please give the heatmap layer a name."
    );
  });

  test("createHeatmapLayer throws for an ineligible/unknown source", () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    expect(() => engine.createHeatmapLayer("mrtLines", { name: "My Heatmap" })).toThrow(
      "Choose a point layer"
    );
  });

  test("createHeatmapLayer registers a named, removable layer with a heatmap renderer, appends it to layerOrder, and adds it to an attached map", () => {
    const engine = new GISMapEngine();
    const view = makeView();
    engine.attachToView(view);
    engine.touristAttractionLayer.geometryType = "point";

    const { id, name } = engine.createHeatmapLayer("touristAttractions", { name: "Attraction Density", intensity: 70 });

    expect(name).toBe("Attraction Density");
    expect(engine.layerOrder).toContain(id);
    const layer = engine.heatmapLayers.get(id);
    expect(layer.url).toBe(engine.touristAttractionLayer.url);
    expect(layer.title).toBe("Attraction Density");
    expect(layer.renderer.type).toBe("heatmap");
    expect(layer.renderer.maxPixelIntensity).toBe(70);
    expect(view.map.add).toHaveBeenCalledWith(layer);

    const rows = engine.getLayers();
    const row = rows.find((l) => l.id === id);
    expect(row).toMatchObject({ name: "Attraction Density", removable: true, heatmap: true, heatmapIntensity: 70 });
  });

  // Renderer availability timing (see the identical fix/comment on portal
  // layers, and resyncHeatmapRendererOnceRendered's own comment): a heatmap
  // renderer assigned in the FeatureLayer constructor is computed against
  // whatever data has arrived by that first paint, and - unlike a live
  // simple renderer - does not keep recomputing on its own as more features
  // stream in. The map then keeps showing that stale, undercounted surface
  // (visibly thinner/more yellow than it should be) until something
  // reassigns `.renderer` again - which is why it only ever "corrected
  // itself" once a user touched the intensity slider, never just by
  // waiting. `FeatureLayer.load()` resolving is NOT a reliable fix for
  // this: it only means the service's metadata arrived, not that the view
  // has actually queried/rendered the layer's features - an earlier version
  // of this fix used `.load()` and still reproduced the bug. The real
  // signal is the LayerView's own `updating` flag going false.
  test("does not reassign the renderer until the LayerView's own `updating` flag goes false - `.load()`/layer construction finishing is not enough", async () => {
    const engine = new GISMapEngine();
    let updatingCallback;
    const layerView = {
      updating: true,
      watch: jest.fn((prop, cb) => {
        updatingCallback = cb;
        return { remove: jest.fn() };
      })
    };
    const view = makeView();
    view.whenLayerView = jest.fn().mockResolvedValue(layerView);
    engine.attachToView(view);
    engine.touristAttractionLayer.geometryType = "point";

    const { id } = engine.createHeatmapLayer("touristAttractions", { name: "Density", intensity: 70 });
    const layer = engine.heatmapLayers.get(id);
    const rendererBeforeReady = layer.renderer;

    // Flush the whenLayerView() promise's microtask.
    await Promise.resolve();
    await Promise.resolve();
    expect(layer.renderer).toBe(rendererBeforeReady);

    // The LayerView finishes its initial query/render pass.
    layerView.updating = false;
    updatingCallback(false);

    expect(layer.renderer).not.toBe(rendererBeforeReady);
    expect(layer.renderer.maxPixelIntensity).toBe(70);
  });

  // getLayers()'s heatmapUpdating flag (see resyncHeatmapRendererOnceRendered/
  // heatmapLayerUpdating) is what LayerControlPanel shows a "Rendering…"
  // indicator off of - it must be true from the moment the layer exists
  // until the LayerView actually finishes its initial query, and it must
  // also flip back to false and notify onDrawingsChanged when that happens,
  // or the indicator would either never show or get stuck showing forever.
  test("getLayers() reports heatmapUpdating true until the LayerView settles, then false, and calls onDrawingsChanged on the transition", async () => {
    const engine = new GISMapEngine();
    let updatingCallback;
    const layerView = {
      updating: true,
      watch: jest.fn((prop, cb) => {
        updatingCallback = cb;
        return { remove: jest.fn() };
      })
    };
    const view = makeView();
    view.whenLayerView = jest.fn().mockResolvedValue(layerView);
    engine.attachToView(view);
    engine.touristAttractionLayer.geometryType = "point";

    const onDrawingsChanged = jest.fn();
    engine.setOnDrawingsChanged(onDrawingsChanged);

    const { id } = engine.createHeatmapLayer("touristAttractions", { name: "Density", intensity: 70 });
    expect(engine.getLayers().find((l) => l.id === id).heatmapUpdating).toBe(true);

    await Promise.resolve();
    await Promise.resolve();
    expect(engine.getLayers().find((l) => l.id === id).heatmapUpdating).toBe(true);
    // attachToView's own unrelated load-timing calls (see its
    // touristAttractionLayer/mrtStationLayer .load().then() calls) may
    // already have fired onDrawingsChanged by this point - what matters is
    // that settling THIS layer's resync fires at least one more.
    const callsBeforeSettle = onDrawingsChanged.mock.calls.length;

    layerView.updating = false;
    updatingCallback(false);

    expect(engine.getLayers().find((l) => l.id === id).heatmapUpdating).toBe(false);
    expect(onDrawingsChanged.mock.calls.length).toBeGreaterThan(callsBeforeSettle);
  });

  test("heatmapUpdating settles to false even when whenLayerView never resolves a usable LayerView (e.g. the layer got removed mid-wait)", async () => {
    const engine = new GISMapEngine();
    const view = makeView();
    view.whenLayerView = jest.fn().mockResolvedValue(null);
    engine.attachToView(view);
    engine.touristAttractionLayer.geometryType = "point";

    const { id } = engine.createHeatmapLayer("touristAttractions", { name: "Density" });
    expect(engine.getLayers().find((l) => l.id === id).heatmapUpdating).toBe(true);

    await Promise.resolve();
    await Promise.resolve();

    expect(engine.getLayers().find((l) => l.id === id).heatmapUpdating).toBe(false);
  });

  test("updateHeatmapLayerIntensity rebuilds and reassigns the renderer, and persists to meta", () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.touristAttractionLayer.geometryType = "point";
    const { id } = engine.createHeatmapLayer("touristAttractions", { name: "Density", intensity: 50 });

    engine.updateHeatmapLayerIntensity(id, 90);

    expect(engine.heatmapLayers.get(id).renderer.maxPixelIntensity).toBe(90);
    expect(engine.heatmapLayerMeta.get(id).intensity).toBe(90);
  });

  test("removeHeatmapLayer removes it from the map, layerOrder, and internal maps", () => {
    const engine = new GISMapEngine();
    const view = makeView();
    engine.attachToView(view);
    engine.touristAttractionLayer.geometryType = "point";
    const { id } = engine.createHeatmapLayer("touristAttractions", { name: "Density" });
    const layer = engine.heatmapLayers.get(id);

    engine.removeHeatmapLayer(id);

    expect(view.map.remove).toHaveBeenCalledWith(layer);
    expect(engine.heatmapLayers.has(id)).toBe(false);
    expect(engine.heatmapLayerMeta.has(id)).toBe(false);
    expect(engine.layerOrder).not.toContain(id);
  });

  test("removeHeatmapLayer is a no-op for an id it didn't add", () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    expect(() => engine.removeHeatmapLayer("touristAttractions")).not.toThrow();
    expect(engine.touristAttractionLayer).toBeTruthy();
  });

  test("survives a 2D/3D reattachment with its url/title/intensity/visibility intact", () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.touristAttractionLayer.geometryType = "point";
    const { id } = engine.createHeatmapLayer("touristAttractions", { name: "Density", intensity: 65 });
    engine.toggleLayer(id);

    engine.attachToView(makeView());

    const layer = engine.heatmapLayers.get(id);
    expect(layer.title).toBe("Density");
    expect(layer.url).toBe(engine.touristAttractionLayer.url);
    expect(layer.renderer.maxPixelIntensity).toBe(65);
    expect(layer.visible).toBe(false);
  });

  test("the freshly rebuilt layer on a 2D/3D reattachment (or project load) also waits for its LayerView before reassigning, same as at creation", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.touristAttractionLayer.geometryType = "point";
    const { id } = engine.createHeatmapLayer("touristAttractions", { name: "Density", intensity: 65 });

    let updatingCallback;
    const layerView = {
      updating: true,
      watch: jest.fn((prop, cb) => {
        updatingCallback = cb;
        return { remove: jest.fn() };
      })
    };
    const view = makeView();
    view.whenLayerView = jest.fn().mockResolvedValue(layerView);
    engine.attachToView(view);

    const rebuilt = engine.heatmapLayers.get(id);
    const rendererBeforeReady = rebuilt.renderer;

    await Promise.resolve();
    await Promise.resolve();
    expect(rebuilt.renderer).toBe(rendererBeforeReady);

    layerView.updating = false;
    updatingCallback(false);

    expect(rebuilt.renderer).not.toBe(rendererBeforeReady);
    expect(rebuilt.renderer.maxPixelIntensity).toBe(65);
  });
});

describe("GISMapEngine.zoomToPoint", () => {
  test("is a no-op when there is no current view", async () => {
    const engine = new GISMapEngine();
    await expect(engine.zoomToPoint(103.8, 1.3)).resolves.toBeUndefined();
    expect(engine.searchGraphic).toBeNull();
  });

  test("drops a marker on searchLayer and zooms to the geocoded point", async () => {
    const engine = new GISMapEngine();
    const view = makeView();
    engine.attachToView(view);

    await engine.zoomToPoint(103.8198, 1.3521);

    expect(engine.searchGraphic).not.toBeNull();
    expect(engine.searchGraphic.geometry).toEqual({
      type: "point",
      longitude: 103.8198,
      latitude: 1.3521,
      spatialReference: { wkid: 4326 }
    });
    expect(engine.searchLayer.graphics.toArray()).toEqual([engine.searchGraphic]);
    // Regression guard: goTo's `target` must be the real Graphic/Point
    // instance, not a plain `{ type: "point", ... }` JSON object - the SDK
    // does not coerce plain objects here (unlike Graphic's own `geometry`
    // setter), so passing raw JSON silently fails to navigate.
    expect(view.goTo).toHaveBeenCalledWith({
      target: engine.searchGraphic,
      zoom: 15
    });
  });

  test("replaces the previous marker instead of accumulating one per search", async () => {
    const engine = new GISMapEngine();
    const view = makeView();
    engine.attachToView(view);

    await engine.zoomToPoint(103.8, 1.3);
    await engine.zoomToPoint(104.0, 1.4);

    expect(engine.searchLayer.graphics.toArray()).toHaveLength(1);
    expect(engine.searchGraphic.geometry.longitude).toBe(104.0);
  });

  test("marker survives reattachment (e.g. a 2D/3D switch)", async () => {
    const engine = new GISMapEngine();
    const view1 = makeView();
    engine.attachToView(view1);
    await engine.zoomToPoint(103.8, 1.3);

    const view2 = makeView();
    engine.attachToView(view2);

    expect(engine.searchLayer.graphics.toArray()).toEqual([engine.searchGraphic]);
  });

  test("swallows a goTo rejection instead of throwing", async () => {
    const engine = new GISMapEngine();
    const view = makeView();
    view.goTo = jest.fn().mockRejectedValue(new Error("interrupted"));
    engine.attachToView(view);

    await expect(engine.zoomToPoint(103.8, 1.3)).resolves.toBeUndefined();
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

  test("refuses a read-only hosted layer instead of letting applyEdits trigger a sign-in prompt", async () => {
    // The hosted services are published Query-only, so applyEdits returns
    // 403 and IdentityManager answers a 403 by opening its own sign-in
    // modal. Checking the advertised capabilities first keeps that from
    // ever being reached, so an anonymous user gets a toast, not a login.
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.selectedLayerId = "touristAttractions";
    engine.selectedGraphic = { attributes: { OBJECTID: 7 } };
    engine.touristAttractionLayer.title = "Tourist Attractions";
    engine.touristAttractionLayer.capabilities = { operations: { supportsUpdate: false } };

    await expect(engine.updateSelectedFeatureAttributes({ name: "x" })).rejects.toThrow(
      '"Tourist Attractions" is read-only for the current user.'
    );
    expect(engine.touristAttractionLayer.applyEdits).not.toHaveBeenCalled();
  });

  test("still edits when the layer advertises update support", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.selectedLayerId = "touristAttractions";
    engine.selectedGraphic = { attributes: { OBJECTID: 7, name: "old" } };
    engine.touristAttractionLayer.objectIdField = "OBJECTID";
    engine.touristAttractionLayer.capabilities = { operations: { supportsUpdate: true } };
    engine.touristAttractionLayer.applyEdits.mockResolvedValue({ updateFeatureResults: [{}] });

    await expect(
      engine.updateSelectedFeatureAttributes({ name: "new" })
    ).resolves.toEqual({ success: true, attributes: { OBJECTID: 7, name: "new" } });
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

  test("does not force a sign-in when nobody is signed in", async () => {
    // Regression test: addColumnToLayer used to call getCredential()
    // unconditionally, which opens IdentityManager's own sign-in modal when
    // no credential exists - forcing a login on an app that must stay usable
    // anonymously. It must fail with a plain error instead.
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    IdentityManager.findCredential.mockReturnValue(undefined);
    IdentityManager.getCredential.mockClear();

    await expect(engine.addColumnToLayer("touristAttractions", "newField")).rejects.toThrow(
      "Sign in with an account that owns this layer to add a column."
    );
    expect(IdentityManager.getCredential).not.toHaveBeenCalled();
    expect(esriRequest).not.toHaveBeenCalled();
  });

  test("adds a field to a hosted layer via addToDefinition and refreshes it", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.touristAttractionLayer.url = "https://example.com/FeatureServer";
    IdentityManager.findCredential.mockReturnValue({ token: "mock-token" });
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
    IdentityManager.findCredential.mockReturnValue({ token: "mock-token" });
    esriRequest.mockResolvedValueOnce({ data: { error: { message: "Not authorized" } } });

    await expect(
      engine.addColumnToLayer("touristAttractions", "newField")
    ).rejects.toThrow("Not authorized");
    expect(engine.touristAttractionLayer.refresh).not.toHaveBeenCalled();
  });

  test("falls back to a generic message when addToDefinition fails without one", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    IdentityManager.findCredential.mockReturnValue({ token: "mock-token" });
    esriRequest.mockResolvedValueOnce({ data: { error: {} } });

    await expect(engine.addColumnToLayer("touristAttractions", "newField")).rejects.toThrow(
      "Failed to add column to layer."
    );
  });

  test("falls back to the portal credential when there is no per-service one", async () => {
    // An ArcGIS Online sign-in registers a credential for the portal, which
    // federates to hosted services, rather than one per service URL. Looking
    // only at the service URL would wrongly block a genuinely signed-in user.
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.touristAttractionLayer.url = "https://example.com/FeatureServer";
    IdentityManager.findCredential.mockImplementation((url) =>
      url.includes("/sharing") ? { token: "portal-token" } : undefined
    );
    esriRequest.mockResolvedValueOnce({ data: {} });

    await expect(
      engine.addColumnToLayer("touristAttractions", "newField")
    ).resolves.toEqual({ success: true });

    IdentityManager.findCredential.mockReset();
    IdentityManager.findCredential.mockReturnValue(undefined);
  });

  test("posts to the ADMIN catalog, at the layer level, with a numeric layer id", async () => {
    // Regression: the public "/rest/services/" path has no addToDefinition
    // route on ArcGIS Online (its router answers with a generic "Cannot
    // perform query. Invalid query parameters."), and a `layerId` parsed off
    // a URL arrives as the string "0", which AGOL's own layer lookup crashes
    // on rather than reporting. Both are why "+ Add Column" failed with an
    // error that pointed nowhere near the cause.
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.portalLayers.set("portal_1", {
      url: "https://services1.arcgis.com/abc/arcgis/rest/services/My_Layer/FeatureServer/0",
      layerId: "0",
      fields: [],
      refresh: jest.fn().mockResolvedValue(undefined)
    });
    IdentityManager.findCredential.mockReturnValue({ token: "mock-token" });
    esriRequest.mockResolvedValueOnce({ data: {} });

    await engine.addColumnToLayer("portal_1", "status");

    expect(esriRequest).toHaveBeenCalledWith(
      "https://services1.arcgis.com/abc/arcgis/rest/admin/services/My_Layer/FeatureServer/0/addToDefinition",
      expect.objectContaining({ method: "post" })
    );
  });

  test("declares a length on a string column", async () => {
    // A text column with no width is rejected by the definition merge, which
    // surfaces as the same opaque "Unable to add feature service definition."
    // every other malformed request produces.
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    IdentityManager.findCredential.mockReturnValue({ token: "mock-token" });
    esriRequest.mockResolvedValueOnce({ data: {} });

    await engine.addColumnToLayer("touristAttractions", "status", "esriFieldTypeString", "");

    const sent = JSON.parse(esriRequest.mock.calls[0][1].body.get("addToDefinition"));
    expect(sent.fields[0]).toMatchObject({ name: "status", length: 255 });
    // A blank default-value input means "no default", not "the empty string".
    expect(sent.fields[0].defaultValue).toBeNull();
  });

  test("rejects a column name a hosted service can't use as a database column", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    IdentityManager.findCredential.mockReturnValue({ token: "mock-token" });

    await expect(
      engine.addColumnToLayer("touristAttractions", "my column")
    ).rejects.toThrow("is not a valid column name");
    expect(esriRequest).not.toHaveBeenCalled();
  });

  test("rejects a column the hosted layer already has", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.touristAttractionLayer.fields = [{ name: "Status" }];
    IdentityManager.findCredential.mockReturnValue({ token: "mock-token" });

    await expect(engine.addColumnToLayer("touristAttractions", "status")).rejects.toThrow(
      'Column "status" already exists.'
    );
    expect(esriRequest).not.toHaveBeenCalled();
  });

  test("surfaces `details` when the service error carries an empty message", async () => {
    // ArcGIS Online answers some failed definition changes with message: ""
    // and the real explanation only in details; `message || fallback` threw
    // the one useful string away.
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    IdentityManager.findCredential.mockReturnValue({ token: "mock-token" });
    esriRequest.mockResolvedValueOnce({
      data: { error: { message: "", details: ["Invalid definition for field."] } }
    });

    await expect(engine.addColumnToLayer("touristAttractions", "newField")).rejects.toThrow(
      "Invalid definition for field."
    );
  });
});

describe("GISMapEngine.deleteColumnFromLayer", () => {
  test("requires a field name", async () => {
    const engine = new GISMapEngine();
    await expect(engine.deleteColumnFromLayer("drawings", "")).rejects.toThrow(
      "Field name is required."
    );
  });

  test("removes a drawings column from the schema and from every graphic", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.drawingFields = [{ name: "status", type: "esriFieldTypeString", defaultValue: null }];
    engine.drawLayer.add({ symbol: {}, attributes: { status: "a", note: "keep" } });

    const result = await engine.deleteColumnFromLayer("drawings", "status");

    expect(result).toEqual({ success: true });
    expect(engine.drawingFields).toEqual([]);
    expect(engine.drawLayer.graphics.toArray()[0].attributes).toEqual({ note: "keep" });
  });

  test("removes an uploaded-GeoJSON property that was never a formal drawings column", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.drawLayer.add({ symbol: {}, attributes: { imported: "x" } });

    await expect(engine.deleteColumnFromLayer("drawings", "imported")).resolves.toEqual({
      success: true
    });
    expect(engine.drawLayer.graphics.toArray()[0].attributes).toEqual({});
  });

  test("throws for a drawings column that exists nowhere", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());

    await expect(engine.deleteColumnFromLayer("drawings", "ghost")).rejects.toThrow(
      'Column "ghost" does not exist.'
    );
  });

  test("throws when the hosted layer can't be resolved", async () => {
    const engine = new GISMapEngine();
    await expect(engine.deleteColumnFromLayer("unknown-layer", "field")).rejects.toThrow(
      "Layer not found."
    );
  });

  test("refuses to delete the object id field", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    IdentityManager.findCredential.mockReturnValue({ token: "mock-token" });

    await expect(
      engine.deleteColumnFromLayer("touristAttractions", "OBJECTID")
    ).rejects.toThrow("identifies each feature and cannot be deleted.");
    expect(esriRequest).not.toHaveBeenCalled();
  });

  test("does not force a sign-in when nobody is signed in", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    IdentityManager.findCredential.mockReturnValue(undefined);

    await expect(engine.deleteColumnFromLayer("touristAttractions", "note")).rejects.toThrow(
      "Sign in with an account that owns this layer to delete a column."
    );
    expect(IdentityManager.getCredential).not.toHaveBeenCalled();
    expect(esriRequest).not.toHaveBeenCalled();
  });

  test("posts deleteFromDefinition to the admin layer URL and refreshes the layer", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.touristAttractionLayer.url =
      "https://services1.arcgis.com/abc/arcgis/rest/services/My_Layer/FeatureServer";
    IdentityManager.findCredential.mockReturnValue({ token: "mock-token" });
    esriRequest.mockResolvedValueOnce({ data: {} });

    const result = await engine.deleteColumnFromLayer("touristAttractions", "note");

    expect(esriRequest).toHaveBeenCalledWith(
      "https://services1.arcgis.com/abc/arcgis/rest/admin/services/My_Layer/FeatureServer/0/deleteFromDefinition",
      expect.objectContaining({ method: "post", responseType: "json" })
    );
    const sent = JSON.parse(esriRequest.mock.calls[0][1].body.get("deleteFromDefinition"));
    expect(sent).toEqual({ fields: [{ name: "note" }] });
    expect(engine.touristAttractionLayer.refresh).toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  test("drops the deleted key off the cached selected graphic", async () => {
    // layer.refresh() requeries the service, but the graphic cached from the
    // last hitTest keeps the attributes it was selected with - so re-opening
    // the panel would still list the column that was just dropped.
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.selectedLayerId = "touristAttractions";
    engine.selectedGraphic = { attributes: { OBJECTID: 1, note: "gone" } };
    IdentityManager.findCredential.mockReturnValue({ token: "mock-token" });
    esriRequest.mockResolvedValueOnce({ data: {} });

    await engine.deleteColumnFromLayer("touristAttractions", "note");

    expect(engine.selectedGraphic.attributes).toEqual({ OBJECTID: 1 });
  });

  test("throws the service error message when deleteFromDefinition fails", async () => {
    const engine = new GISMapEngine();
    engine.attachToView(makeView());
    IdentityManager.findCredential.mockReturnValue({ token: "mock-token" });
    esriRequest.mockResolvedValueOnce({ data: { error: { message: "Not authorized" } } });

    await expect(
      engine.deleteColumnFromLayer("touristAttractions", "note")
    ).rejects.toThrow("Not authorized");
    expect(engine.touristAttractionLayer.refresh).not.toHaveBeenCalled();
  });
});

describe("GISMapEngine Filter & Aggregate System", () => {
  let engine;

  beforeEach(() => {
    engine = new GISMapEngine();
    engine.attachToView(makeView());
    engine.touristAttractionLayer.fields = [
      { name: "NAME", type: "esriFieldTypeString" },
      { name: "RATING", type: "esriFieldTypeDouble" }
    ];
  });

  describe("getFilterableLayers / filterableLayerIds", () => {
    test("excludes route/stops/searchResult and includes the hosted + drawings layers", () => {
      const ids = engine.getFilterableLayers().map((l) => l.id);
      expect(ids).toEqual(["touristAttractions", "mrtStations", "mrtLines", "drawings"]);
    });

    test("includes portal-added layers once they exist", async () => {
      await engine.addPortalLayer({ id: "abc", title: "Extra Layer", url: "https://example.com/0" });
      const ids = engine.getFilterableLayers().map((l) => l.id);
      expect(ids).toContain("portal_abc");
    });
  });

  describe("getLayerFieldSchema", () => {
    test("loads and normalizes a hosted FeatureLayer's fields", async () => {
      const { fields } = await engine.getLayerFieldSchema("touristAttractions");
      expect(engine.touristAttractionLayer.load).toHaveBeenCalled();
      expect(fields).toEqual([
        { name: "NAME", kind: "string" },
        { name: "RATING", kind: "number" }
      ]);
    });

    test("returns an empty field list for an unknown layer id", async () => {
      expect(await engine.getLayerFieldSchema("unknown")).toEqual({ fields: [] });
    });

    test("derives the drawings schema from drawingFields plus attributes found on graphics", async () => {
      engine.drawingFields = [{ name: "label", type: "esriFieldTypeString" }];
      engine.drawLayer.add({ symbol: { type: "simple-marker" }, attributes: { label: "a", count: 3 } });

      const { fields } = await engine.getLayerFieldSchema("drawings");
      expect(fields).toEqual(
        expect.arrayContaining([
          { name: "label", kind: "string" },
          { name: "count", kind: "number" }
        ])
      );
    });
  });

  describe("setLayerFilter / clearLayerFilter on a hosted FeatureLayer", () => {
    test("sets definitionExpression and reports the filter as active", async () => {
      const result = await engine.setLayerFilter("touristAttractions", {
        conditions: [{ field: "RATING", operator: ">=", value: "4" }],
        logic: "AND"
      });

      expect(result).toEqual({ active: true, description: "RATING at least 4" });
      expect(engine.touristAttractionLayer.definitionExpression).toBe("(RATING >= 4)");
      expect(engine.getLayerFilterDescription("touristAttractions")).toBe("RATING at least 4");
    });

    test("an empty/unusable filter clears definitionExpression instead of throwing", async () => {
      await engine.setLayerFilter("touristAttractions", {
        conditions: [{ field: "RATING", operator: ">=", value: "4" }]
      });
      const result = await engine.setLayerFilter("touristAttractions", { conditions: [] });

      expect(result).toEqual({ active: false, description: "" });
      expect(engine.touristAttractionLayer.definitionExpression).toBeNull();
      expect(engine.getLayerFilterDescription("touristAttractions")).toBeNull();
    });

    test("throws and does not store the filter when a condition is invalid", async () => {
      await expect(
        engine.setLayerFilter("touristAttractions", {
          conditions: [{ field: "RATING", operator: "=", value: "not-a-number" }]
        })
      ).rejects.toThrow(/not a valid number/);
      expect(engine.touristAttractionLayer.definitionExpression).toBeNull();
      expect(engine.getLayerFilterDescription("touristAttractions")).toBeNull();
    });

    test("clearLayerFilter removes an active filter", async () => {
      await engine.setLayerFilter("touristAttractions", {
        conditions: [{ field: "RATING", operator: ">=", value: "4" }]
      });
      engine.clearLayerFilter("touristAttractions");

      expect(engine.touristAttractionLayer.definitionExpression).toBeNull();
      expect(engine.getLayerFilterDescription("touristAttractions")).toBeNull();
    });
  });

  describe("setLayerFilter / clearLayerFilter on drawings", () => {
    test("hides graphics that don't match and shows those that do", async () => {
      const a = { symbol: { type: "simple-marker" }, attributes: { RATING: 5 } };
      const b = { symbol: { type: "simple-marker" }, attributes: { RATING: 1 } };
      engine.drawLayer.add(a);
      engine.drawLayer.add(b);

      await engine.setLayerFilter("drawings", {
        conditions: [{ field: "RATING", operator: ">=", value: "4" }]
      });

      expect(a.visible).toBe(true);
      expect(b.visible).toBe(false);
    });

    test("clearing the drawings filter makes every graphic visible again", async () => {
      const a = { symbol: { type: "simple-marker" }, attributes: { RATING: 1 } };
      engine.drawLayer.add(a);
      await engine.setLayerFilter("drawings", {
        conditions: [{ field: "RATING", operator: ">=", value: "4" }]
      });
      expect(a.visible).toBe(false);

      engine.clearLayerFilter("drawings");
      expect(a.visible).toBe(true);
    });

    test("a newly completed sketch is filtered against the active drawings filter", async () => {
      engine.drawingFields = [{ name: "RATING", type: "esriFieldTypeDouble" }];
      await engine.setLayerFilter("drawings", {
        conditions: [{ field: "RATING", operator: ">=", value: "4" }]
      });

      const lowRatedGraphic = { attributes: undefined };
      engine.sketchVM.emit("create", { state: "complete", graphic: lowRatedGraphic });
      expect(lowRatedGraphic.visible).toBe(false);
    });
  });

  describe("reapplyPersistedFilters", () => {
    test("reapplies a hosted layer's filter to the freshly rebuilt FeatureLayer after a reattachment", async () => {
      await engine.setLayerFilter("touristAttractions", {
        conditions: [{ field: "RATING", operator: ">=", value: "4" }]
      });

      const view2 = makeView();
      engine.attachToView(view2);
      engine.touristAttractionLayer.fields = [
        { name: "NAME", type: "esriFieldTypeString" },
        { name: "RATING", type: "esriFieldTypeDouble" }
      ];

      // reapplyPersistedFilters is fire-and-forget (see attachToView) - flush
      // the microtask queue so its promise chain has settled.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(engine.touristAttractionLayer.definitionExpression).toBe("(RATING >= 4)");
    });

    test("drops a filter that no longer validates against the reloaded schema", async () => {
      await engine.setLayerFilter("touristAttractions", {
        conditions: [{ field: "RATING", operator: ">=", value: "4" }]
      });

      const view2 = makeView();
      engine.attachToView(view2);
      // Simulate a schema that no longer has RATING.
      engine.touristAttractionLayer.fields = [{ name: "NAME", type: "esriFieldTypeString" }];

      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(engine.layerFilters.has("touristAttractions")).toBe(false);
    });
  });

  describe("getLayerAggregate", () => {
    test("aggregates a hosted layer via queryFeatureCount/queryFeatures, respecting the active filter", async () => {
      engine.touristAttractionLayer.definitionExpression = null;
      await engine.setLayerFilter("touristAttractions", {
        conditions: [{ field: "RATING", operator: ">=", value: "4" }]
      });
      engine.touristAttractionLayer.queryFeatureCount.mockResolvedValue(12);
      engine.touristAttractionLayer.queryFeatures.mockResolvedValue({
        features: [{ attributes: { sum: 48, avg: 4.2 } }]
      });

      const result = await engine.getLayerAggregate("touristAttractions", {
        field: "RATING",
        statistics: ["sum", "avg"]
      });

      expect(engine.touristAttractionLayer.queryFeatureCount).toHaveBeenCalledWith({
        where: "(RATING >= 4)"
      });
      expect(engine.touristAttractionLayer.queryFeatures).toHaveBeenCalledWith(
        expect.objectContaining({
          where: "(RATING >= 4)",
          outStatistics: [
            { statisticType: "sum", onStatisticField: "RATING", outStatisticFieldName: "sum" },
            { statisticType: "avg", onStatisticField: "RATING", outStatisticFieldName: "avg" }
          ]
        })
      );
      expect(result).toEqual({
        id: "touristAttractions",
        name: "Tourist Attractions",
        count: 12,
        stats: { sum: 48, avg: 4.2 }
      });
    });

    test("aggregates only a count when no field/statistics are given", async () => {
      engine.touristAttractionLayer.queryFeatureCount.mockResolvedValue(5);
      const result = await engine.getLayerAggregate("touristAttractions", {});
      expect(result).toEqual({ id: "touristAttractions", name: "Tourist Attractions", count: 5, stats: {} });
      expect(engine.touristAttractionLayer.queryFeatures).not.toHaveBeenCalled();
    });

    test("aggregates the drawings layer client-side over graphics matching the active filter", async () => {
      engine.drawLayer.add({ symbol: { type: "simple-marker" }, attributes: { RATING: 5 } });
      engine.drawLayer.add({ symbol: { type: "simple-marker" }, attributes: { RATING: 2 } });
      engine.drawLayer.add({ symbol: { type: "simple-marker" }, attributes: { RATING: 4 } });

      await engine.setLayerFilter("drawings", {
        conditions: [{ field: "RATING", operator: ">=", value: "4" }]
      });

      const result = await engine.getLayerAggregate("drawings", {
        field: "RATING",
        statistics: ["sum", "avg", "min", "max"]
      });

      expect(result).toEqual({
        id: "drawings",
        name: "Drawings",
        count: 2,
        stats: { sum: 9, avg: 4.5, min: 4, max: 5 }
      });
    });

    test("returns a zeroed result for an unknown layer id instead of throwing", async () => {
      await expect(engine.getLayerAggregate("unknown")).resolves.toEqual({
        id: "unknown",
        name: "unknown",
        count: 0,
        stats: {}
      });
    });
  });

  describe("runAnalysis", () => {
    test("combines per-layer aggregates into a grand total", async () => {
      engine.touristAttractionLayer.queryFeatureCount.mockResolvedValue(10);
      engine.touristAttractionLayer.queryFeatures.mockResolvedValue({
        features: [{ attributes: { sum: 40 } }]
      });
      engine.drawLayer.add({ symbol: { type: "simple-marker" }, attributes: { RATING: 5 } });
      engine.drawLayer.add({ symbol: { type: "simple-marker" }, attributes: { RATING: 3 } });

      const { perLayer, total } = await engine.runAnalysis(["touristAttractions", "drawings"], {
        field: "RATING",
        statistics: ["sum"]
      });

      expect(perLayer.map((l) => l.id)).toEqual(["touristAttractions", "drawings"]);
      expect(total.count).toBe(12);
      expect(total.sum).toBe(48);
      expect(total.avg).toBe(4);
    });
  });
});

describe("GISMapEngine Advanced Renderer System", () => {
  let engine;
  beforeEach(() => {
    engine = new GISMapEngine();
    engine.attachToView(makeView());
  });

  describe("setLayerAdvancedRenderer", () => {
    test("throws on a field that doesn't exist on the layer's schema", async () => {
      engine.touristAttractionLayer.fields = [{ name: "NAME", type: "esriFieldTypeString" }];
      await expect(
        engine.setLayerAdvancedRenderer("touristAttractions", { type: "unique-value", field: "NOPE" })
      ).rejects.toThrow('"NOPE" is not a field on this layer.');
    });

    test("throws on an unknown renderer type", async () => {
      engine.touristAttractionLayer.fields = [{ name: "CATEGORY", type: "esriFieldTypeString" }];
      await expect(
        engine.setLayerAdvancedRenderer("touristAttractions", { type: "bogus", field: "CATEGORY" })
      ).rejects.toThrow('Unknown renderer type "bogus".');
    });

    test("generates and applies a unique-value renderer for a hosted layer", async () => {
      engine.touristAttractionLayer.fields = [{ name: "CATEGORY", type: "esriFieldTypeString" }];
      engine.touristAttractionLayer.queryFeatures.mockResolvedValue({
        features: [{ attributes: { CATEGORY: "Museum" } }, { attributes: { CATEGORY: "Park" } }]
      });

      const result = await engine.setLayerAdvancedRenderer("touristAttractions", {
        type: "unique-value",
        field: "CATEGORY"
      });

      expect(result.rendererType).toBe("unique-value");
      expect(engine.touristAttractionLayer.renderer.type).toBe("unique-value");
      expect(engine.touristAttractionLayer.renderer.uniqueValueInfos).toHaveLength(2);
      // The persisted simple base must stay untouched, so Simple mode can be
      // restored later without losing the last plain color/border edit.
      expect(engine.touristAttractionRenderer.type).not.toBe("unique-value");
    });

    test("getLayers() reports the active renderer for a non-drawings layer, and clearing it actually reverts the live renderer", async () => {
      // Regression: RendererControls always sends `symbolType: group.symbolType`
      // to setLayerAdvancedRenderer, including for non-drawings layers, where
      // it isn't meaningful. If that leaked into the stored descriptor,
      // attachRendererInfo's "is this the active renderer" comparison against
      // the (correctly undefined) symbolType getLayers() passes for
      // non-drawings layers would fail, so getLayers() would report
      // rendererType "simple" even with an advanced renderer live on the
      // map - and the panel's "Simple" button would then skip calling
      // clearLayerAdvancedRenderer entirely, believing it was already Simple.
      engine.touristAttractionLayer.fields = [{ name: "CATEGORY", type: "esriFieldTypeString" }];
      engine.touristAttractionLayer.queryFeatures.mockResolvedValue({
        features: [{ attributes: { CATEGORY: "Museum" } }]
      });

      await engine.setLayerAdvancedRenderer("touristAttractions", {
        type: "unique-value",
        field: "CATEGORY",
        symbolType: "simple-marker" // what the UI actually sends for every layer, not just drawings
      });

      const group = engine.getLayers().find((l) => l.id === "touristAttractions").styleGroups[0];
      expect(group.rendererType).toBe("unique-value");
      expect(group.rendererLegend).toHaveLength(1);

      engine.clearLayerAdvancedRenderer("touristAttractions");

      expect(engine.getLayers().find((l) => l.id === "touristAttractions").styleGroups[0].rendererType).toBe("simple");
      expect(engine.touristAttractionLayer.renderer.type).not.toBe("unique-value");
    });

    test("regenerating a renderer a second time does not throw (base symbol must not be read off the now-advanced live renderer)", async () => {
      engine.touristAttractionLayer.fields = [
        { name: "CATEGORY", type: "esriFieldTypeString" },
        { name: "TYPE", type: "esriFieldTypeString" }
      ];
      engine.touristAttractionLayer.queryFeatures.mockResolvedValue({
        features: [{ attributes: { CATEGORY: "Museum", TYPE: "Indoor" } }]
      });

      await engine.setLayerAdvancedRenderer("touristAttractions", { type: "unique-value", field: "CATEGORY" });
      // At this point the live layer's renderer is already a unique-value
      // renderer with no top-level `.symbol` - getBaseSymbolForLayer must not
      // read from it directly.
      await expect(
        engine.setLayerAdvancedRenderer("touristAttractions", { type: "unique-value", field: "TYPE" })
      ).resolves.toBeDefined();

      expect(engine.touristAttractionLayer.renderer.field).toBe("TYPE");
    });

    test("generates and applies a class-breaks renderer for a hosted layer", async () => {
      engine.mrtStationLayer.fields = [{ name: "RIDERSHIP", type: "esriFieldTypeInteger" }];
      engine.mrtStationLayer.queryFeatures.mockResolvedValue({
        features: [
          { attributes: { RIDERSHIP: 10 } },
          { attributes: { RIDERSHIP: 20 } },
          { attributes: { RIDERSHIP: 30 } }
        ]
      });

      await engine.setLayerAdvancedRenderer("mrtStations", {
        type: "class-breaks",
        field: "RIDERSHIP",
        classCount: 3
      });

      expect(engine.mrtStationLayer.renderer.type).toBe("class-breaks");
      expect(engine.mrtStationLayer.renderer.classBreakInfos).toHaveLength(3);
    });

    test("generates a unique-value renderer for drawings scoped to one symbolType", async () => {
      engine.drawLayer.add(new Graphic({ symbol: { type: "simple-marker", color: "red" }, attributes: { KIND: "A" } }));
      engine.drawLayer.add(new Graphic({ symbol: { type: "simple-marker", color: "red" }, attributes: { KIND: "B" } }));
      engine.drawLayer.add(new Graphic({ symbol: { type: "simple-line", color: "blue" }, attributes: { KIND: "A" } }));

      await engine.setLayerAdvancedRenderer("drawings", {
        type: "unique-value",
        field: "KIND",
        symbolType: "simple-marker"
      });

      const [markerA, markerB, line] = engine.drawLayer.graphics.toArray();
      expect(markerA.symbol.color).not.toBe(markerB.symbol.color);
      // The line graphic is a different symbolType and must be untouched.
      expect(line.symbol.type).toBe("simple-line");
      expect(line.symbol.color).toBe("blue");
    });

    test("throws when the requested symbolType has no matching graphic to base a renderer on yet", async () => {
      engine.drawingFields.push({ name: "KIND", type: "esriFieldTypeString" });
      engine.drawLayer.add(new Graphic({ symbol: { type: "simple-line", color: "blue" }, attributes: { KIND: "A" } }));

      await expect(
        engine.setLayerAdvancedRenderer("drawings", { type: "unique-value", field: "KIND", symbolType: "simple-marker" })
      ).rejects.toThrow("This layer has no symbol to base a renderer on yet.");
    });
  });

  describe("applyDrawingsRendererToGraphic", () => {
    test("colors a graphic according to the active drawings renderer's matching value", async () => {
      engine.drawLayer.add(new Graphic({ symbol: { type: "simple-marker", color: "red" }, attributes: { KIND: "A" } }));
      await engine.setLayerAdvancedRenderer("drawings", { type: "unique-value", field: "KIND", symbolType: "simple-marker" });

      const graphic = new Graphic({ symbol: { type: "simple-marker", color: "red" }, attributes: { KIND: "A" } });
      engine.applyDrawingsRendererToGraphic(graphic);

      expect(graphic.symbol.color).toBe(engine.layerRenderers.get("drawings").uniqueValueInfos[0].symbol.color);
    });

    test("does nothing when no drawings renderer is active", () => {
      const graphic = new Graphic({ symbol: { type: "simple-marker", color: "red" }, attributes: { KIND: "A" } });
      expect(() => engine.applyDrawingsRendererToGraphic(graphic)).not.toThrow();
      expect(graphic.symbol.color).toBe("red");
    });

    test("is invoked when a sketch completes, so a newly-drawn graphic respects an active drawings renderer", async () => {
      engine.drawLayer.add(new Graphic({ symbol: { type: "simple-marker", color: "red" }, attributes: { KIND: "A" } }));
      await engine.setLayerAdvancedRenderer("drawings", { type: "unique-value", field: "KIND", symbolType: "simple-marker" });
      const spy = jest.spyOn(engine, "applyDrawingsRendererToGraphic");

      engine.sketchVM.emit("create", {
        state: "complete",
        graphic: new Graphic({ symbol: { type: "simple-marker", color: "red" }, attributes: {} })
      });

      expect(spy).toHaveBeenCalled();
    });
  });

  describe("clearLayerAdvancedRenderer", () => {
    test("reverts a hosted layer to its persisted simple base renderer", async () => {
      engine.setLayerStyle("touristAttractions", { color: "#ff0000" });
      engine.touristAttractionLayer.fields = [{ name: "CATEGORY", type: "esriFieldTypeString" }];
      engine.touristAttractionLayer.queryFeatures.mockResolvedValue({
        features: [{ attributes: { CATEGORY: "Museum" } }]
      });
      await engine.setLayerAdvancedRenderer("touristAttractions", { type: "unique-value", field: "CATEGORY" });
      expect(engine.touristAttractionLayer.renderer.type).toBe("unique-value");

      engine.clearLayerAdvancedRenderer("touristAttractions");

      expect(engine.touristAttractionLayer.renderer.symbol.color).toBe("#ff0000");
    });

    test("is a no-op revert for drawings (no snapshot to restore)", async () => {
      engine.drawLayer.add(new Graphic({ symbol: { type: "simple-marker", color: "red" }, attributes: { KIND: "A" } }));
      await engine.setLayerAdvancedRenderer("drawings", { type: "unique-value", field: "KIND", symbolType: "simple-marker" });
      expect(() => engine.clearLayerAdvancedRenderer("drawings")).not.toThrow();
      expect(engine.layerRenderers.has("drawings")).toBe(false);
    });
  });

  describe("persistence across reattachment", () => {
    test("an advanced renderer survives a 2D/3D reattachment without requerying", async () => {
      engine.touristAttractionLayer.fields = [{ name: "CATEGORY", type: "esriFieldTypeString" }];
      engine.touristAttractionLayer.queryFeatures.mockResolvedValue({
        features: [{ attributes: { CATEGORY: "Museum" } }]
      });
      await engine.setLayerAdvancedRenderer("touristAttractions", { type: "unique-value", field: "CATEGORY" });

      engine.attachToView(makeView());

      expect(engine.touristAttractionLayer.renderer.type).toBe("unique-value");
      expect(engine.touristAttractionLayer.renderer.field).toBe("CATEGORY");
    });
  });

  describe("halo (multi-layer symbol)", () => {
    test("wraps a simple-marker renderer's live symbol in a two-layer CIM halo composite", () => {
      engine.setLayerStyle("touristAttractions", { color: "#ff0000", halo: true, haloColor: "#ffffff", haloSize: 20 });

      expect(engine.touristAttractionLayer.renderer.symbol.type).toBe("CIMSymbolReference");
      // The persisted simple base stays a plain simple-marker so future edits
      // (and reverting Simple mode) keep working off a clonable symbol.
      expect(engine.touristAttractionRenderer.symbol.type).toBe("simple-marker");
      expect(engine.touristAttractionRenderer.symbol.color).toBe("#ff0000");
    });

    test("halo survives reattachment", () => {
      engine.setLayerStyle("touristAttractions", { halo: true, haloColor: "#ffffff", haloSize: 20 });
      engine.attachToView(makeView());
      expect(engine.touristAttractionLayer.renderer.symbol.type).toBe("CIMSymbolReference");
    });

    test("disabling halo reverts the live renderer to a plain simple-marker symbol", () => {
      engine.setLayerStyle("touristAttractions", { halo: true, haloColor: "#ffffff" });
      engine.setLayerStyle("touristAttractions", { halo: false });
      expect(engine.touristAttractionLayer.renderer.symbol.type).toBe("simple-marker");
    });
  });
});

describe("GISMapEngine Project Persistence (Save/Load Project)", () => {
  function makeFile(text) {
    return { name: "project.json", text: jest.fn().mockResolvedValue(text) };
  }

  describe("buildProjectState", () => {
    test("captures layer order, visibility, and 2D/3D mode", () => {
      const engine = new GISMapEngine();
      const view = makeView();
      view.type = "3d";
      engine.attachToView(view);
      engine.toggleLayer("mrtStations");

      const state = engine.buildProjectState();

      expect(state.version).toBe(1);
      expect(state.is3D).toBe(true);
      expect(state.layerOrder).toEqual(engine.layerOrder);
      expect(state.visibility.mrtStations).toBe(false);
    });

    test("serializes drawings with attributes (unlike saveDrawings' empty properties)", () => {
      const engine = new GISMapEngine();
      engine.attachToView(makeView());
      engine.drawLayer.add(
        new Graphic({
          geometry: { type: "point", x: 1, y: 2 },
          symbol: { type: "simple-marker", color: "red", size: 8, outline: { color: "white", width: 1 } },
          attributes: { name: "Kiosk" }
        })
      );

      const state = engine.buildProjectState();

      expect(state.drawings).toHaveLength(1);
      expect(state.drawings[0]).toEqual({
        geometry: { type: "point", x: 1, y: 2, spatialReference: undefined },
        symbol: {
          type: "simple-marker",
          style: undefined,
          color: "red",
          size: 8,
          outline: { color: "white", width: 1 }
        },
        attributes: { name: "Kiosk" }
      });
    });

    test("serializes Simple-mode layer styling in JS-API dialect (not the type field .toJSON() would produce)", () => {
      const engine = new GISMapEngine();
      engine.attachToView(makeView());
      engine.setLayerStyle("touristAttractions", { color: "#ff0000", borderWidth: 2 });

      const state = engine.buildProjectState();

      expect(state.renderers.touristAttractions).toEqual({
        type: "simple",
        symbol: {
          type: "simple-marker",
          style: undefined,
          color: "#ff0000",
          size: 8,
          outline: { color: [255, 255, 255], width: 2 }
        }
      });
    });

    test("serializes an active filter, annotation, and halo state", async () => {
      const engine = new GISMapEngine();
      engine.attachToView(makeView());
      engine.touristAttractionLayer.fields = [{ name: "NAME", type: "esriFieldTypeString" }];
      await engine.setLayerFilter("touristAttractions", {
        logic: "AND",
        conditions: [{ field: "NAME", operator: "=", value: "Zoo" }]
      });
      await engine.setLayerAnnotation("touristAttractions", "NAME");
      engine.setLayerStyle("touristAttractions", { halo: true, haloColor: "#ffffff", haloSize: 20 });

      const state = engine.buildProjectState();

      expect(state.layerFilters.touristAttractions).toBeDefined();
      expect(state.layerAnnotations.touristAttractions).toBe("NAME");
      expect(state.haloState.touristAttractions).toEqual({ color: "#ffffff", size: 20 });
    });
  });

  describe("saveProjectState", () => {
    const originalCreateObjectURL = globalThis.URL.createObjectURL;
    const originalRevokeObjectURL = globalThis.URL.revokeObjectURL;

    let originalPromisePicker;

    beforeEach(() => {
      globalThis.URL.createObjectURL = jest.fn(() => "blob:mock-url");
      globalThis.URL.revokeObjectURL = jest.fn();
      originalPromisePicker = window.showSaveFilePicker;
      delete window.showSaveFilePicker;
    });

    afterEach(() => {
      globalThis.URL.createObjectURL = originalCreateObjectURL;
      globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
      window.showSaveFilePicker = originalPromisePicker;
    });

    test("prompts for a filename, downloads the chosen file, and reports success", async () => {
      const engine = new GISMapEngine();
      engine.attachToView(makeView());

      const clickSpy = jest.fn();
      const anchor = { click: clickSpy, href: "", download: "" };
      const createElementSpy = jest.spyOn(document, "createElement").mockReturnValue(anchor);
      const promptSpy = jest.spyOn(window, "prompt").mockReturnValue("my-project");

      const msg = jest.fn();
      await engine.saveProjectState(msg);

      expect(promptSpy).toHaveBeenCalled();
      expect(globalThis.URL.createObjectURL).toHaveBeenCalled();
      expect(anchor.download).toBe("my-project.json");
      expect(clickSpy).toHaveBeenCalled();
      expect(msg).toHaveBeenCalledWith("Project saved.", "success");

      createElementSpy.mockRestore();
      promptSpy.mockRestore();
    });

    test("does nothing when the filename prompt is cancelled", async () => {
      const engine = new GISMapEngine();
      engine.attachToView(makeView());

      const clickSpy = jest.fn();
      const anchor = { click: clickSpy, href: "", download: "" };
      const createElementSpy = jest.spyOn(document, "createElement").mockReturnValue(anchor);
      const promptSpy = jest.spyOn(window, "prompt").mockReturnValue(null);

      const msg = jest.fn();
      await engine.saveProjectState(msg);

      expect(clickSpy).not.toHaveBeenCalled();
      expect(msg).not.toHaveBeenCalled();

      createElementSpy.mockRestore();
      promptSpy.mockRestore();
    });
  });

  describe("loadProjectState", () => {
    test("returns null and reports a message for an unparseable file", async () => {
      const engine = new GISMapEngine();
      const msg = jest.fn();

      const result = await engine.loadProjectState(makeFile("not json"), msg);

      expect(result).toBeNull();
      expect(msg).toHaveBeenCalledWith(
        "Load failed: the file could not be read as a valid project.",
        "error"
      );
    });

    test("returns null for a file that isn't a recognized project (no layerOrder)", async () => {
      const engine = new GISMapEngine();
      const result = await engine.loadProjectState(makeFile(JSON.stringify({ foo: "bar" })));
      expect(result).toBeNull();
    });

    test("restores layer order, visibility, filters, annotations, and halo state", async () => {
      const saver = new GISMapEngine();
      saver.attachToView(makeView());
      saver.toggleLayer("mrtStations");
      saver.touristAttractionLayer.fields = [{ name: "NAME", type: "esriFieldTypeString" }];
      await saver.setLayerFilter("touristAttractions", {
        logic: "AND",
        conditions: [{ field: "NAME", operator: "=", value: "Zoo" }]
      });
      await saver.setLayerAnnotation("touristAttractions", "NAME");
      saver.setLayerStyle("touristAttractions", { color: "#00ff00", halo: true, haloColor: "#ffffff", haloSize: 15 });
      const savedJson = JSON.stringify(saver.buildProjectState());

      const loader = new GISMapEngine();
      loader.attachToView(makeView());
      const msg = jest.fn();

      const result = await loader.loadProjectState(makeFile(savedJson), msg);

      expect(result.is3D).toBe(false);
      expect(loader.mrtStationVisible).toBe(false);
      expect(loader.mrtStationLayer.visible).toBe(false);
      expect(loader.layerFilters.get("touristAttractions")).toBeDefined();
      expect(loader.layerAnnotations.get("touristAttractions")).toBe("NAME");
      expect(loader.haloState.get("touristAttractions")).toEqual({ color: "#ffffff", size: 15 });
      expect(loader.touristAttractionLayer.renderer.symbol.type).toBe("CIMSymbolReference");
      expect(msg).toHaveBeenCalledWith("Project loaded.", "success");
    });

    // A stale/orphaned dynamic-layer id in a saved layerOrder (e.g. a
    // heatmap/route-result/search-result/portal layer whose meta entry is
    // missing - the exact shape a file saved under the pre-fix
    // reorderLayers off-by-one bug could produce) must not survive into the
    // restored layerOrder: getLayers() would otherwise map it to `undefined`,
    // which the panel's `layers.filter(Boolean)` silently drops, permanently
    // desyncing the card's row count from what reorderLayers indexes into.
    test("drops a layerOrder id with no matching restored layer, so a stale save can't desync the card from reorderLayers", async () => {
      const loader = new GISMapEngine();
      loader.attachToView(makeView());

      const staleState = {
        version: 1,
        is3D: false,
        layerOrder: [
          "route",
          "stops",
          "touristAttractions",
          "mrtStations",
          "mrtLines",
          "drawings",
          "searchResult",
          "heatmap_orphan"
        ],
        heatmapLayers: {}
      };

      const result = await loader.loadProjectState(makeFile(JSON.stringify(staleState)), jest.fn());

      expect(result).not.toBeNull();
      expect(loader.layerOrder).not.toContain("heatmap_orphan");
      expect(loader.getLayers().every(Boolean)).toBe(true);
    });

    test("restores drawings with their attributes intact", async () => {
      const saver = new GISMapEngine();
      saver.attachToView(makeView());
      saver.drawLayer.add(
        new Graphic({
          geometry: { type: "point", x: 10, y: 20 },
          symbol: { type: "simple-marker", color: "blue", size: 9 },
          attributes: { name: "Bench", count: 3 }
        })
      );
      const savedJson = JSON.stringify(saver.buildProjectState());

      const loader = new GISMapEngine();
      loader.attachToView(makeView());
      await loader.loadProjectState(makeFile(savedJson));

      expect(loader.drawLayer.graphics).toHaveLength(1);
      const restored = loader.drawLayer.graphics.toArray()[0];
      expect(restored.geometry).toEqual({ type: "point", x: 10, y: 20, spatialReference: undefined });
      expect(restored.attributes).toEqual({ name: "Bench", count: 3 });
    });

    test("restores route/stop graphics", async () => {
      const saver = new GISMapEngine();
      saver.attachToView(makeView());
      saver.drawRoute({ type: "polyline", paths: [[[0, 0], [1, 1]]] });
      saver.drawStops({ type: "point", x: 0, y: 0 }, { type: "point", x: 1, y: 1 });
      const savedJson = JSON.stringify(saver.buildProjectState());

      const loader = new GISMapEngine();
      loader.attachToView(makeView());
      await loader.loadProjectState(makeFile(savedJson));

      expect(loader.routeLayer.graphics).toHaveLength(1);
      expect(loader.stopLayer.graphics).toHaveLength(2);
    });

    // Regression (2026-08): every heatmap in the engine reached ArcGIS as a
    // plain object, whose maxPixelIntensity/minPixelIntensity the SDK silently
    // drops in favour of an auto-calculated density (see GISMapEngine's
    // toLiveRenderer). Only updateHeatmapLayerIntensity happened to use the
    // one shape that works, so a heatmap rendered as a single washed-out blob
    // around the densest cluster on every path where the user had NOT dragged
    // the intensity slider - most visibly after "Load Project", where nothing
    // touches the slider at all, leaving the intensity the panel reported
    // disagreeing with what the map actually drew.
    test("applies each restored heatmap layer's persisted intensity to the actual renderer, with no slider interaction", async () => {
      const saver = new GISMapEngine();
      saver.attachToView(makeView());
      saver.touristAttractionLayer.geometryType = "point";
      saver.createHeatmapLayer("touristAttractions", { name: "Density", intensity: 12 });
      const savedJson = JSON.stringify(saver.buildProjectState());

      const loader = new GISMapEngine();
      loader.attachToView(makeView());
      await loader.loadProjectState(makeFile(savedJson));

      const layers = [...loader.heatmapLayers.values()];
      expect(layers).toHaveLength(1);
      expect(layers[0].renderer.type).toBe("heatmap");
      expect(layers[0].renderer.maxPixelIntensity).toBe(12);
    });

    // Same root cause, the in-place Heatmap renderer mode rather than a named
    // layer: drawLayer.renderer is assigned straight from the restored
    // layerRenderers descriptor, so it needs the same materialization.
    test("applies a restored `drawings` heatmap renderer's intensity to drawLayer, not an auto-calculated density", async () => {
      const saver = new GISMapEngine();
      saver.attachToView(makeView());
      await saver.setLayerAdvancedRenderer("drawings", { type: "heatmap", intensity: 33 });
      const savedJson = JSON.stringify(saver.buildProjectState());

      const loader = new GISMapEngine();
      loader.attachToView(makeView());
      await loader.loadProjectState(makeFile(savedJson));

      expect(loader.drawLayer.renderer.type).toBe("heatmap");
      expect(loader.drawLayer.renderer.maxPixelIntensity).toBe(33);
    });

    test("navigates to the saved extent when a view is attached", async () => {
      const saver = new GISMapEngine();
      const savedView = makeView();
      savedView.extent = { type: "extent", xmin: 0, ymin: 0, xmax: 10, ymax: 10 };
      saver.attachToView(savedView);
      const savedJson = JSON.stringify(saver.buildProjectState());

      const loader = new GISMapEngine();
      const view = makeView();
      loader.attachToView(view);

      await loader.loadProjectState(makeFile(savedJson));

      expect(view.goTo).toHaveBeenCalledWith(
        expect.objectContaining({ type: "extent", xmin: 0, ymin: 0, xmax: 10, ymax: 10 })
      );
    });

    // Regression test for the bug actually reported: a named heatmap
    // layer's renderer looked right on `getLayers()` after a project load,
    // but the map itself stayed undercounted (thin/yellow, not red) until a
    // user touched the intensity slider. root cause: attachToView's own
    // heatmap resync fires once its OWN (redundant, same-position) internal
    // goTo settles - but loadProjectState does a SECOND, later goTo of its
    // own (to the project's actually-saved extent, asserted above), which
    // attachToView has no way to know is coming. A heatmap's kernel-density
    // surface is computed per current view extent, so resyncing only before
    // that second navigation left the renderer reflecting the wrong
    // (pre-navigation) extent. `view.whenLayerView` must not be called for
    // the heatmap layer until AFTER `view.goTo(savedExtent)` has resolved.
    test("resyncs a named heatmap layer's renderer again after navigating to the project's saved extent, not just once at attach time", async () => {
      const saver = new GISMapEngine();
      const savedView = makeView();
      savedView.extent = { type: "extent", xmin: 0, ymin: 0, xmax: 10, ymax: 10 };
      saver.attachToView(savedView);
      saver.touristAttractionLayer.geometryType = "point";
      saver.createHeatmapLayer("touristAttractions", { name: "Density", intensity: 65 });
      const savedJson = JSON.stringify(saver.buildProjectState());

      const loader = new GISMapEngine();
      const view = makeView();
      const callOrder = [];
      let resolveGoTo;
      view.goTo = jest.fn(() => {
        callOrder.push("goTo");
        return new Promise((resolve) => {
          resolveGoTo = resolve;
        });
      });
      view.whenLayerView = jest.fn(() => {
        callOrder.push("whenLayerView");
        return Promise.resolve({ updating: false, watch: jest.fn(() => ({ remove: jest.fn() })) });
      });
      loader.attachToView(view);
      await Promise.resolve();
      await Promise.resolve();
      view.whenLayerView.mockClear();
      callOrder.length = 0;

      const loadPromise = loader.loadProjectState(makeFile(savedJson));
      // Let the load run up through issuing its goTo call and whatever
      // attachToView's own (redundant, no-navigation-needed) internal
      // resync does on its own - that one is legitimate and expected to
      // fire early, before this goTo. What matters is that at least one
      // MORE whenLayerView call happens after goTo, not that none happen
      // before it.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(view.goTo).toHaveBeenCalled();
      const goToIndex = callOrder.indexOf("goTo");
      const whenLayerViewCallsBeforeGoToResolves = view.whenLayerView.mock.calls.length;

      resolveGoTo();
      await loadPromise;
      // Flush the post-navigation resync's own whenLayerView().then() chain.
      await Promise.resolve();
      await Promise.resolve();

      expect(view.whenLayerView.mock.calls.length).toBeGreaterThan(whenLayerViewCallsBeforeGoToResolves);
      // At least one whenLayerView call happened strictly after goTo was
      // issued, i.e. this is not just attachToView's own early resync.
      expect(callOrder.lastIndexOf("whenLayerView")).toBeGreaterThan(goToIndex);
    });

    test("round-trips a generated Unique Values renderer so it re-applies without requerying", async () => {
      const saver = new GISMapEngine();
      saver.attachToView(makeView());
      saver.touristAttractionLayer.fields = [{ name: "CATEGORY", type: "esriFieldTypeString" }];
      saver.touristAttractionLayer.queryFeatures.mockResolvedValue({
        features: [{ attributes: { CATEGORY: "Museum" } }]
      });
      await saver.setLayerAdvancedRenderer("touristAttractions", { type: "unique-value", field: "CATEGORY" });
      const savedJson = JSON.stringify(saver.buildProjectState());

      const loader = new GISMapEngine();
      loader.attachToView(makeView());
      await loader.loadProjectState(makeFile(savedJson));

      expect(loader.touristAttractionLayer.renderer.type).toBe("unique-value");
      expect(loader.touristAttractionLayer.renderer.field).toBe("CATEGORY");
    });

    // drawLayer is a single persistent GraphicsLayer instance that outlives a
    // project load (unlike touristAttractions/mrtStations/mrtLines/portal
    // layers, which are freshly reconstructed every attachToView via
    // resolveSeedRenderer), and a heatmap renderer is assigned straight to
    // its .renderer property rather than baked into each graphic's own
    // .symbol - so restoring drawings' graphics alone doesn't bring a
    // drawings heatmap back. Without re-syncing .renderer from the restored
    // layerRenderers Map, getLayers()'s reported rendererIntensity (read
    // straight from that Map) would say one thing while the map actually
    // rendered another.
    test("restores a drawings heatmap renderer's intensity onto the live layer, not just onto getLayers()'s reported value", async () => {
      const saver = new GISMapEngine();
      saver.attachToView(makeView());
      saver.drawLayer.add(
        new Graphic({
          geometry: { type: "point", x: 10, y: 20 },
          symbol: { type: "simple-marker", color: "blue", size: 9 }
        })
      );
      await saver.setLayerAdvancedRenderer("drawings", { type: "heatmap", symbolType: "simple-marker", intensity: 77 });
      const savedJson = JSON.stringify(saver.buildProjectState());

      const loader = new GISMapEngine();
      loader.attachToView(makeView());
      await loader.loadProjectState(makeFile(savedJson));

      expect(loader.drawLayer.renderer.type).toBe("heatmap");
      expect(loader.drawLayer.renderer.maxPixelIntensity).toBe(77);
    });

    // The inverse case: loading a project with no drawings heatmap must not
    // leave a previous session's heatmap renderer visually applied even
    // though layerRenderers (and therefore getLayers()'s reported state) no
    // longer has one.
    test("clears a stale drawings heatmap renderer left over from before the load when the loaded project has none", async () => {
      const loader = new GISMapEngine();
      loader.attachToView(makeView());
      loader.drawLayer.add(
        new Graphic({
          geometry: { type: "point", x: 10, y: 20 },
          symbol: { type: "simple-marker", color: "blue", size: 9 }
        })
      );
      await loader.setLayerAdvancedRenderer("drawings", { type: "heatmap", symbolType: "simple-marker", intensity: 60 });
      expect(loader.drawLayer.renderer.type).toBe("heatmap");

      const emptyState = { version: 1, is3D: false, layerOrder: ["drawings"] };
      await loader.loadProjectState(makeFile(JSON.stringify(emptyState)));

      expect(loader.drawLayer.renderer).toBeNull();
    });
  });
});
