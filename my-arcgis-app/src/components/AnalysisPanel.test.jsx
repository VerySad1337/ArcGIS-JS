import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AnalysisPanel from "./AnalysisPanel";

describe("AnalysisPanel", () => {
  test("is collapsed by default and reveals the route form when the Route Search section is opened", async () => {
    const user = userEvent.setup();
    const onRoute = jest.fn();
    render(
      <AnalysisPanel
        onBuffer={jest.fn()}
        onToggleSlice={jest.fn()}
        routeOn={true}
        toggleRoute={jest.fn()}
        onRoute={onRoute}
      />
    );

    expect(screen.queryByPlaceholderText("Start location")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ANALYSIS" }));
    expect(screen.queryByPlaceholderText("Start location")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Route Search" }));
    await user.type(screen.getByPlaceholderText("Start location"), "A");
    await user.type(screen.getByPlaceholderText("End location"), "B");
    await user.click(screen.getByRole("button", { name: "Calculate Route" }));

    expect(onRoute).toHaveBeenCalledWith("A", "B");
  });

  test("route toggle button calls toggleRoute and reflects routeOn label", async () => {
    const user = userEvent.setup();
    const toggleRoute = jest.fn();
    const { rerender } = render(
      <AnalysisPanel
        onBuffer={jest.fn()}
        onToggleSlice={jest.fn()}
        routeOn={true}
        toggleRoute={toggleRoute}
        onRoute={jest.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "ANALYSIS" }));
    await user.click(screen.getByRole("button", { name: "Route Search" }));
    expect(screen.getByRole("button", { name: "Hide Route" })).toBeInTheDocument();

    rerender(
      <AnalysisPanel
        onBuffer={jest.fn()}
        onToggleSlice={jest.fn()}
        routeOn={false}
        toggleRoute={toggleRoute}
        onRoute={jest.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Show Route" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show Route" }));
    expect(toggleRoute).toHaveBeenCalled();
  });

  test("buffer section is independently collapsible and the apply button is gated on selection + distance", async () => {
    const user = userEvent.setup();
    const onBuffer = jest.fn();
    render(
      <AnalysisPanel
        selectedFeature={{ geometry: {} }}
        onBuffer={onBuffer}
        onToggleSlice={jest.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "ANALYSIS" }));
    expect(screen.queryByLabelText("Buffer distance")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Buffer" }));
    await user.clear(screen.getByLabelText("Buffer distance"));
    await user.type(screen.getByLabelText("Buffer distance"), "50");
    await user.click(screen.getByRole("button", { name: "Apply Buffer" }));

    expect(onBuffer).toHaveBeenCalledWith(50, "meters");
  });

  test("slice section is independently collapsible and shows a hint instead of the toggle button in 2D", async () => {
    const user = userEvent.setup();
    render(<AnalysisPanel is3D={false} onBuffer={jest.fn()} onToggleSlice={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: "ANALYSIS" }));
    expect(screen.queryByText("Switch to 3D view to use Slice.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Slice" }));

    expect(screen.getByText("Switch to 3D view to use Slice.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start Slice" })).not.toBeInTheDocument();
  });

  describe("Heatmap section", () => {
    const eligibleLayers = [
      {
        id: "touristAttractions",
        name: "Tourist Attractions",
        styleGroups: [
          { symbolType: "simple-marker", label: "Tourist Attractions", color: "#ff0000", borderWidth: 1, heatmapEligible: true }
        ]
      },
      {
        id: "mrtLines",
        name: "MRT Lines",
        styleGroups: [
          { symbolType: "simple-line", label: "Lines", color: "#000000", borderWidth: 1, heatmapEligible: false }
        ]
      }
    ];

    test("is not rendered when onCreateHeatmapLayer is not provided", async () => {
      const user = userEvent.setup();
      render(<AnalysisPanel onBuffer={jest.fn()} onToggleSlice={jest.fn()} layers={eligibleLayers} />);

      await user.click(screen.getByRole("button", { name: "ANALYSIS" }));
      expect(screen.queryByRole("button", { name: "Heatmap" })).not.toBeInTheDocument();
    });

    test("shows a hint instead of the form when no layer has a heatmap-eligible style group", async () => {
      const user = userEvent.setup();
      render(
        <AnalysisPanel
          onBuffer={jest.fn()}
          onToggleSlice={jest.fn()}
          layers={[eligibleLayers[1]]}
          onCreateHeatmapLayer={jest.fn()}
        />
      );

      await user.click(screen.getByRole("button", { name: "ANALYSIS" }));
      await user.click(screen.getByRole("button", { name: "Heatmap" }));

      expect(screen.getByText(/Add a point layer/)).toBeInTheDocument();
      expect(screen.queryByLabelText("Heatmap source layer")).not.toBeInTheDocument();
    });

    test("only lists heatmap-eligible layers as source options", async () => {
      const user = userEvent.setup();
      render(
        <AnalysisPanel
          onBuffer={jest.fn()}
          onToggleSlice={jest.fn()}
          layers={eligibleLayers}
          onCreateHeatmapLayer={jest.fn()}
        />
      );

      await user.click(screen.getByRole("button", { name: "ANALYSIS" }));
      await user.click(screen.getByRole("button", { name: "Heatmap" }));

      const select = screen.getByLabelText("Heatmap source layer");
      const optionLabels = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
      expect(optionLabels).toEqual(["Choose a layer…", "Tourist Attractions"]);
    });

    test("excludes drawings even when it has a heatmap-eligible (point) style group, since it has no url to duplicate into a new layer", async () => {
      const user = userEvent.setup();
      render(
        <AnalysisPanel
          onBuffer={jest.fn()}
          onToggleSlice={jest.fn()}
          layers={[
            eligibleLayers[0],
            {
              id: "drawings",
              name: "Drawings",
              styleGroups: [
                { symbolType: "simple-marker", label: "Points", color: "#ff0000", borderWidth: 1, heatmapEligible: true }
              ]
            }
          ]}
          onCreateHeatmapLayer={jest.fn()}
        />
      );

      await user.click(screen.getByRole("button", { name: "ANALYSIS" }));
      await user.click(screen.getByRole("button", { name: "Heatmap" }));

      const select = screen.getByLabelText("Heatmap source layer");
      const optionLabels = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
      expect(optionLabels).toEqual(["Choose a layer…", "Tourist Attractions"]);
    });

    test("Add Heatmap Layer button is disabled until a source and a name are given", async () => {
      const user = userEvent.setup();
      render(
        <AnalysisPanel
          onBuffer={jest.fn()}
          onToggleSlice={jest.fn()}
          layers={eligibleLayers}
          onCreateHeatmapLayer={jest.fn()}
        />
      );

      await user.click(screen.getByRole("button", { name: "ANALYSIS" }));
      await user.click(screen.getByRole("button", { name: "Heatmap" }));

      const button = screen.getByRole("button", { name: "Add Heatmap Layer" });
      expect(button).toBeDisabled();

      await user.selectOptions(screen.getByLabelText("Heatmap source layer"), "touristAttractions");
      expect(button).toBeDisabled();

      await user.type(screen.getByLabelText("New heatmap layer name"), "Attraction Density");
      expect(button).toBeEnabled();
    });

    test("submitting calls onCreateHeatmapLayer with the source id and trimmed name, with no intensity control on this form", async () => {
      const user = userEvent.setup();
      const onCreateHeatmapLayer = jest.fn().mockResolvedValue(undefined);
      render(
        <AnalysisPanel
          onBuffer={jest.fn()}
          onToggleSlice={jest.fn()}
          layers={eligibleLayers}
          onCreateHeatmapLayer={onCreateHeatmapLayer}
        />
      );

      await user.click(screen.getByRole("button", { name: "ANALYSIS" }));
      await user.click(screen.getByRole("button", { name: "Heatmap" }));

      expect(screen.queryByLabelText(/intensity/i)).not.toBeInTheDocument();

      await user.selectOptions(screen.getByLabelText("Heatmap source layer"), "touristAttractions");
      await user.type(screen.getByLabelText("New heatmap layer name"), "  Attraction Density  ");
      await user.click(screen.getByRole("button", { name: "Add Heatmap Layer" }));

      expect(onCreateHeatmapLayer).toHaveBeenCalledWith("touristAttractions", { name: "Attraction Density" });
    });
  });

  describe("Route Search — Add to Layers", () => {
    test("is not rendered when onCreateRouteLayer is not provided", async () => {
      const user = userEvent.setup();
      render(
        <AnalysisPanel
          onBuffer={jest.fn()}
          onToggleSlice={jest.fn()}
          routeOn={true}
          toggleRoute={jest.fn()}
          onRoute={jest.fn()}
          hasRoute={true}
        />
      );

      await user.click(screen.getByRole("button", { name: "ANALYSIS" }));
      await user.click(screen.getByRole("button", { name: "Route Search" }));

      expect(screen.queryByLabelText("New route layer name")).not.toBeInTheDocument();
    });

    test("shows a hint instead of the form when no route has been searched yet", async () => {
      const user = userEvent.setup();
      render(
        <AnalysisPanel
          onBuffer={jest.fn()}
          onToggleSlice={jest.fn()}
          routeOn={true}
          toggleRoute={jest.fn()}
          onRoute={jest.fn()}
          hasRoute={false}
          onCreateRouteLayer={jest.fn()}
        />
      );

      await user.click(screen.getByRole("button", { name: "ANALYSIS" }));
      await user.click(screen.getByRole("button", { name: "Route Search" }));

      expect(screen.getByText("Search a route first, then add it to the layers card.")).toBeInTheDocument();
      expect(screen.queryByLabelText("New route layer name")).not.toBeInTheDocument();
    });

    test("Add to Layers button is disabled until a name is given, and submits the trimmed name", async () => {
      const user = userEvent.setup();
      const onCreateRouteLayer = jest.fn().mockResolvedValue(undefined);
      render(
        <AnalysisPanel
          onBuffer={jest.fn()}
          onToggleSlice={jest.fn()}
          routeOn={true}
          toggleRoute={jest.fn()}
          onRoute={jest.fn()}
          hasRoute={true}
          onCreateRouteLayer={onCreateRouteLayer}
        />
      );

      await user.click(screen.getByRole("button", { name: "ANALYSIS" }));
      await user.click(screen.getByRole("button", { name: "Route Search" }));

      const button = screen.getByRole("button", { name: "Add to Layers" });
      expect(button).toBeDisabled();

      await user.type(screen.getByLabelText("New route layer name"), "  Home to Office  ");
      expect(button).toBeEnabled();

      await user.click(button);
      expect(onCreateRouteLayer).toHaveBeenCalledWith("Home to Office");
    });
  });
});
