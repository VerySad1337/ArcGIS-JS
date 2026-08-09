/* eslint-disable react/prop-types -- mock components stand in for real ones; props are exercised by the tests, not consumers */
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ApplicationShell from "./ApplicationShell";
import GISMapEngine from "../gis/GISMapEngine";
import { solveRoute } from "../services/RoutingService";
import { geocodeAddress } from "../services/GeocodingService";
import { searchPortalLayers } from "../services/PortalService";
import { isOAuthConfigured, checkSignInStatus, signIn, signOut } from "../services/AuthService";

jest.mock("../gis/GISMapEngine");
jest.mock("../services/RoutingService");
jest.mock("../services/GeocodingService");
jest.mock("../services/PortalService");
jest.mock("../services/AuthService");

jest.mock("../components/GISMapView", () => (props) => (
  <button data-testid="fake-view-ready" onClick={() => props.onViewReady({ id: "fake-view" })}>
    fake-map-view
  </button>
));

jest.mock("../components/AnalysisPanel", () => (props) => (
  <div data-testid="routing-panel">
    <button onClick={props.toggleRoute}>toggle-route</button>
    <button onClick={() => props.onRoute("Start", "End")}>submit-route</button>
    <button
      onClick={() => props.onCreateHeatmapLayer("touristAttractions", { name: "Density", intensity: 70 })}
    >
      create-heatmap-layer
    </button>
    <button onClick={() => props.onCreateRouteLayer("My Commute")}>create-route-layer</button>
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
    <button onClick={() => props.onZoomToLayer("route")}>zoom-layer</button>
    <button onClick={() => props.onRemove("portal_abc")}>remove-layer</button>
    <button onClick={() => props.onRemove("heatmap_xyz")}>remove-heatmap-layer</button>
    <button onClick={() => props.onRemove("route_xyz")}>remove-route-layer</button>
    <button onClick={() => props.onUpdateHeatmapLayerIntensity("heatmap_xyz", 42)}>
      update-heatmap-intensity
    </button>
  </div>
));

jest.mock("../components/PortalLayerPanel", () => (props) => (
  <div data-testid="portal-layer-panel">
    <span data-testid="oauth-configured">{String(props.oauthConfigured)}</span>
    <span data-testid="signed-in-user">{props.signedInUser?.fullName ?? ""}</span>
    <button onClick={() => props.onSearch("parks")}>search-portal</button>
    <button
      onClick={() => props.onAddLayer({ id: "abc", title: "Parks", url: "https://example.com/Parks/FeatureServer" })}
    >
      add-portal-layer
    </button>
    <button onClick={props.onSignIn}>sign-in</button>
    <button onClick={props.onSignOut}>sign-out</button>
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
    isOAuthConfigured.mockReturnValue(false);
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

  test("toggling view mode detaches the engine's layers before the view swap unmounts the outgoing view", async () => {
    // Regression test: the outgoing <arcgis-map>/<arcgis-scene> destroys its
    // own Map on unmount, which cascades to destroy() every layer still
    // attached to it (including the persistent drawLayer), permanently
    // wiping drawings. detachFromView must run synchronously before the
    // is3D flip that triggers React to swap the view components, not
    // reactively inside the next attachToView (which may run late, or -
    // if the incoming view never becomes ready - not at all).
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();

    await user.click(screen.getByRole("button", { name: "3D" }));

    expect(engine.detachFromView).toHaveBeenCalled();
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

  test("toggling a layer forwards to engine.toggleLayer", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();

    await user.click(screen.getByText("toggle-layer"));
    expect(engine.toggleLayer).toHaveBeenCalledWith("route");
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

  test("zooming to a layer forwards to engine.zoomToLayer with a toast callback", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();

    await user.click(screen.getByText("zoom-layer"));
    expect(engine.zoomToLayer).toHaveBeenCalledWith("route", expect.any(Function));
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

  test("searching the portal forwards to searchPortalLayers", async () => {
    const user = userEvent.setup();
    searchPortalLayers.mockResolvedValue([{ id: "abc", title: "Parks" }]);
    render(<ApplicationShell />);

    await user.click(screen.getByText("search-portal"));
    expect(searchPortalLayers).toHaveBeenCalledWith("parks");
  });

  test("a failed portal search shows a toast and resolves to an empty list", async () => {
    const user = userEvent.setup();
    searchPortalLayers.mockRejectedValue(new Error("portal down"));
    render(<ApplicationShell />);

    await user.click(screen.getByText("search-portal"));
    expect(await screen.findByText("portal down")).toBeInTheDocument();
  });

  test("adding a portal layer calls engine.addPortalLayer, refreshes layers, and shows a toast", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();

    await user.click(screen.getByText("add-portal-layer"));

    expect(engine.addPortalLayer).toHaveBeenCalledWith({
      id: "abc",
      title: "Parks",
      url: "https://example.com/Parks/FeatureServer"
    });
    expect(await screen.findByText('Added "Parks" to layers.')).toBeInTheDocument();
  });

  test("a failed portal-layer add shows the error message as a toast", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();
    engine.addPortalLayer.mockImplementation(() => {
      throw new Error("no url");
    });

    await user.click(screen.getByText("add-portal-layer"));
    expect(await screen.findByText("no url")).toBeInTheDocument();
  });

  test("removing a portal layer calls engine.removePortalLayer and refreshes layers", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();

    await user.click(screen.getByText("remove-layer"));
    expect(engine.removePortalLayer).toHaveBeenCalledWith("portal_abc");
  });

  test("removing a heatmap_-prefixed layer calls engine.removeHeatmapLayer instead of removePortalLayer", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();

    await user.click(screen.getByText("remove-heatmap-layer"));
    expect(engine.removeHeatmapLayer).toHaveBeenCalledWith("heatmap_xyz");
    expect(engine.removePortalLayer).not.toHaveBeenCalled();
  });

  test("creating a heatmap layer calls engine.createHeatmapLayer, refreshes layers, and toasts success", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();
    engine.createHeatmapLayer.mockReturnValue({ id: "heatmap_new", name: "Density" });

    await user.click(screen.getByText("create-heatmap-layer"));

    expect(engine.createHeatmapLayer).toHaveBeenCalledWith("touristAttractions", { name: "Density", intensity: 70 });
    expect(await screen.findByText('Added heatmap layer "Density".')).toBeInTheDocument();
  });

  test("a failed heatmap layer creation toasts the engine's error instead of throwing", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();
    engine.createHeatmapLayer.mockImplementation(() => {
      throw new Error("Please give the heatmap layer a name.");
    });

    await user.click(screen.getByText("create-heatmap-layer"));
    expect(await screen.findByText("Please give the heatmap layer a name.")).toBeInTheDocument();
  });

  test("updating a heatmap layer's intensity calls engine.updateHeatmapLayerIntensity", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();

    await user.click(screen.getByText("update-heatmap-intensity"));
    expect(engine.updateHeatmapLayerIntensity).toHaveBeenCalledWith("heatmap_xyz", 42);
  });

  test("removing a route_-prefixed layer calls engine.removeRouteResultLayer instead of removePortalLayer", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();

    await user.click(screen.getByText("remove-route-layer"));
    expect(engine.removeRouteResultLayer).toHaveBeenCalledWith("route_xyz");
    expect(engine.removePortalLayer).not.toHaveBeenCalled();
  });

  test("creating a route layer calls engine.createRouteResultLayer, refreshes layers, and toasts success", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();
    engine.createRouteResultLayer.mockReturnValue({ id: "route_new", name: "My Commute" });

    await user.click(screen.getByText("create-route-layer"));

    expect(engine.createRouteResultLayer).toHaveBeenCalledWith("My Commute");
    expect(await screen.findByText('Added route layer "My Commute".')).toBeInTheDocument();
  });

  test("a failed route layer creation toasts the engine's error instead of throwing", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();
    engine.createRouteResultLayer.mockImplementation(() => {
      throw new Error("Please give the route layer a name.");
    });

    await user.click(screen.getByText("create-route-layer"));
    expect(await screen.findByText("Please give the route layer a name.")).toBeInTheDocument();
  });

  test("saving an address search result calls engine.createSearchResultLayer, clears the live marker, refreshes layers, and resets the search box", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();
    engine.searchFeatures.mockResolvedValue([]);
    engine.zoomToPoint.mockImplementation(() => {
      engine.searchGraphic = { geometry: { type: "point" } };
    });
    engine.createSearchResultLayer.mockReturnValue({ id: "search_new", name: "Client Site" });

    const queryInput = screen.getByLabelText("Search features or an address");
    await user.type(queryInput, "1 Some Street");
    await user.click(screen.getByRole("button", { name: "Search" }));

    const addressOption = await screen.findByRole("option", { name: /1 Some Street/ });
    await user.click(addressOption);
    expect(engine.zoomToPoint).toHaveBeenCalled();

    const nameInput = await screen.findByLabelText("New search result layer name");
    await user.type(nameInput, "Client Site");
    await user.click(screen.getByRole("button", { name: "Add to Layers" }));

    expect(engine.createSearchResultLayer).toHaveBeenCalledWith("Client Site");
    expect(engine.clearSearchResult).toHaveBeenCalled();
    expect(await screen.findByText('Added search result layer "Client Site".')).toBeInTheDocument();
    expect(queryInput).toHaveValue("");
  });

  test("selecting a feature-class result only zooms - it never shows Add to Layers or touches the query/marker; only an address result does, and only Add to Layers resets it", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();
    engine.searchFeatures.mockImplementation((query) =>
      Promise.resolve(
        query === "Zoo" ? [{ type: "feature", layerId: "touristAttractions", label: "Zoo" }] : []
      )
    );
    // Only "1 Some Street" should geocode to an address in this test - "Zoo"
    // must resolve as a feature-only result, or the two searches below would
    // both surface an ambiguous "Zoo" *and* "1 Some Street" address option.
    geocodeAddress.mockImplementation((addr) =>
      addr === "1 Some Street" ? Promise.resolve({ longitude: 5, latitude: 6 }) : Promise.resolve(null)
    );
    engine.zoomToPoint.mockImplementation(() => {
      engine.searchGraphic = { geometry: { type: "point" } };
    });
    engine.createSearchResultLayer.mockReturnValue({ id: "search_new", name: "Client Site" });

    const queryInput = screen.getByLabelText("Search features or an address");
    await user.type(queryInput, "Zoo");
    await user.click(screen.getByRole("button", { name: "Search" }));

    // Selecting the feature-class result only zooms to it (zoomToSearchResult) -
    // no marker, no "Add to Layers" form, and the query box is untouched.
    await user.click(await screen.findByRole("option", { name: /Zoo/ }));
    expect(engine.zoomToSearchResult).toHaveBeenCalledWith(
      expect.objectContaining({ type: "feature", label: "Zoo" })
    );
    expect(engine.zoomToPoint).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("New search result layer name")).not.toBeInTheDocument();
    expect(queryInput).toHaveValue("Zoo");

    // Now search an address and select it - only now does the save form appear.
    await user.clear(queryInput);
    await user.type(queryInput, "1 Some Street");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(await screen.findByRole("option", { name: /1 Some Street/ }));

    expect(engine.zoomToPoint).toHaveBeenCalled();
    const nameInput = await screen.findByLabelText("New search result layer name");

    // Only clicking Add to Layers resets the query/marker - not any prior step.
    await user.type(nameInput, "Client Site");
    await user.click(screen.getByRole("button", { name: "Add to Layers" }));

    expect(engine.createSearchResultLayer).toHaveBeenCalledWith("Client Site");
    expect(engine.clearSearchResult).toHaveBeenCalled();
    expect(queryInput).toHaveValue("");
    expect(screen.queryByLabelText("New search result layer name")).not.toBeInTheDocument();
  });

  test("the Add to Layers form appears for an address result even after an earlier, unrelated interaction already flipped hasInteracted", async () => {
    // Regression: handleSelectSearchResult used to rely on setHasInteracted(true)
    // as its only re-render trigger, which is a no-op once hasInteracted is
    // already true - so selecting an address result after any prior
    // interaction (e.g. starting a draw, or selecting a map-feature result
    // first) left the Search card's "Add to Layers" form stuck hidden even
    // though engine.searchGraphic was already set correctly.
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();
    engine.searchFeatures.mockResolvedValue([]);
    engine.zoomToPoint.mockImplementation(() => {
      engine.searchGraphic = { geometry: { type: "point" } };
    });

    // An earlier, unrelated interaction that already flips hasInteracted to true.
    await user.click(screen.getByText("draw-point"));

    const queryInput = screen.getByLabelText("Search features or an address");
    await user.type(queryInput, "1 Some Street");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(await screen.findByRole("option", { name: /1 Some Street/ }));

    expect(await screen.findByLabelText("New search result layer name")).toBeInTheDocument();
  });

  test("without OAuth configured, sign-in is never attempted and existing behavior is unaffected", () => {
    render(<ApplicationShell />);

    expect(checkSignInStatus).not.toHaveBeenCalled();
    expect(screen.getByTestId("oauth-configured")).toHaveTextContent("false");
  });

  test("with OAuth configured, checks for a restored session on mount", async () => {
    isOAuthConfigured.mockReturnValue(true);
    checkSignInStatus.mockResolvedValue({ username: "jdoe", fullName: "Jane Doe" });

    render(<ApplicationShell />);

    expect(checkSignInStatus).toHaveBeenCalled();
    expect(await screen.findByText("Jane Doe")).toBeInTheDocument();
  });

  test("signing in updates the signed-in user and shows a success toast", async () => {
    const user = userEvent.setup();
    isOAuthConfigured.mockReturnValue(true);
    checkSignInStatus.mockResolvedValue(null);
    signIn.mockResolvedValue({ username: "jdoe", fullName: "Jane Doe" });
    render(<ApplicationShell />);

    await user.click(screen.getByText("sign-in"));

    expect(await screen.findByText("Signed in as Jane Doe.")).toBeInTheDocument();
    expect(screen.getByTestId("signed-in-user")).toHaveTextContent("Jane Doe");
  });

  test("a failed or cancelled sign-in shows an error toast", async () => {
    const user = userEvent.setup();
    isOAuthConfigured.mockReturnValue(true);
    checkSignInStatus.mockResolvedValue(null);
    signIn.mockRejectedValue(new Error("popup closed"));
    render(<ApplicationShell />);

    await user.click(screen.getByText("sign-in"));

    expect(await screen.findByText("popup closed")).toBeInTheDocument();
  });

  test("signing out clears the signed-in user and shows a toast", async () => {
    const user = userEvent.setup();
    isOAuthConfigured.mockReturnValue(true);
    checkSignInStatus.mockResolvedValue({ username: "jdoe", fullName: "Jane Doe" });
    render(<ApplicationShell />);
    await screen.findByText("Jane Doe");

    await user.click(screen.getByText("sign-out"));

    expect(signOut).toHaveBeenCalled();
    expect(await screen.findByText("Signed out.")).toBeInTheDocument();
    expect(screen.getByTestId("signed-in-user")).toHaveTextContent("");
  });
});
