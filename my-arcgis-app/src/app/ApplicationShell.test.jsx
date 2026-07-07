/* eslint-disable react/prop-types -- mock components stand in for real ones; props are exercised by the tests, not consumers */
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ApplicationShell from "./ApplicationShell";
import GISMapEngine from "../gis/GISMapEngine";
import { solveRoute } from "../services/RoutingService";
import { geocodeAddress } from "../services/GeocodingService";

jest.mock("../gis/GISMapEngine");
jest.mock("../services/RoutingService");
jest.mock("../services/GeocodingService");

jest.mock("../components/GISMapView", () => (props) => (
  <button data-testid="fake-view-ready" onClick={() => props.onViewReady({ id: "fake-view" })}>
    fake-map-view
  </button>
));

jest.mock("../components/RoutingControlPanel", () => (props) => (
  <div data-testid="routing-panel">
    <button onClick={() => props.setIs3D(!props.is3D)}>toggle-3d</button>
    <button onClick={props.toggleRoute}>toggle-route</button>
    <button onClick={props.toggleHeatmap}>toggle-heatmap</button>
    <button onClick={() => props.updateIntensity(88)}>set-intensity</button>
    <button onClick={() => props.onRoute("Start", "End")}>submit-route</button>
  </div>
));

jest.mock("../components/LayerControlPanel", () => (props) => (
  <div data-testid="layer-panel">
    {props.layers.map((l) => (
      <span key={l.id}>{l.name}</span>
    ))}
    <button onClick={() => props.onToggle("route")}>toggle-layer</button>
    <button onClick={() => props.onReorder(0, 1)}>reorder-layer</button>
    <button onClick={() => props.onStyleChange("route", { color: "#fff" })}>style-layer</button>
  </div>
));

jest.mock("../components/FloatingDrawTools", () => (props) => (
  <div data-testid="draw-tools">
    <button onClick={props.drawPoint}>draw-point</button>
    <button onClick={props.drawLine}>draw-line</button>
    <button onClick={props.drawPolygon}>draw-polygon</button>
    <button onClick={props.saveGeoJSON}>save-geojson</button>
    <button
      onClick={() => props.uploadGeoJSON({ name: "test.geojson" })}
    >
      upload-geojson
    </button>
  </div>
));

jest.mock("../components/FeatureAttributesPanel", () => (props) =>
  props.feature ? (
    <div data-testid="feature-panel">
      <button onClick={props.onClose}>close-feature</button>
      <button onClick={() => props.onSaveAttributes({ name: "updated" })}>save-attrs</button>
      <button onClick={() => props.onAddColumn("newField", "default")}>add-column</button>
    </div>
  ) : null
);

function getEngineInstance() {
  return GISMapEngine.mock.instances[0];
}

async function readyTheView(user) {
  await user.click(screen.getByTestId("fake-view-ready"));
}

describe("ApplicationShell", () => {
  beforeEach(() => {
    solveRoute.mockResolvedValue({ type: "polyline" });
    geocodeAddress.mockImplementation((addr) =>
      Promise.resolve({ longitude: addr === "Start" ? 1 : 2, latitude: addr === "Start" ? 3 : 4 })
    );
    GISMapEngine.prototype.getLayers.mockReturnValue([]);
  });

  test("renders the core layout", () => {
    render(<ApplicationShell />);
    expect(screen.getByTestId("routing-panel")).toBeInTheDocument();
    expect(screen.getByTestId("layer-panel")).toBeInTheDocument();
    expect(screen.getByTestId("draw-tools")).toBeInTheDocument();
    expect(screen.getByTestId("fake-view-ready")).toBeInTheDocument();
  });

  test("sidebar toggle opens and closes the side panel and backdrop", async () => {
    const user = userEvent.setup();
    const { container } = render(<ApplicationShell />);

    const toggle = screen.getByRole("button", { name: "Open panel" });
    await user.click(toggle);

    expect(container.querySelector(".side-panel")).toHaveClass("open");
    expect(container.querySelector(".side-panel-backdrop")).toBeInTheDocument();

    await user.click(container.querySelector(".sidebar-toggle"));
    expect(container.querySelector(".side-panel")).not.toHaveClass("open");
  });

  test("closing via the backdrop also closes the sidebar", async () => {
    const user = userEvent.setup();
    const { container } = render(<ApplicationShell />);

    await user.click(screen.getByRole("button", { name: "Open panel" }));
    const backdrops = screen.getAllByRole("button", { name: "Close panel" });
    await user.click(backdrops.at(-1));

    expect(container.querySelector(".side-panel")).not.toHaveClass("open");
  });

  test("view ready wires the engine's callbacks, attaches the view, and refreshes layers", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();
    engine.getLayers.mockReturnValue([{ id: "route", name: "Route Layer" }]);

    await readyTheView(user);

    expect(engine.setOnFeatureSelect).toHaveBeenCalledWith(expect.any(Function));
    expect(engine.setOnDrawingsChanged).toHaveBeenCalledWith(expect.any(Function));
    expect(engine.attachToView).toHaveBeenCalledWith({ id: "fake-view" });
    expect(screen.getByText("Route Layer")).toBeInTheDocument();
  });

  test("submitting a route geocodes both ends, solves the route, and draws it", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();

    await user.click(screen.getByText("submit-route"));

    expect(geocodeAddress).toHaveBeenNthCalledWith(1, "Start");
    expect(geocodeAddress).toHaveBeenNthCalledWith(2, "End");
    expect(solveRoute).toHaveBeenCalledWith(
      { type: "point", longitude: 1, latitude: 3 },
      { type: "point", longitude: 2, latitude: 4 }
    );
    expect(engine.drawRoute).toHaveBeenCalledWith({ type: "polyline" });
    expect(engine.drawStops).toHaveBeenCalledWith(
      { type: "point", longitude: 1, latitude: 3 },
      { type: "point", longitude: 2, latitude: 4 }
    );
  });

  test("toggling route calls engine.toggleRoute with the flipped value", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();

    await user.click(screen.getByText("toggle-route"));
    expect(engine.toggleRoute).toHaveBeenCalledWith(false);
  });

  test("toggling heatmap on calls enableHeatmap, off calls disableHeatmap", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();

    await user.click(screen.getByText("toggle-heatmap"));
    expect(engine.enableHeatmap).toHaveBeenCalledWith(null, 50);

    await user.click(screen.getByText("toggle-heatmap"));
    expect(engine.disableHeatmap).toHaveBeenCalled();
  });

  test("updating intensity calls engine.updateHeatmapIntensity", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();

    await user.click(screen.getByText("set-intensity"));
    expect(engine.updateHeatmapIntensity).toHaveBeenCalledWith(88);
  });

  test("toggling/reordering/styling a layer forwards to the engine and refreshes layers", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();

    await user.click(screen.getByText("toggle-layer"));
    expect(engine.toggleLayer).toHaveBeenCalledWith("route");

    await user.click(screen.getByText("reorder-layer"));
    expect(engine.reorderLayers).toHaveBeenCalledWith(0, 1);

    await user.click(screen.getByText("style-layer"));
    expect(engine.setLayerStyle).toHaveBeenCalledWith("route", { color: "#fff" });
  });

  test("draw tool buttons call the corresponding engine draw starters", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();

    await user.click(screen.getByText("draw-point"));
    expect(engine.startPointDraw).toHaveBeenCalled();

    await user.click(screen.getByText("draw-line"));
    expect(engine.startLineDraw).toHaveBeenCalled();

    await user.click(screen.getByText("draw-polygon"));
    expect(engine.startPolygonDraw).toHaveBeenCalled();
  });

  test("save GeoJSON forwards the toast callback to the engine", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();

    await user.click(screen.getByText("save-geojson"));
    expect(engine.saveDrawings).toHaveBeenCalledWith(expect.any(Function));
  });

  test("uploading a file calls engine.uploadGeoJSON and refreshes layers", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();
    engine.uploadGeoJSON.mockResolvedValue(undefined);

    await user.click(screen.getByText("upload-geojson"));
    expect(engine.uploadGeoJSON).toHaveBeenCalledWith({ name: "test.geojson" }, expect.any(Function));
  });

  test("selecting a feature shows the attributes panel; saving updates it and shows a toast", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();
    await readyTheView(user);

    const onFeatureSelect = engine.setOnFeatureSelect.mock.calls[0][0];
    engine.updateSelectedFeatureAttributes.mockResolvedValue({
      success: true,
      attributes: { name: "updated" }
    });

    act(() => {
      onFeatureSelect({
        layerId: "touristAttractions",
        layerTitle: "Tourist Attractions",
        attributes: { name: "old" },
        x: 0,
        y: 0
      });
    });

    expect(screen.getByTestId("feature-panel")).toBeInTheDocument();

    await user.click(screen.getByText("save-attrs"));
    expect(engine.updateSelectedFeatureAttributes).toHaveBeenCalledWith({ name: "updated" });
    expect(await screen.findByText("Attribute changes saved.")).toBeInTheDocument();
  });

  test("a failed attribute save shows the error message as a toast", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();
    await readyTheView(user);
    const onFeatureSelect = engine.setOnFeatureSelect.mock.calls[0][0];
    engine.updateSelectedFeatureAttributes.mockRejectedValue(new Error("nope"));

    act(() => {
      onFeatureSelect({ layerId: "drawings", layerTitle: "Drawings", attributes: {}, x: 0, y: 0 });
    });

    await user.click(screen.getByText("save-attrs"));
    expect(await screen.findByText("nope")).toBeInTheDocument();
  });

  test("adding a column updates the selected feature's attributes and shows a toast", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();
    await readyTheView(user);
    const onFeatureSelect = engine.setOnFeatureSelect.mock.calls[0][0];
    engine.addColumnToLayer.mockResolvedValue({ success: true });

    act(() => {
      onFeatureSelect({ layerId: "drawings", layerTitle: "Drawings", attributes: {}, x: 0, y: 0 });
    });

    await user.click(screen.getByText("add-column"));

    expect(engine.addColumnToLayer).toHaveBeenCalledWith("drawings", "newField", "esriFieldTypeString", "default");
    expect(await screen.findByText('Column "newField" added.')).toBeInTheDocument();
  });

  test("a failed add-column shows the error message as a toast", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();
    await readyTheView(user);
    const onFeatureSelect = engine.setOnFeatureSelect.mock.calls[0][0];
    engine.addColumnToLayer.mockRejectedValue(new Error("column exists"));

    act(() => {
      onFeatureSelect({ layerId: "drawings", layerTitle: "Drawings", attributes: {}, x: 0, y: 0 });
    });

    await user.click(screen.getByText("add-column"));
    expect(await screen.findByText("column exists")).toBeInTheDocument();
  });

  test("closing the feature panel clears the selected feature", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();
    await readyTheView(user);
    const onFeatureSelect = engine.setOnFeatureSelect.mock.calls[0][0];

    act(() => {
      onFeatureSelect({ layerId: "drawings", layerTitle: "Drawings", attributes: {}, x: 0, y: 0 });
    });
    expect(screen.getByTestId("feature-panel")).toBeInTheDocument();

    await user.click(screen.getByText("close-feature"));
    expect(screen.queryByTestId("feature-panel")).not.toBeInTheDocument();
  });
});
