import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FloatingDrawTools from "./FloatingDrawTools";

function setup(overrides = {}) {
  const props = {
    drawPoint: jest.fn(),
    drawLine: jest.fn(),
    drawPolygon: jest.fn(),
    saveGeoJSON: jest.fn(),
    uploadGeoJSON: jest.fn(),
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

  test("Save GeoJSON button invokes saveGeoJSON", async () => {
    const user = userEvent.setup();
    const { props } = setup();

    await user.click(screen.getByRole("button", { name: "Open drawing tools" }));
    await user.click(screen.getByTitle("Save GeoJSON"));
    expect(props.saveGeoJSON).toHaveBeenCalled();
  });

  test("selecting a file calls uploadGeoJSON with that file, resets the input, and closes the fan", async () => {
    const { container, props } = setup();
    const fileInput = container.querySelector('input[type="file"]');
    const file = new File(["{}"], "drawing.geojson", { type: "application/json" });

    await userEvent.setup().upload(fileInput, file);

    expect(props.uploadGeoJSON).toHaveBeenCalledWith(file);
    expect(fileInput.value).toBe("");
  });

  test("does nothing when the file input change fires with no selected file", () => {
    const { container, props } = setup();
    const fileInput = container.querySelector('input[type="file"]');

    Object.defineProperty(fileInput, "files", { value: [], configurable: true });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));

    expect(props.uploadGeoJSON).not.toHaveBeenCalled();
  });

  test("clicking outside the fan closes it", async () => {
    const user = userEvent.setup();
    const { container } = setup();

    await user.click(screen.getByRole("button", { name: "Open drawing tools" }));
    expect(container.querySelector(".fab-container")).toHaveClass("open");

    await user.click(document.body);
    expect(container.querySelector(".fab-container")).not.toHaveClass("open");
  });
});
