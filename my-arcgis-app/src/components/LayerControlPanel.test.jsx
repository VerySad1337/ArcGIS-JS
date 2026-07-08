import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LayerControlPanel from "./LayerControlPanel";

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

function setup(overrides = {}) {
  const props = {
    layers: baseLayers,
    onToggle: jest.fn(),
    onReorder: jest.fn(),
    onStyleChange: jest.fn(),
    onZoomToLayer: jest.fn(),
    heatIntensity: 40,
    updateIntensity: jest.fn(),
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

    await user.click(screen.getByRole("button", { name: "Toggle layer styling options" }));

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

    await userEvent.setup().click(screen.getByRole("button", { name: "Toggle layer styling options" }));

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

    await user.click(screen.getByRole("button", { name: "Toggle layer styling options" }));

    expect(screen.getByText("Points")).toBeInTheDocument();
    expect(screen.getByText("Lines")).toBeInTheDocument();
  });

  test("shows the heat intensity slider only for the visible heat layer", () => {
    setup();
    expect(screen.getByText("Heat Intensity: 40")).toBeInTheDocument();
  });

  test("does not show the heat intensity slider when the heat layer is hidden", () => {
    setup({
      layers: [{ id: "heat", name: "Heatmap", visible: false, styleGroups: [] }]
    });
    expect(screen.queryByText(/Heat Intensity/)).not.toBeInTheDocument();
  });

  test("moving the heat intensity slider calls updateIntensity with a number", () => {
    const { props } = setup();
    const slider = document.querySelector(".heat-slider-container input[type='range']");
    fireEvent.change(slider, { target: { value: "77" } });
    expect(props.updateIntensity).toHaveBeenCalledWith(77);
  });

  test("clicking a layer's zoom button calls onZoomToLayer with that layer's id", async () => {
    const user = userEvent.setup();
    const { props } = setup();

    await user.click(screen.getByRole("button", { name: "Zoom to Tourist Attractions" }));
    expect(props.onZoomToLayer).toHaveBeenCalledWith("touristAttractions");
  });
});
