/* eslint-disable react/prop-types -- mock components stand in for real ones; props are exercised by the tests, not consumers */
import { render, screen, act, waitFor } from "@testing-library/react";
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
    <button onClick={() => props.onSearch("parks")}>search-portal</button>
    <button
      onClick={() => props.onAddLayer({ id: "abc", title: "Parks", url: "https://example.com/Parks/FeatureServer" })}
    >
      add-portal-layer
    </button>
  </div>
));

jest.mock("../components/CreateFeatureLayerPanel", () => (props) => (
  <div data-testid="create-feature-layer-panel">
    <span data-testid="signed-in-user">{props.signedInUser?.fullName ?? ""}</span>
  </div>
));

jest.mock("../components/AccountButton", () => (props) => (
  <div data-testid="account-button">
    <span data-testid="oauth-configured">{String(props.oauthConfigured)}</span>
    <span data-testid="account-signed-in-user">{props.signedInUser?.fullName ?? ""}</span>
    <button onClick={props.onSignIn}>sign-in</button>
    <button onClick={props.onSignOut}>sign-out</button>
  </div>
));

jest.mock("../components/FloatingDrawTools", () => (props) => (
  <div data-testid="draw-tools">
    <button onClick={props.drawPoint}>draw-point</button>
    <button onClick={props.drawLine}>draw-line</button>
    <button onClick={props.drawPolygon}>draw-polygon</button>
    <span data-testid="draw-target-layer-id">{props.drawTargetLayerId}</span>
    <button onClick={() => props.onChangeDrawTarget("portal_abc")}>change-draw-target</button>
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

// The chat loop needs a real {ok, data|error} outcome to report back to the
// model (a toast isn't enough - see runClientAction's own comment), so the
// filter tests below assert on what onRunClientAction resolved to, not just
// on the engine calls it made.
let lastClientActionOutcome = null;

jest.mock("../components/ChatPanel", () => (props) => (
  <div data-testid="chat-panel">
    <button
      onClick={() =>
        props.onRunClientAction("add_portal_layer", {
          item: { id: "abc", title: "Parks", url: "https://example.com/Parks/FeatureServer" }
        })
      }
    >
      run-add-portal-layer
    </button>
    <button onClick={() => props.onRunClientAction("rename_layer", { id: "portal_abc", name: "My Parks" })}>
      run-rename-layer
    </button>
    <button
      onClick={async () => {
        lastClientActionOutcome = await props.onRunClientAction("calculate_route", {
          startAddress: "Start",
          endAddress: "End"
        });
      }}
    >
      run-calculate-route
    </button>
    <button
      onClick={async () => {
        lastClientActionOutcome = await props.onRunClientAction("create_route_result_layer", {
          name: "My Commute"
        });
      }}
    >
      run-create-route-result-layer
    </button>
    <button
      onClick={async () => {
        lastClientActionOutcome = await props.onRunClientAction("select_feature", { query: "Tampines" });
      }}
    >
      run-select-feature
    </button>
    <button
      onClick={async () => {
        lastClientActionOutcome = await props.onRunClientAction("select_feature", {
          query: "Tampines",
          layerId: "touristAttractions"
        });
      }}
    >
      run-select-feature-scoped
    </button>
    <button
      onClick={async () => {
        lastClientActionOutcome = await props.onRunClientAction("get_layer_aggregate", {
          id: "mrtStations",
          field: "RIDERSHIP",
          statistics: ["sum", "avg"]
        });
      }}
    >
      run-get-layer-aggregate
    </button>
    <button
      onClick={async () => {
        lastClientActionOutcome = await props.onRunClientAction("set_layer_filter", {
          id: "mrtStations",
          conditions: [{ field: "name", operator: "contains", value: "Tampines" }]
        });
      }}
    >
      run-set-layer-filter
    </button>
    <button
      onClick={async () => {
        lastClientActionOutcome = await props.onRunClientAction("set_layer_filter", {
          id: "mrtStations",
          conditions: [{ field: "station_name", operator: "=", value: "Tampines" }]
        });
      }}
    >
      run-set-layer-filter-separators
    </button>
    <button
      onClick={async () => {
        lastClientActionOutcome = await props.onRunClientAction("set_layer_filter", {
          id: "mrtStations",
          conditions: [{ field: "nope", operator: "=", value: "Tampines" }]
        });
      }}
    >
      run-set-layer-filter-unknown-field
    </button>
    <button
      onClick={async () => {
        lastClientActionOutcome = await props.onRunClientAction("set_layer_filter", {
          id: "mrtStations",
          conditions: [{ field: "title", operator: "!=", value: "Tampines" }]
        });
      }}
    >
      run-set-layer-filter-sql-operator
    </button>
    <span>chat-layer-fields:{JSON.stringify(props.mapContext.layers.map((l) => l.fields))}</span>
  </div>
));

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
    // Read on mount by the chat map-context field prefetch (see
    // ApplicationShell's chatLayerFields effect), same reason getLayers needs
    // a default: the automock would otherwise return undefined.
    GISMapEngine.prototype.getFilterableLayers.mockReturnValue([]);
    isOAuthConfigured.mockReturnValue(false);
    lastClientActionOutcome = null;
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

  // Regression test: chat asking to add a portal layer under a custom name
  // ("...and call it SCB") went through runClientAction's add_portal_layer
  // case in one combined tool call with an optional `name` field - even
  // after marking that field required in the tool schema, qwen2.5:1.5b
  // still reliably omitted it (observed directly, twice), so the chat
  // reply claimed the rename happened while the Layers card kept showing
  // the portal item's real title. Fixed by splitting "add" and "rename"
  // into two separate, single-purpose client tools/actions - mirroring the
  // apply_buffer -> create_buffer_result_layer chain this model already
  // handles correctly - rather than relying on one call with multiple
  // fields. rename_layer is its own runClientAction case, reusing the same
  // engine.renameLayer the manual per-row rename control already calls.
  test("runClientAction add_portal_layer only adds the layer under its own title - no rename", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();
    engine.addPortalLayer.mockResolvedValue("portal_abc");

    await user.click(screen.getByText("run-add-portal-layer"));

    expect(engine.addPortalLayer).toHaveBeenCalledWith({
      id: "abc",
      title: "Parks",
      url: "https://example.com/Parks/FeatureServer"
    });
    expect(engine.renameLayer).not.toHaveBeenCalled();
    expect(await screen.findByText('Added "Parks" to layers.')).toBeInTheDocument();
  });

  // calculate_route mirrors handleRoute (submit-route above) exactly, so the
  // chat's own way to drive Route Search reuses the identical
  // geocodeAddress -> solveRoute -> drawRoute/drawStops sequence rather than
  // a second implementation of the same flow.
  describe("runClientAction calculate_route", () => {
    test("geocodes both ends, solves the route, and draws it", async () => {
      const user = userEvent.setup();
      render(<ApplicationShell />);
      const engine = getEngineInstance();

      await user.click(screen.getByText("run-calculate-route"));

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
      expect(lastClientActionOutcome).toEqual({
        ok: true,
        data: { startAddress: "Start", endAddress: "End" }
      });
      expect(await screen.findByText("Route calculated.")).toBeInTheDocument();
    });

    // A failed geocode (OneMap down, or the model naming a place OneMap
    // can't resolve) must be reported back to the model as a failure, not
    // leave it to guess why nothing was drawn.
    test("a geocoding failure is reported as a failure, and nothing is drawn", async () => {
      const user = userEvent.setup();
      render(<ApplicationShell />);
      const engine = getEngineInstance();
      geocodeAddress.mockRejectedValueOnce(new Error("Location not found"));

      await user.click(screen.getByText("run-calculate-route"));

      expect(engine.drawRoute).not.toHaveBeenCalled();
      expect(lastClientActionOutcome).toEqual({ ok: false, error: "Location not found" });
    });
  });

  // Same "save the live, always-overwritten result as a permanent layer"
  // shape as create_buffer_result_layer, reusing engine.createRouteResultLayer
  // directly - the same method AnalysisPanel's own "Add to Layers" button
  // calls.
  test("runClientAction create_route_result_layer saves the current route as a new named layer", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();
    engine.createRouteResultLayer.mockReturnValue({ id: "route_abc", name: "My Commute" });

    await user.click(screen.getByText("run-create-route-result-layer"));

    expect(engine.createRouteResultLayer).toHaveBeenCalledWith("My Commute");
    expect(lastClientActionOutcome).toEqual({ ok: true, data: { id: "route_abc", name: "My Commute" } });
    expect(await screen.findByText('Added route layer "My Commute".')).toBeInTheDocument();
  });

  // Selection-scoped actions (apply_buffer above all) used to be reachable
  // only after the user clicked the map themselves, so a model asked to
  // "buffer Tampines MRT by 500m" could do nothing but tell the user to go
  // click it. select_feature is the chat's own way in, routed through the
  // same searchFeatures + zoomToSearchResult pair GlobalSearchPanel uses so
  // the resulting app state is identical to a click.
  describe("runClientAction select_feature", () => {
    const tampines = {
      type: "feature",
      layerId: "mrtStations",
      layerTitle: "MRT Stations",
      label: "TAMPINES MRT STATION",
      attributes: { NAME: "TAMPINES MRT STATION" },
      objectIdField: "OBJECTID",
      geometry: { type: "point" },
      graphic: {}
    };

    test("selects the best match, zooms to it, and reports what it selected", async () => {
      const user = userEvent.setup();
      render(<ApplicationShell />);
      const engine = getEngineInstance();
      engine.searchFeatures.mockResolvedValue([tampines]);
      engine.zoomToSearchResult.mockImplementation(async () => {
        engine.selectedLayerId = "mrtStations";
      });

      await user.click(screen.getByText("run-select-feature"));

      expect(engine.searchFeatures).toHaveBeenCalledWith("Tampines");
      expect(engine.zoomToSearchResult).toHaveBeenCalledWith(tampines);
      expect(lastClientActionOutcome.ok).toBe(true);
      expect(lastClientActionOutcome.data.label).toBe("TAMPINES MRT STATION");
      expect(await screen.findByText('Selected "TAMPINES MRT STATION" on MRT Stations.')).toBeInTheDocument();
    });

    test("reports the other close matches so the model can say which one it picked", async () => {
      const user = userEvent.setup();
      render(<ApplicationShell />);
      const engine = getEngineInstance();
      engine.searchFeatures.mockResolvedValue([
        tampines,
        { ...tampines, label: "TAMPINES EAST MRT STATION" },
        { ...tampines, label: "TAMPINES WEST MRT STATION" }
      ]);
      engine.zoomToSearchResult.mockImplementation(async () => {
        engine.selectedLayerId = "mrtStations";
      });

      await user.click(screen.getByText("run-select-feature"));

      expect(lastClientActionOutcome.data.matchCount).toBe(3);
      expect(lastClientActionOutcome.data.otherMatches).toEqual([
        { label: "TAMPINES EAST MRT STATION", layerTitle: "MRT Stations" },
        { label: "TAMPINES WEST MRT STATION", layerTitle: "MRT Stations" }
      ]);
    });

    test("scoping to a layer that has no match says where it does match instead", async () => {
      const user = userEvent.setup();
      render(<ApplicationShell />);
      const engine = getEngineInstance();
      engine.searchFeatures.mockResolvedValue([tampines]);

      await user.click(screen.getByText("run-select-feature-scoped"));

      expect(engine.zoomToSearchResult).not.toHaveBeenCalled();
      expect(lastClientActionOutcome.ok).toBe(false);
      expect(lastClientActionOutcome.error).toContain("touristAttractions");
      expect(lastClientActionOutcome.error).toContain("mrtStations");
    });

    test("a match the view refuses to select is reported as a failure, not a success", async () => {
      const user = userEvent.setup();
      render(<ApplicationShell />);
      const engine = getEngineInstance();
      engine.searchFeatures.mockResolvedValue([tampines]);
      // zoomToSearchResult returns early, selecting nothing, when there is no
      // live view or goTo throws - it signals that only by leaving the
      // selection untouched.
      engine.zoomToSearchResult.mockResolvedValue(undefined);

      await user.click(screen.getByText("run-select-feature"));

      expect(lastClientActionOutcome.ok).toBe(false);
      expect(lastClientActionOutcome.error).toContain("could not select it");
    });
  });

  test("runClientAction get_layer_aggregate returns the filter-aware count without toasting", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();
    engine.getLayerAggregate.mockResolvedValue({
      id: "mrtStations",
      name: "MRT Stations",
      count: 4,
      stats: { sum: 100, avg: 25 }
    });

    await user.click(screen.getByText("run-get-layer-aggregate"));

    expect(engine.getLayerAggregate).toHaveBeenCalledWith("mrtStations", {
      field: "RIDERSHIP",
      statistics: ["sum", "avg"]
    });
    expect(lastClientActionOutcome.ok).toBe(true);
    expect(lastClientActionOutcome.data.count).toBe(4);
  });

  test("runClientAction rename_layer calls engine.renameLayer and shows a toast", async () => {
    const user = userEvent.setup();
    render(<ApplicationShell />);
    const engine = getEngineInstance();

    await user.click(screen.getByText("run-rename-layer"));

    expect(engine.renameLayer).toHaveBeenCalledWith("portal_abc", "My Parks");
    expect(await screen.findByText('Renamed layer to "My Parks".')).toBeInTheDocument();
  });

  // The manual Filter UI populates its field <select> from
  // getLayerFieldSchema, so it can never send a field that doesn't exist -
  // but the chat's model types the field name itself. Observed directly:
  // "filter out tampines mrt stations from mrt stations" had qwen2.5:1.5b
  // call set_layer_filter with field "name" against an uppercase schema,
  // which GISMapEngine rejected with '"name" is not a field on this layer.'
  // (and the model then reported the failed filter to the user as applied,
  // blaming a zoom_to_layer call it had never made). A chat-supplied field
  // name is now resolved against the real schema first.
  describe("runClientAction set_layer_filter field resolution", () => {
    const mrtFields = { fields: [{ name: "NAME", kind: "string" }, { name: "STATION_NAME", kind: "string" }] };

    test("resolves a lowercased field name to the layer's real, uppercase field", async () => {
      const user = userEvent.setup();
      render(<ApplicationShell />);
      const engine = getEngineInstance();
      engine.getLayerFieldSchema.mockResolvedValue(mrtFields);
      engine.setLayerFilter.mockResolvedValue({ active: true, description: "NAME contains Tampines" });

      await user.click(screen.getByText("run-set-layer-filter"));

      expect(engine.setLayerFilter).toHaveBeenCalledWith("mrtStations", {
        conditions: [{ field: "NAME", operator: "contains", value: "Tampines" }],
        logic: undefined
      });
      expect(lastClientActionOutcome).toEqual({ ok: true, data: { active: true, description: "NAME contains Tampines" } });
    });

    test("resolves a field name whose separators don't match the schema's", async () => {
      const user = userEvent.setup();
      render(<ApplicationShell />);
      const engine = getEngineInstance();
      engine.getLayerFieldSchema.mockResolvedValue(mrtFields);
      engine.setLayerFilter.mockResolvedValue({ active: true, description: "" });

      await user.click(screen.getByText("run-set-layer-filter-separators"));

      expect(engine.setLayerFilter).toHaveBeenCalledWith("mrtStations", {
        conditions: [{ field: "STATION_NAME", operator: "=", value: "Tampines" }],
        logic: undefined
      });
    });

    // The point of the error text: the model's retry should be informed by
    // the real schema rather than being another guess, and the filter must
    // not be applied on some other field it didn't ask about.
    test("a genuinely unknown field fails with the layer's real field list and applies nothing", async () => {
      const user = userEvent.setup();
      render(<ApplicationShell />);
      const engine = getEngineInstance();
      engine.getLayerFieldSchema.mockResolvedValue(mrtFields);
      engine.inferFieldForValue.mockResolvedValue(null);

      await user.click(screen.getByText("run-set-layer-filter-unknown-field"));

      expect(engine.setLayerFilter).not.toHaveBeenCalled();
      expect(lastClientActionOutcome.ok).toBe(false);
      expect(lastClientActionOutcome.error).toContain("NAME, STATION_NAME");
    });

    // The model named a field this layer doesn't have ("title"/"name"), which
    // it did twice in a row in production. The value itself identifies its own
    // field far more reliably, so the data is asked instead of the model.
    test("infers the field from the value when the model's field doesn't exist", async () => {
      const user = userEvent.setup();
      render(<ApplicationShell />);
      const engine = getEngineInstance();
      engine.getLayerFieldSchema.mockResolvedValue(mrtFields);
      engine.inferFieldForValue.mockResolvedValue({ field: "NAME", matchedValue: "Tampines" });
      engine.setLayerFilter.mockResolvedValue({ active: true, description: "" });

      await user.click(screen.getByText("run-set-layer-filter-unknown-field"));

      expect(engine.inferFieldForValue).toHaveBeenCalledWith("mrtStations", "Tampines");
      expect(engine.setLayerFilter).toHaveBeenCalledWith("mrtStations", {
        conditions: [{ field: "NAME", operator: "=", value: "Tampines" }],
        logic: undefined
      });
      // Reported back so the model's reply describes the filter that ran.
      expect(lastClientActionOutcome.data.corrections[0]).toContain("searched NAME");
    });

    // Without this, "filter Tampines" applies NAME = 'Tampines' against values
    // like "TAMPINES MRT STATION" and empties the layer - a filter that looks
    // applied but matches nothing.
    test("promotes = to contains when the probe proves the value is only a substring", async () => {
      const user = userEvent.setup();
      render(<ApplicationShell />);
      const engine = getEngineInstance();
      engine.getLayerFieldSchema.mockResolvedValue(mrtFields);
      engine.inferFieldForValue.mockResolvedValue({ field: "NAME", matchedValue: "TAMPINES MRT STATION" });
      engine.setLayerFilter.mockResolvedValue({ active: true, description: "" });

      await user.click(screen.getByText("run-set-layer-filter-unknown-field"));

      expect(engine.setLayerFilter).toHaveBeenCalledWith("mrtStations", {
        conditions: [{ field: "NAME", operator: "contains", value: "Tampines" }],
        logic: undefined
      });
      expect(lastClientActionOutcome.data.corrections.join(" ")).toContain("substring");
    });

    // "!=" is the obvious operator for "filter OUT x" and is what the tool
    // schema used to advertise, but LayerFilterExpression's table keys it as
    // "<>" - an unmapped token throws '"!=" is not a supported filter operator.'
    // The mirror of the = -> contains promotion: NAME <> 'Tampines' matches
    // EVERY station (none is exactly "Tampines"), so it applies cleanly and
    // filters nothing - which is what "still not filtered" turned out to be.
    test("promotes <> to doesNotContain on the same substring evidence", async () => {
      const user = userEvent.setup();
      render(<ApplicationShell />);
      const engine = getEngineInstance();
      engine.getLayerFieldSchema.mockResolvedValue(mrtFields);
      engine.inferFieldForValue.mockResolvedValue({ field: "NAME", matchedValue: "TAMPINES MRT STATION" });
      engine.setLayerFilter.mockResolvedValue({ active: true, description: "" });

      await user.click(screen.getByText("run-set-layer-filter-sql-operator"));

      expect(engine.setLayerFilter).toHaveBeenCalledWith("mrtStations", {
        conditions: [{ field: "NAME", operator: "doesNotContain", value: "Tampines" }],
        logic: undefined
      });
    });

    test("maps SQL-flavoured operator spellings onto the engine's real tokens", async () => {
      const user = userEvent.setup();
      render(<ApplicationShell />);
      const engine = getEngineInstance();
      engine.getLayerFieldSchema.mockResolvedValue(mrtFields);
      engine.inferFieldForValue.mockResolvedValue({ field: "NAME", matchedValue: "Tampines" });
      engine.setLayerFilter.mockResolvedValue({ active: true, description: "" });

      await user.click(screen.getByText("run-set-layer-filter-sql-operator"));

      expect(engine.setLayerFilter).toHaveBeenCalledWith("mrtStations", {
        conditions: [{ field: "NAME", operator: "<>", value: "Tampines" }],
        logic: undefined
      });
    });
  });

  // Field names reach the model up front in the map context, so a correct
  // first attempt doesn't depend on it guessing - on CPU-only Ollama a
  // wasted round trip costs minutes (see mcp-chat-proxy/config.js).
  test("the chat map context carries each layer's real field names", async () => {
    GISMapEngine.prototype.getLayers.mockReturnValue([{ id: "mrtStations", name: "MRT Stations", styleGroups: [] }]);
    GISMapEngine.prototype.getFilterableLayers.mockReturnValue([{ id: "mrtStations", name: "MRT Stations" }]);
    GISMapEngine.prototype.getLayerFieldSchema.mockResolvedValue({
      fields: [{ name: "NAME", kind: "string" }, { name: "LINE", kind: "string" }]
    });

    const user = userEvent.setup();
    render(<ApplicationShell />);
    await readyTheView(user);

    expect(await screen.findByText('chat-layer-fields:[["NAME","LINE"]]')).toBeInTheDocument();
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
    await waitFor(() => {
      expect(screen.getByTestId("account-signed-in-user")).toHaveTextContent("Jane Doe");
    });
  });

  test("signing in updates the signed-in user and shows a success toast", async () => {
    const user = userEvent.setup();
    isOAuthConfigured.mockReturnValue(true);
    checkSignInStatus.mockResolvedValue(null);
    signIn.mockResolvedValue({ username: "jdoe", fullName: "Jane Doe" });
    render(<ApplicationShell />);

    await user.click(screen.getByText("sign-in"));

    expect(await screen.findByText("Signed in as Jane Doe.")).toBeInTheDocument();
    expect(screen.getByTestId("account-signed-in-user")).toHaveTextContent("Jane Doe");
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
    await waitFor(() => {
      expect(screen.getByTestId("account-signed-in-user")).toHaveTextContent("Jane Doe");
    });

    await user.click(screen.getByText("sign-out"));

    expect(signOut).toHaveBeenCalled();
    expect(await screen.findByText("Signed out.")).toBeInTheDocument();
    expect(screen.getByTestId("account-signed-in-user")).toHaveTextContent("");
    expect(screen.getByTestId("signed-in-user")).toHaveTextContent("");
  });
});
