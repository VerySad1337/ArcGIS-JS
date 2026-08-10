import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FloatingDrawTools from "./FloatingDrawTools";

function setup(overrides = {}) {
  const props = {
    drawPoint: jest.fn(),
    drawLine: jest.fn(),
    drawPolygon: jest.fn(),
    drawTargetLayerId: "drawings",
    drawTargetOptions: [{ id: "drawings", name: "Drawings", geometryType: null }],
    onChangeDrawTarget: jest.fn(),
    ...overrides
  };
  const utils = render(<FloatingDrawTools {...props} />);
  return { ...utils, props };
}

describe("FloatingDrawTools", () => {
  test("opens the fan on main button click and each tool click runs its action and closes the fan", async () => {
    const user = userEvent.setup();
    const { container, props } = setup();

    const mainButton = screen.getByRole("button", { name: "Open drawing tools" });
    await user.click(mainButton);
    expect(container.querySelector(".fab-container")).toHaveClass("open");

    await user.click(screen.getByTitle("Point"));
    expect(props.drawPoint).toHaveBeenCalled();
    expect(container.querySelector(".fab-container")).not.toHaveClass("open");
  });

  test("Line and Polygon buttons invoke their respective callbacks", async () => {
    const user = userEvent.setup();
    const { props } = setup();

    await user.click(screen.getByRole("button", { name: "Open drawing tools" }));
    await user.click(screen.getByTitle("Polygon"));
    expect(props.drawPolygon).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Open drawing tools" }));
    await user.click(screen.getByTitle("Line"));
    expect(props.drawLine).toHaveBeenCalled();
  });

  test("clicking outside the fan closes it", async () => {
    const user = userEvent.setup();
    const { container } = setup();

    await user.click(screen.getByRole("button", { name: "Open drawing tools" }));
    expect(container.querySelector(".fab-container")).toHaveClass("open");

    await user.click(document.body);
    expect(container.querySelector(".fab-container")).not.toHaveClass("open");
  });

  test("shows a status chip naming the active draw type, with no chip when idle", () => {
    const { rerender } = setup({ activeDrawType: null });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    rerender(
      <FloatingDrawTools
        drawPoint={jest.fn()}
        drawLine={jest.fn()}
        drawPolygon={jest.fn()}
        drawTargetLayerId="drawings"
        drawTargetOptions={[{ id: "drawings", name: "Drawings", geometryType: null }]}
        onChangeDrawTarget={jest.fn()}
        activeDrawType="polygon"
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent("Drawing polygon…");
  });

  test("clicking Cancel while drawing calls onCancelDraw", async () => {
    const user = userEvent.setup();
    const onCancelDraw = jest.fn();
    setup({ activeDrawType: "point", onCancelDraw });

    await user.click(screen.getByRole("button", { name: "Cancel drawing" }));
    expect(onCancelDraw).toHaveBeenCalled();
  });

  test("the \"Draw into\" selector is part of the fan and present in the DOM even before it's opened", () => {
    const { container } = setup({
      drawTargetOptions: [
        { id: "drawings", name: "Drawings", geometryType: null },
        { id: "portal_abc", name: "Site Inspections", geometryType: "point" }
      ]
    });

    // Present but visually/interactively hidden until the fan opens - CSS
    // (.fab-container.open .draw-target-bar) drives the actual show/hide,
    // which jsdom doesn't apply, so the DOM-presence + tabIndex/open-class
    // checks below are what's assertable here.
    expect(screen.getByLabelText("Layer to draw new features into")).toBeInTheDocument();
    expect(screen.getByLabelText("Layer to draw new features into")).toHaveAttribute("tabIndex", "-1");
    expect(container.querySelector(".fab-container")).not.toHaveClass("open");
  });

  test("opening the fan makes the \"Draw into\" selector focusable", async () => {
    const user = userEvent.setup();
    const { container } = setup({
      drawTargetOptions: [
        { id: "drawings", name: "Drawings", geometryType: null },
        { id: "portal_abc", name: "Site Inspections", geometryType: "point" }
      ]
    });

    await user.click(screen.getByRole("button", { name: "Open drawing tools" }));

    expect(container.querySelector(".fab-container")).toHaveClass("open");
    expect(screen.getByLabelText("Layer to draw new features into")).toHaveAttribute("tabIndex", "0");
  });

  test("changing the selector calls onChangeDrawTarget with the picked layer id", async () => {
    const user = userEvent.setup();
    const { props } = setup({
      drawTargetOptions: [
        { id: "drawings", name: "Drawings", geometryType: null },
        { id: "portal_abc", name: "Site Inspections", geometryType: "point" }
      ]
    });

    await user.selectOptions(screen.getByLabelText("Layer to draw new features into"), "portal_abc");

    expect(props.onChangeDrawTarget).toHaveBeenCalledWith("portal_abc");
  });

  test("selecting a point-geometry target shows only the Point tool", async () => {
    const user = userEvent.setup();
    setup({
      drawTargetLayerId: "portal_abc",
      drawTargetOptions: [
        { id: "drawings", name: "Drawings", geometryType: null },
        { id: "portal_abc", name: "Site Inspections", geometryType: "point" }
      ]
    });

    await user.click(screen.getByRole("button", { name: "Open drawing tools" }));

    expect(screen.getByTitle("Point")).toBeInTheDocument();
    expect(screen.queryByTitle("Line")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Polygon")).not.toBeInTheDocument();
  });

  test("selecting a polyline-geometry target shows only the Line tool", async () => {
    const user = userEvent.setup();
    setup({
      drawTargetLayerId: "portal_lines",
      drawTargetOptions: [
        { id: "drawings", name: "Drawings", geometryType: null },
        { id: "portal_lines", name: "Trails", geometryType: "polyline" }
      ]
    });

    await user.click(screen.getByRole("button", { name: "Open drawing tools" }));

    expect(screen.getByTitle("Line")).toBeInTheDocument();
    expect(screen.queryByTitle("Point")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Polygon")).not.toBeInTheDocument();
  });

  test("selecting Drawings (no geometry restriction) shows all three tools", async () => {
    const user = userEvent.setup();
    setup({
      drawTargetLayerId: "drawings",
      drawTargetOptions: [
        { id: "drawings", name: "Drawings", geometryType: null },
        { id: "portal_abc", name: "Site Inspections", geometryType: "point" }
      ]
    });

    await user.click(screen.getByRole("button", { name: "Open drawing tools" }));

    expect(screen.getByTitle("Point")).toBeInTheDocument();
    expect(screen.getByTitle("Line")).toBeInTheDocument();
    expect(screen.getByTitle("Polygon")).toBeInTheDocument();
  });
});
