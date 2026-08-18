import fs from "fs";
import path from "path";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LayerControlPanel from "./LayerControlPanel";

// Real CSS is mocked out for every other test in this file (see
// jest.config.cjs's moduleNameMapper), which is normally the right call -
// but it means a class-name collision with an unrelated rule (like the one
// below) can slip past every test that only checks for an element's
// presence. Load the actual stylesheet just for this one regression check.
const REAL_CSS = fs.readFileSync(path.resolve(__dirname, "../styles/gis-theme.css"), "utf8");

const baseLayers = [
  { id: "route", name: "Route Layer", visible: true, styleGroups: [] },
  {
    id: "touristAttractions",
    name: "Tourist Attractions",
    visible: true,
    styleGroups: [{ symbolType: "simple-marker", label: "Tourist Attractions", color: "#ff0000", borderWidth: 1 }]
  },
  { id: "heat", name: "Heatmap", visible: true, styleGroups: [] }
];

const FIELDS = {
  touristAttractions: {
    fields: [
      { name: "RATING", kind: "number" },
      { name: "NAME", kind: "string" }
    ]
  }
};

function setup(overrides = {}) {
  const props = {
    layers: baseLayers,
    onToggle: jest.fn(),
    onReorder: jest.fn(),
    onStyleChange: jest.fn(),
    onZoomToLayer: jest.fn(),
    onRemove: jest.fn(),
    onGetLayerFields: jest.fn((id) => Promise.resolve(FIELDS[id] || { fields: [] })),
    onApplyFilter: jest.fn().mockResolvedValue(undefined),
    onClearFilter: jest.fn(),
    onRunAggregate: jest.fn().mockResolvedValue({ total: { count: 3, sum: 12 } }),
    onSetAnnotation: jest.fn().mockResolvedValue(undefined),
    onClearAnnotation: jest.fn(),
    onSetRenderer: jest.fn().mockResolvedValue(undefined),
    onClearRenderer: jest.fn(),
    onUpdateRendererEntry: jest.fn(),
    onUpdateHeatmapLayerIntensity: jest.fn(),
    ...overrides
  };
  const utils = render(<LayerControlPanel {...props} />);
  return { ...utils, props };
}

describe("LayerControlPanel", () => {
  test("renders a row per layer and filters out falsy entries", () => {
    setup({ layers: [...baseLayers, null, undefined] });
    expect(screen.getByText("Route Layer")).toBeInTheDocument();
    expect(screen.getByText("Tourist Attractions")).toBeInTheDocument();
    expect(screen.getByText("Heatmap")).toBeInTheDocument();
  });

  test("toggling visibility calls onToggle with the layer id", async () => {
    const user = userEvent.setup();
    const { props } = setup();
    const eyeButtons = document.querySelectorAll(".layer-eye-btn");
    await user.click(eyeButtons[0]);
    expect(props.onToggle).toHaveBeenCalledWith("route");
  });

  test("shows an open eye icon when visible and a blocked icon when hidden", () => {
    setup({ layers: [{ ...baseLayers[0], visible: false }] });
    expect(screen.getByRole("button", { name: `Show ${baseLayers[0].name}` })).toBeInTheDocument();
  });

  test("up/down reorder buttons call onReorder and are disabled at the boundaries", async () => {
    const user = userEvent.setup();
    const { props } = setup();

    const upButtons = screen.getAllByRole("button", { name: "Move layer up" });
    const downButtons = screen.getAllByRole("button", { name: "Move layer down" });

    expect(upButtons[0]).toBeDisabled();
    expect(downButtons.at(-1)).toBeDisabled();

    await user.click(downButtons[0]);
    expect(props.onReorder).toHaveBeenCalledWith(0, 1);

    await user.click(upButtons[1]);
    expect(props.onReorder).toHaveBeenCalledWith(1, 0);
  });

  test("ArrowUp/ArrowDown on the drag handle move the layer", () => {
    const { props } = setup();
    const dragHandles = screen.getAllByRole("button", { name: /Drag to reorder/ });

    fireEvent.keyDown(dragHandles[1], { key: "ArrowUp" });
    expect(props.onReorder).toHaveBeenCalledWith(1, 0);

    fireEvent.keyDown(dragHandles[1], { key: "ArrowDown" });
    expect(props.onReorder).toHaveBeenCalledWith(1, 2);
  });

  test("drag-and-drop onto another row calls onReorder with the dragged and target indices", () => {
    const { props } = setup();
    const rows = document.querySelectorAll(".layer-row");
    const dragHandles = screen.getAllByRole("button", { name: /Drag to reorder/ });

    fireEvent.dragStart(dragHandles[0]);
    fireEvent.dragOver(rows[2]);
    fireEvent.drop(rows[2]);

    expect(props.onReorder).toHaveBeenCalledWith(0, 2);
  });

  test("dragEnd clears the pending drag index", () => {
    const { props } = setup();
    const rows = document.querySelectorAll(".layer-row");
    const dragHandles = screen.getAllByRole("button", { name: /Drag to reorder/ });

    fireEvent.dragStart(dragHandles[0]);
    fireEvent.dragEnd(dragHandles[0]);
    fireEvent.drop(rows[2]);

    expect(props.onReorder).not.toHaveBeenCalled();
  });

  test("dropping on the same row that started the drag does not call onReorder", () => {
    const { props } = setup();
    const rows = document.querySelectorAll(".layer-row");
    const dragHandles = screen.getAllByRole("button", { name: /Drag to reorder/ });

    fireEvent.dragStart(dragHandles[0]);
    fireEvent.drop(rows[0]);

    expect(props.onReorder).not.toHaveBeenCalled();
  });

  test("the style chevron is hidden/disabled for layers with no styleGroups", () => {
    setup();
    const chevrons = document.querySelectorAll(".layer-chevron-btn");
    expect(chevrons[0]).toBeDisabled();
    expect(chevrons[0]).toHaveStyle({ visibility: "hidden" });
  });

  test("expanding a stylable layer reveals its color and border controls", async () => {
    const user = userEvent.setup();
    setup();
    const chevrons = document.querySelectorAll(".layer-chevron-btn");

    await user.click(chevrons[1]);
    await user.click(screen.getByRole("button", { name: "Symbology" }));

    expect(screen.getByText("Color")).toBeInTheDocument();
    expect(screen.getByText("Border Width")).toBeInTheDocument();
    expect(screen.queryByText("Fill Color")).not.toBeInTheDocument();
  });

  test("polygon style groups show Fill Color and Border Color instead of Color", async () => {
    const user = userEvent.setup();
    setup({
      layers: [
        {
          id: "drawings",
          name: "Drawings",
          visible: true,
          styleGroups: [
            { symbolType: "simple-fill", label: "Polygons", color: "#111111", outlineColor: "#222222", borderWidth: 2 }
          ]
        }
      ]
    });

    await user.click(screen.getByRole("button", { name: "Toggle layer styling and filter options" }));
    await user.click(screen.getByRole("button", { name: "Symbology" }));

    expect(screen.getByText("Fill Color")).toBeInTheDocument();
    expect(screen.getByText("Border Color")).toBeInTheDocument();
  });

  test("changing color/border-width/outline-color calls onStyleChange scoped to the group's symbolType", async () => {
    const { props } = setup({
      layers: [
        {
          id: "drawings",
          name: "Drawings",
          visible: true,
          styleGroups: [
            { symbolType: "simple-fill", label: "Polygons", color: "#111111", outlineColor: "#222222", borderWidth: 2 }
          ]
        }
      ]
    });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Toggle layer styling and filter options" }));
    await user.click(screen.getByRole("button", { name: "Symbology" }));

    const [fillColorInput, borderColorInput] = document.querySelectorAll('input[type="color"]');
    const widthInput = document.querySelector('input[type="number"]');

    fireEvent.change(fillColorInput, { target: { value: "#abcdef" } });
    expect(props.onStyleChange).toHaveBeenCalledWith("drawings", { color: "#abcdef", symbolType: "simple-fill" });

    fireEvent.change(borderColorInput, { target: { value: "#fedcba" } });
    expect(props.onStyleChange).toHaveBeenCalledWith("drawings", {
      outlineColor: "#fedcba",
      symbolType: "simple-fill"
    });

    fireEvent.change(widthInput, { target: { value: "5" } });
    expect(props.onStyleChange).toHaveBeenCalledWith("drawings", { borderWidth: 5, symbolType: "simple-fill" });
  });

  test("shows a group label when a layer has multiple style groups", async () => {
    const user = userEvent.setup();
    setup({
      layers: [
        {
          id: "drawings",
          name: "Drawings",
          visible: true,
          styleGroups: [
            { symbolType: "simple-marker", label: "Points", color: "#fff", borderWidth: 1 },
            { symbolType: "simple-line", label: "Lines", color: "#000", borderWidth: 2 }
          ]
        }
      ]
    });

    await user.click(screen.getByRole("button", { name: "Toggle layer styling and filter options" }));
    await user.click(screen.getByRole("button", { name: "Symbology" }));

    expect(screen.getByText("Points")).toBeInTheDocument();
    expect(screen.getByText("Lines")).toBeInTheDocument();
  });

  test("offers a Heatmap renderer mode for a heatmap-eligible style group", async () => {
    const user = userEvent.setup();
    setup({
      layers: [
        {
          id: "touristAttractions",
          name: "Tourist Attractions",
          visible: true,
          styleGroups: [
            {
              symbolType: "simple-marker",
              label: "Tourist Attractions",
              color: "#ff0000",
              borderWidth: 1,
              heatmapEligible: true
            }
          ]
        }
      ]
    });

    await user.click(screen.getByRole("button", { name: "Toggle layer styling and filter options" }));
    await user.click(screen.getByRole("button", { name: "Symbology" }));
    expect(screen.getByRole("button", { name: "Heatmap" })).toBeInTheDocument();
  });

  test("does not offer Heatmap for a non-eligible (line) style group", async () => {
    const user = userEvent.setup();
    setup({
      layers: [
        {
          id: "mrtLines",
          name: "MRT Lines",
          visible: true,
          styleGroups: [
            { symbolType: "simple-line", label: "Lines", color: "#000000", borderWidth: 1, heatmapEligible: false }
          ]
        }
      ]
    });

    await user.click(screen.getByRole("button", { name: "Toggle layer styling and filter options" }));
    await user.click(screen.getByRole("button", { name: "Symbology" }));
    expect(screen.queryByRole("button", { name: "Heatmap" })).not.toBeInTheDocument();
  });

  describe("named heatmap layer rows", () => {
    test("the intensity slider is collapsed behind the row chevron and a Heat Intensity toggle, only while the heatmap layer is visible", async () => {
      const user = userEvent.setup();
      const { rerender, props } = setup({
        layers: [{ id: "heatmap_abc", name: "Attraction Density", visible: true, styleGroups: [], heatmap: true, heatmapIntensity: 65 }]
      });

      expect(screen.queryByText("Heat Intensity: 65")).not.toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Toggle layer styling and filter options" }));
      await user.click(screen.getByRole("button", { name: "Heat Intensity" }));
      expect(screen.getByText("Heat Intensity: 65")).toBeInTheDocument();

      rerender(
        <LayerControlPanel
          {...props}
          layers={[{ id: "heatmap_abc", name: "Attraction Density", visible: false, styleGroups: [], heatmap: true, heatmapIntensity: 65 }]}
        />
      );
      expect(screen.queryByText(/Heat Intensity/)).not.toBeInTheDocument();
    });

    test("moving the slider calls onUpdateHeatmapLayerIntensity with that layer's id and a number", async () => {
      const user = userEvent.setup();
      const { props } = setup({
        layers: [{ id: "heatmap_abc", name: "Attraction Density", visible: true, styleGroups: [], heatmap: true, heatmapIntensity: 65 }]
      });

      await user.click(screen.getByRole("button", { name: "Toggle layer styling and filter options" }));
      await user.click(screen.getByRole("button", { name: "Heat Intensity" }));

      const slider = screen.getByLabelText("Heatmap intensity for Attraction Density");
      fireEvent.change(slider, { target: { value: "40" } });

      expect(props.onUpdateHeatmapLayerIntensity).toHaveBeenCalledWith("heatmap_abc", 40);
    });

    test("shows a remove button, same as a portal layer", async () => {
      const user = userEvent.setup();
      const { props } = setup({
        layers: [{ id: "heatmap_abc", name: "Attraction Density", visible: true, removable: true, styleGroups: [], heatmap: true, heatmapIntensity: 65 }]
      });

      await user.click(screen.getByRole("button", { name: "Remove Attraction Density" }));
      expect(props.onRemove).toHaveBeenCalledWith("heatmap_abc");
    });

    test("shows a pulsing \"Rendering…\" badge next to the name while heatmapUpdating is true, and hides it once false", () => {
      const { rerender, props } = setup({
        layers: [{ id: "heatmap_abc", name: "Attraction Density", visible: true, styleGroups: [], heatmap: true, heatmapIntensity: 65, heatmapUpdating: true }]
      });

      expect(screen.getByText("Rendering…")).toBeInTheDocument();

      rerender(
        <LayerControlPanel
          {...props}
          layers={[{ id: "heatmap_abc", name: "Attraction Density", visible: true, styleGroups: [], heatmap: true, heatmapIntensity: 65, heatmapUpdating: false }]}
        />
      );

      expect(screen.queryByText("Rendering…")).not.toBeInTheDocument();
    });
  });

  test("selecting Heatmap mode and applying calls onSetRenderer with the chosen intensity", async () => {
    const user = userEvent.setup();
    const { props } = setup({
      layers: [
        {
          id: "touristAttractions",
          name: "Tourist Attractions",
          visible: true,
          styleGroups: [
            {
              symbolType: "simple-marker",
              label: "Tourist Attractions",
              color: "#ff0000",
              borderWidth: 1,
              heatmapEligible: true
            }
          ]
        }
      ]
    });

    await user.click(screen.getByRole("button", { name: "Toggle layer styling and filter options" }));
    await user.click(screen.getByRole("button", { name: "Symbology" }));
    await user.click(screen.getByRole("button", { name: "Heatmap" }));

    const slider = screen.getByLabelText("Heatmap intensity for Tourist Attractions");
    fireEvent.change(slider, { target: { value: "77" } });
    expect(screen.getByText("Heat Intensity: 77")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Apply Heatmap" }));
    expect(props.onSetRenderer).toHaveBeenCalledWith("touristAttractions", {
      type: "heatmap",
      symbolType: "simple-marker",
      intensity: 77
    });
  });

  test("bumping projectVersion remounts an open Heatmap Symbology section so it re-seeds from the just-loaded intensity, instead of keeping the pre-load value", async () => {
    const user = userEvent.setup();
    const layerWithIntensity = (intensity) => [
      {
        id: "touristAttractions",
        name: "Tourist Attractions",
        visible: true,
        styleGroups: [
          {
            symbolType: "simple-marker",
            label: "Tourist Attractions",
            color: "#ff0000",
            borderWidth: 1,
            heatmapEligible: true,
            rendererType: "heatmap",
            rendererIntensity: intensity
          }
        ]
      }
    ];

    const { rerender, props } = setup({ layers: layerWithIntensity(30), projectVersion: 1 });

    await user.click(screen.getByRole("button", { name: "Toggle layer styling and filter options" }));
    await user.click(screen.getByRole("button", { name: "Symbology" }));
    expect(screen.getByText("Heat Intensity: 30")).toBeInTheDocument();

    // Simulate a project load that restored a different persisted intensity
    // while this section is still open - the same object shape a fresh
    // getLayers() call after loadProjectState returns, paired with the
    // projectVersion bump ApplicationShell.loadProject performs.
    rerender(
      <LayerControlPanel {...props} layers={layerWithIntensity(85)} projectVersion={2} />
    );

    expect(screen.getByText("Heat Intensity: 85")).toBeInTheDocument();
  });

  test("clicking a layer's zoom button calls onZoomToLayer with that layer's id", async () => {
    const user = userEvent.setup();
    const { props } = setup();

    await user.click(screen.getByRole("button", { name: "Zoom to Tourist Attractions" }));
    expect(props.onZoomToLayer).toHaveBeenCalledWith("touristAttractions");
  });

  test("shows a remove button only for removable (portal-added) layers", () => {
    setup({
      layers: [
        ...baseLayers,
        { id: "portal_abc", name: "Parks", visible: true, styleGroups: [], removable: true }
      ]
    });

    expect(screen.getByRole("button", { name: "Remove Parks" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Route Layer" })).not.toBeInTheDocument();
  });

  test("clicking a layer's remove button calls onRemove with that layer's id", async () => {
    const user = userEvent.setup();
    const { props } = setup({
      layers: [{ id: "portal_abc", name: "Parks", visible: true, styleGroups: [], removable: true }]
    });

    await user.click(screen.getByRole("button", { name: "Remove Parks" }));
    expect(props.onRemove).toHaveBeenCalledWith("portal_abc");
  });

  describe("inline filter & aggregate", () => {
    const filterableLayers = [
      { id: "touristAttractions", name: "Tourist Attractions", visible: true, styleGroups: [], filterable: true }
    ];

    test("the chevron is enabled for a filterable layer even with no styleGroups", () => {
      setup({ layers: filterableLayers });
      const chevron = screen.getByRole("button", { name: "Toggle layer styling and filter options" });
      expect(chevron).toBeEnabled();
      expect(chevron).toHaveStyle({ visibility: "visible" });
    });

    test("expanding a filterable layer loads its field schema, and opening Filter shows a filter builder", async () => {
      const user = userEvent.setup();
      const { props } = setup({ layers: filterableLayers });

      await user.click(screen.getByRole("button", { name: "Toggle layer styling and filter options" }));
      expect(props.onGetLayerFields).toHaveBeenCalledWith("touristAttractions");

      await user.click(screen.getByRole("button", { name: "Filter" }));
      expect(await screen.findByLabelText("Field")).toBeInTheDocument();
    });

    test("builds a condition and applies the filter, scoped to that layer's id", async () => {
      const user = userEvent.setup();
      const { props } = setup({ layers: filterableLayers });

      await user.click(screen.getByRole("button", { name: "Toggle layer styling and filter options" }));
      await user.click(screen.getByRole("button", { name: "Filter" }));
      await screen.findByLabelText("Field");

      await user.selectOptions(screen.getByLabelText("Field"), "RATING");
      await user.selectOptions(screen.getByLabelText("Operator"), "at least");
      await user.type(screen.getByLabelText("Value"), "4");
      await user.click(screen.getByRole("button", { name: "Apply Filter" }));

      expect(props.onApplyFilter).toHaveBeenCalledWith("touristAttractions", {
        conditions: [{ field: "RATING", operator: ">=", value: "4" }],
        logic: "AND"
      });
    });

    // Reported against a chat-applied filter: the row showed "filtered" and
    // "NAME contains Tampines", but the editable condition row underneath was
    // blank - so the applied filter wasn't visible or adjustable, and pressing
    // Apply Filter on that blank row would have cleared it.
    test("seeds the condition rows from the layer's active filter instead of showing a blank row", async () => {
      const user = userEvent.setup();
      setup({
        layers: [
          {
            ...filterableLayers[0],
            filterDescription: "NAME contains Tampines",
            filterConditions: [{ field: "NAME", operator: "contains", value: "Tampines" }],
            filterLogic: "AND"
          }
        ]
      });

      await user.click(screen.getByRole("button", { name: "Toggle layer styling and filter options" }));
      await user.click(screen.getByRole("button", { name: "Filter" }));

      expect(await screen.findByLabelText("Field")).toHaveValue("NAME");
      expect(screen.getByLabelText("Operator")).toHaveValue("contains");
      expect(screen.getByLabelText("Value")).toHaveValue("Tampines");
    });

    // Re-applying without editing must reproduce the same filter, not clear it.
    test("re-applying a seeded filter sends the same conditions back", async () => {
      const user = userEvent.setup();
      const { props } = setup({
        layers: [
          {
            ...filterableLayers[0],
            filterDescription: "NAME contains Tampines",
            filterConditions: [{ field: "NAME", operator: "contains", value: "Tampines" }],
            filterLogic: "AND"
          }
        ]
      });

      await user.click(screen.getByRole("button", { name: "Toggle layer styling and filter options" }));
      await user.click(screen.getByRole("button", { name: "Filter" }));
      await screen.findByLabelText("Field");
      await user.click(screen.getByRole("button", { name: "Apply Filter" }));

      expect(props.onApplyFilter).toHaveBeenCalledWith("touristAttractions", {
        conditions: [{ field: "NAME", operator: "contains", value: "Tampines" }],
        logic: "AND"
      });
    });

    test("shows the active filter description with a clear control when the layer is already filtered", async () => {
      const user = userEvent.setup();
      const { props } = setup({
        layers: [{ ...filterableLayers[0], filterDescription: "RATING at least 4" }]
      });

      expect(screen.getByText("filtered")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Toggle layer styling and filter options" }));
      await user.click(screen.getByRole("button", { name: "Filter" }));
      expect(await screen.findByText("RATING at least 4")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Clear filter on Tourist Attractions" }));
      expect(props.onClearFilter).toHaveBeenCalledWith("touristAttractions");
    });

    test("running an aggregate calls onRunAggregate scoped to the single layer id and shows its result", async () => {
      const user = userEvent.setup();
      const { props } = setup({ layers: filterableLayers });

      await user.click(screen.getByRole("button", { name: "Toggle layer styling and filter options" }));
      await user.click(screen.getByRole("button", { name: "Aggregate" }));
      await screen.findByPlaceholderText("e.g. RATING");

      await user.type(screen.getByPlaceholderText("e.g. RATING"), "RATING");
      await user.click(screen.getByRole("checkbox", { name: "Sum" }));
      await user.click(screen.getByRole("button", { name: "Run Aggregate" }));

      expect(props.onRunAggregate).toHaveBeenCalledWith(["touristAttractions"], {
        field: "RATING",
        statistics: ["sum"]
      });

      expect(await screen.findByText(/Count: 3/)).toBeInTheDocument();
      expect(screen.getByText(/Sum: 12/)).toBeInTheDocument();
    });

    test("statistic checkboxes are disabled until a numeric field is entered", async () => {
      const user = userEvent.setup();
      setup({ layers: filterableLayers });

      await user.click(screen.getByRole("button", { name: "Toggle layer styling and filter options" }));
      await user.click(screen.getByRole("button", { name: "Aggregate" }));
      await screen.findByPlaceholderText("e.g. RATING");

      expect(screen.getByRole("checkbox", { name: "Sum" })).toBeDisabled();
      await user.type(screen.getByPlaceholderText("e.g. RATING"), "RATING");
      expect(screen.getByRole("checkbox", { name: "Sum" })).toBeEnabled();
    });
  });

  describe("layer grouping", () => {
    async function addGroup(user, name) {
      await user.type(screen.getByLabelText("New group name"), name);
      await user.click(screen.getByRole("button", { name: "+ Add Group" }));
    }

    test("no group selector is shown until a group exists", () => {
      setup();
      expect(screen.queryByLabelText(/^Group /)).not.toBeInTheDocument();
    });

    test("creating a group renders it as a collapsible header, open by default, with a member count", async () => {
      const user = userEvent.setup();
      setup();

      await addGroup(user, "My Group");

      expect(screen.getByLabelText("New group name")).toHaveValue("");
      const header = screen.getByRole("button", { name: "My Group (0)" });
      expect(header).toHaveAttribute("aria-expanded", "true");
    });

    test("assigning the first layer to a new group does not reorder it (it anchors the group)", async () => {
      const user = userEvent.setup();
      const { props } = setup();

      await addGroup(user, "My Group");
      await user.selectOptions(screen.getByLabelText("Group Heatmap"), "group-1");

      expect(props.onReorder).not.toHaveBeenCalled();
      const header = screen.getByRole("button", { name: "My Group (1)" });
      const body = header.closest(".layer-group").querySelector(".layer-group-body");
      expect(within(body).getByText("Heatmap")).toBeInTheDocument();
    });

    test("assigning a second layer to a group moves it to sit contiguously after the existing member", async () => {
      const user = userEvent.setup();
      const { props } = setup();

      await addGroup(user, "My Group");
      // Heatmap (index 2) joins first - no existing members, no reorder.
      await user.selectOptions(screen.getByLabelText("Group Heatmap"), "group-1");
      // Route Layer (index 0) joins second - should move to sit right after Heatmap.
      await user.selectOptions(screen.getByLabelText("Group Route Layer"), "group-1");

      expect(props.onReorder).toHaveBeenCalledWith(0, 2);
    });

    test("deleting a group ungroups its members without reordering, and removes the header", async () => {
      const user = userEvent.setup();
      const { props } = setup();

      await addGroup(user, "My Group");
      await user.selectOptions(screen.getByLabelText("Group Heatmap"), "group-1");
      props.onReorder.mockClear();

      await user.click(screen.getByRole("button", { name: "Delete group My Group" }));

      expect(screen.queryByRole("button", { name: /My Group/ })).not.toBeInTheDocument();
      expect(props.onReorder).not.toHaveBeenCalled();
      expect(screen.getByText("Heatmap")).toBeInTheDocument();
      expect(screen.queryByLabelText(/^Group /)).not.toBeInTheDocument();
    });

    test("moving a layer's selector back to Ungrouped removes it from the group without reordering", async () => {
      const user = userEvent.setup();
      const { props } = setup();

      await addGroup(user, "My Group");
      await user.selectOptions(screen.getByLabelText("Group Heatmap"), "group-1");
      props.onReorder.mockClear();

      await user.selectOptions(screen.getByLabelText("Group Heatmap"), "");

      expect(props.onReorder).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "My Group (0)" })).toBeInTheDocument();
    });

    test("a group's up/down buttons are disabled at the boundaries of the block list", async () => {
      const user = userEvent.setup();
      setup();

      await addGroup(user, "My Group");
      // Tourist Attractions (index 1) and Heatmap (index 2) join, already
      // adjacent to each other, so the group ends up as the last block
      // (Route Layer, standalone, stays first).
      await user.selectOptions(screen.getByLabelText("Group Tourist Attractions"), "group-1");
      await user.selectOptions(screen.getByLabelText("Group Heatmap"), "group-1");

      expect(screen.getByRole("button", { name: "Move group My Group up" })).toBeEnabled();
      expect(screen.getByRole("button", { name: "Move group My Group down" })).toBeDisabled();
    });

    test("moving a group up swaps its whole block with the preceding layer", async () => {
      const user = userEvent.setup();
      const { props } = setup();

      await addGroup(user, "My Group");
      await user.selectOptions(screen.getByLabelText("Group Tourist Attractions"), "group-1");
      await user.selectOptions(screen.getByLabelText("Group Heatmap"), "group-1");
      props.onReorder.mockClear();

      await user.click(screen.getByRole("button", { name: "Move group My Group up" }));

      // Route Layer (index 0) moves past the two-member group to sit after it.
      expect(props.onReorder).toHaveBeenCalledWith(0, 2);
    });

    test("the group eye button hides only the members that are currently visible", async () => {
      const user = userEvent.setup();
      const { props } = setup({
        layers: [
          { ...baseLayers[1], visible: true },
          { ...baseLayers[2], visible: false }
        ]
      });

      await addGroup(user, "My Group");
      await user.selectOptions(screen.getByLabelText("Group Tourist Attractions"), "group-1");
      await user.selectOptions(screen.getByLabelText("Group Heatmap"), "group-1");

      await user.click(screen.getByRole("button", { name: "Hide all layers in My Group" }));

      expect(props.onToggle).toHaveBeenCalledTimes(1);
      expect(props.onToggle).toHaveBeenCalledWith("touristAttractions");
    });

    test("the group eye button shows all members when none are visible", async () => {
      const user = userEvent.setup();
      const { props } = setup({
        layers: [
          { ...baseLayers[1], visible: false },
          { ...baseLayers[2], visible: false }
        ]
      });

      await addGroup(user, "My Group");
      await user.selectOptions(screen.getByLabelText("Group Tourist Attractions"), "group-1");
      await user.selectOptions(screen.getByLabelText("Group Heatmap"), "group-1");

      await user.click(screen.getByRole("button", { name: "Show all layers in My Group" }));

      expect(props.onToggle).toHaveBeenCalledTimes(2);
      expect(props.onToggle).toHaveBeenCalledWith("touristAttractions");
      expect(props.onToggle).toHaveBeenCalledWith("heat");
    });

    test("the group eye button is disabled for an empty group", async () => {
      const user = userEvent.setup();
      setup();

      await addGroup(user, "My Group");

      expect(screen.getByRole("button", { name: "Show all layers in My Group" })).toBeDisabled();
    });

    test("dragging a group and dropping it on a top-level layer row moves the whole group there", async () => {
      const user = userEvent.setup();
      const { props } = setup();

      await addGroup(user, "My Group");
      // Tourist Attractions (1) and Heatmap (2) join - already adjacent, so
      // the group is the second (last) block; Route Layer is the first.
      await user.selectOptions(screen.getByLabelText("Group Tourist Attractions"), "group-1");
      await user.selectOptions(screen.getByLabelText("Group Heatmap"), "group-1");
      props.onReorder.mockClear();

      const groupDragHandle = screen.getByRole("button", {
        name: "Drag to reorder group My Group, or use the move up/down buttons"
      });
      const routeRow = document.querySelectorAll(".layer-row")[0];

      fireEvent.dragStart(groupDragHandle);
      fireEvent.drop(routeRow);

      expect(props.onReorder).toHaveBeenCalledTimes(2);
      expect(props.onReorder).toHaveBeenNthCalledWith(1, 2, 0);
      expect(props.onReorder).toHaveBeenNthCalledWith(2, 2, 0);
    });

    test("dragging a group and dropping it onto another group's header moves the whole block there", async () => {
      const user = userEvent.setup();
      const { props } = setup();

      await addGroup(user, "Group One");
      // Route (0) and Tourist Attractions (1) join Group One - already
      // adjacent, no reorder needed for this setup step.
      await user.selectOptions(screen.getByLabelText("Group Route Layer"), "group-1");
      await user.selectOptions(screen.getByLabelText("Group Tourist Attractions"), "group-1");

      await addGroup(user, "Group Two");
      await user.selectOptions(screen.getByLabelText("Group Heatmap"), "group-2");
      props.onReorder.mockClear();

      const groupTwoDragHandle = screen.getByRole("button", {
        name: "Drag to reorder group Group Two, or use the move up/down buttons"
      });
      const groupOneHeader = screen.getByRole("button", { name: /Group One \(2\)/ }).closest(".layer-group");

      fireEvent.dragStart(groupTwoDragHandle);
      fireEvent.drop(groupOneHeader);

      expect(props.onReorder).toHaveBeenCalledWith(2, 0);
    });

    test("dropping a dragged group onto a member row inside another open group's body still moves it onto that group (the drop bubbles to the group's own container)", async () => {
      const user = userEvent.setup();
      const { props } = setup();

      await addGroup(user, "Group One");
      await user.selectOptions(screen.getByLabelText("Group Route Layer"), "group-1");

      await addGroup(user, "Group Two");
      await user.selectOptions(screen.getByLabelText("Group Heatmap"), "group-2");
      props.onReorder.mockClear();

      const groupTwoDragHandle = screen.getByRole("button", {
        name: "Drag to reorder group Group Two, or use the move up/down buttons"
      });
      // Group One's body is open by default (see "open by default" test
      // above) and contains its one member, Route Layer, as a nested row.
      // That row's own onDrop deliberately no-ops for a group drag and lets
      // the native "drop" event bubble to the enclosing .layer-group's own
      // handler, so dropping anywhere in Group One's card - not just its
      // header - moves the dragged group there.
      const nestedRouteRow = within(
        screen.getByRole("button", { name: /Group One \(1\)/ }).closest(".layer-group")
      ).getByRole("group", { name: "Route Layer controls" });

      fireEvent.dragStart(groupTwoDragHandle);
      fireEvent.drop(nestedRouteRow);

      expect(props.onReorder).toHaveBeenCalledWith(2, 0);
    });

    test("ending a group drag without a drop clears the pending drag without reordering", async () => {
      const user = userEvent.setup();
      const { props } = setup();

      await addGroup(user, "My Group");
      await user.selectOptions(screen.getByLabelText("Group Tourist Attractions"), "group-1");
      await user.selectOptions(screen.getByLabelText("Group Heatmap"), "group-1");
      props.onReorder.mockClear();

      const groupDragHandle = screen.getByRole("button", {
        name: "Drag to reorder group My Group, or use the move up/down buttons"
      });
      fireEvent.dragStart(groupDragHandle);
      fireEvent.dragEnd(groupDragHandle);
      fireEvent.drop(document.querySelectorAll(".layer-row")[0]);

      expect(props.onReorder).not.toHaveBeenCalled();
    });

    // Regression test: .layer-reorder-btns is opacity:0 by default and only
    // revealed by ".layer-row:hover"/":focus-within" (a deliberate
    // hover-recessed pattern for individual layer rows). The group header
    // reuses the same class for its own Move up/down buttons but isn't a
    // .layer-row, so without an explicit override those buttons render
    // permanently invisible - present in the DOM and technically clickable,
    // but unusable because nobody can see them. Every other test in this
    // file mocks CSS out entirely (see jest.config.cjs), so only a test
    // that loads the real stylesheet can catch this class of bug.
    test("a group's Move up/down buttons are not left invisible by the layer row's hover-reveal CSS", async () => {
      const style = document.createElement("style");
      style.textContent = REAL_CSS;
      document.head.appendChild(style);

      const user = userEvent.setup();
      setup();
      await addGroup(user, "My Group");

      const upButton = screen.getByRole("button", { name: "Move group My Group up" });
      expect(getComputedStyle(upButton.parentElement).opacity).not.toBe("0");
      expect(getComputedStyle(upButton).opacity).not.toBe("0");

      document.head.removeChild(style);
    });
  });
});

describe("LayerControlPanel renderer controls (Symbology)", () => {
  const markerLayer = {
    id: "touristAttractions",
    name: "Tourist Attractions",
    visible: true,
    filterable: true,
    styleGroups: [
      {
        symbolType: "simple-marker",
        label: "Tourist Attractions",
        color: "#ff0000",
        borderWidth: 1,
        markerStyle: "circle",
        size: 8,
        opacity: 1,
        rendererType: "simple",
        rendererField: null,
        rendererLegend: null,
        haloEnabled: false,
        haloColor: null,
        haloSize: null
      }
    ]
  };

  async function openSymbology(user) {
    await user.click(screen.getByRole("button", { name: "Toggle layer styling and filter options" }));
    await user.click(screen.getByRole("button", { name: "Symbology" }));
  }

  test("Simple mode shows shape/size/opacity/halo controls for a marker style group", async () => {
    const user = userEvent.setup();
    setup({ layers: [markerLayer] });
    await openSymbology(user);

    expect(screen.getByText("Shape")).toBeInTheDocument();
    expect(screen.getByText("Size")).toBeInTheDocument();
    expect(screen.getByText("Opacity")).toBeInTheDocument();
    expect(screen.getByText("Halo")).toBeInTheDocument();
  });

  test("does not show halo controls for drawings (deliberate scope exclusion)", async () => {
    const user = userEvent.setup();
    setup({
      layers: [
        {
          id: "drawings",
          name: "Drawings",
          visible: true,
          filterable: true,
          styleGroups: [{ ...markerLayer.styleGroups[0], label: "Points" }]
        }
      ]
    });
    await openSymbology(user);

    expect(screen.queryByText("Halo")).not.toBeInTheDocument();
  });

  test("checking Halo calls onStyleChange with halo:true scoped to the group's symbolType", async () => {
    const user = userEvent.setup();
    const { props } = setup({ layers: [markerLayer] });
    await openSymbology(user);

    await user.click(screen.getByRole("checkbox", { name: "Halo" }));

    expect(props.onStyleChange).toHaveBeenCalledWith(
      "touristAttractions",
      expect.objectContaining({ halo: true, symbolType: "simple-marker" })
    );
  });

  test("switching to Unique Values reveals the field selector and Generate button", async () => {
    const user = userEvent.setup();
    setup({ layers: [markerLayer] });
    await openSymbology(user);

    await user.click(screen.getByRole("button", { name: "Unique Values" }));

    expect(screen.getByLabelText(/Renderer field/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate" })).toBeInTheDocument();
  });

  test("Generate calls onSetRenderer with the chosen renderer type and field", async () => {
    const user = userEvent.setup();
    const { props } = setup({ layers: [markerLayer] });
    await openSymbology(user);

    await user.click(screen.getByRole("button", { name: "Unique Values" }));
    await user.selectOptions(screen.getByLabelText(/Renderer field/), "NAME");
    await user.click(screen.getByRole("button", { name: "Generate" }));

    expect(props.onSetRenderer).toHaveBeenCalledWith(
      "touristAttractions",
      expect.objectContaining({ type: "unique-value", field: "NAME", symbolType: "simple-marker" })
    );
  });

  test("a legend row's swatch change calls onUpdateRendererEntry with that entry's key", async () => {
    const user = userEvent.setup();
    const styledLayer = {
      ...markerLayer,
      styleGroups: [
        {
          ...markerLayer.styleGroups[0],
          rendererType: "unique-value",
          rendererField: "NAME",
          rendererLegend: [{ key: "Museum", label: "Museum", color: "#e6194b" }]
        }
      ]
    };
    const { props } = setup({ layers: [styledLayer] });
    await openSymbology(user);

    const swatch = document.querySelector(".renderer-legend input[type='color']");
    fireEvent.change(swatch, { target: { value: "#123456" } });

    expect(props.onUpdateRendererEntry).toHaveBeenCalledWith("touristAttractions", "Museum", { color: "#123456" });
  });

  test("clicking Simple on a group with an active advanced renderer calls onClearRenderer", async () => {
    const user = userEvent.setup();
    const styledLayer = {
      ...markerLayer,
      styleGroups: [
        {
          ...markerLayer.styleGroups[0],
          rendererType: "unique-value",
          rendererField: "NAME",
          rendererLegend: [{ key: "Museum", label: "Museum", color: "#e6194b" }]
        }
      ]
    };
    const { props } = setup({ layers: [styledLayer] });
    await openSymbology(user);

    await user.click(screen.getByRole("button", { name: "Simple" }));

    expect(props.onClearRenderer).toHaveBeenCalledWith("touristAttractions");
  });

  test("does not show a redundant group label for a layer with only one style group", async () => {
    const user = userEvent.setup();
    setup({ layers: [markerLayer] });
    await openSymbology(user);

    expect(screen.queryByText("Tourist Attractions", { selector: ".layer-style-group-label" })).not.toBeInTheDocument();
  });
});
