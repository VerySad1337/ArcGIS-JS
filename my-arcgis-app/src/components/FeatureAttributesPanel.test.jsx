import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FeatureAttributesPanel from "./FeatureAttributesPanel";

const baseFeature = {
  layerId: "touristAttractions",
  layerTitle: "Tourist Attractions",
  objectIdField: "OBJECTID",
  attributes: { OBJECTID: 1, name: "Merlion" },
  x: 100,
  y: 100
};

describe("FeatureAttributesPanel", () => {
  test("renders nothing when there is no feature", () => {
    const { container } = render(<FeatureAttributesPanel feature={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test("renders the layer title and attribute rows", () => {
    render(<FeatureAttributesPanel feature={baseFeature} />);
    expect(screen.getByText("Tourist Attractions")).toBeInTheDocument();
    expect(screen.getByText("OBJECTID")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Merlion")).toBeInTheDocument();
  });

  test("calls onClose when the close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = jest.fn();
    render(<FeatureAttributesPanel feature={baseFeature} onClose={onClose} />);

    await user.click(screen.getByText("✕"));
    expect(onClose).toHaveBeenCalled();
  });

  test("entering edit mode shows inputs for all fields except the object id field", async () => {
    const user = userEvent.setup();
    render(<FeatureAttributesPanel feature={baseFeature} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByDisplayValue("Merlion")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("1")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  test("editing a value and cancelling discards the change", async () => {
    const user = userEvent.setup();
    render(<FeatureAttributesPanel feature={baseFeature} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const input = screen.getByDisplayValue("Merlion");
    await user.clear(input);
    await user.type(input, "Changed");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("Merlion")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  test("saving calls onSaveAttributes with the draft and exits edit mode", async () => {
    const user = userEvent.setup();
    const onSaveAttributes = jest.fn().mockResolvedValue(undefined);
    render(<FeatureAttributesPanel feature={baseFeature} onSaveAttributes={onSaveAttributes} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const input = screen.getByDisplayValue("Merlion");
    await user.clear(input);
    await user.type(input, "New Name");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSaveAttributes).toHaveBeenCalledWith({ OBJECTID: 1, name: "New Name" });
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  test("adding a column calls onAddColumn and clears the add-column inputs", async () => {
    const user = userEvent.setup();
    const onAddColumn = jest.fn().mockResolvedValue(undefined);
    render(<FeatureAttributesPanel feature={baseFeature} onAddColumn={onAddColumn} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.type(screen.getByPlaceholderText("New column name"), "status");
    await user.type(screen.getByPlaceholderText("Default value"), "active");
    await user.click(screen.getByRole("button", { name: "+ Add Column" }));

    expect(onAddColumn).toHaveBeenCalledWith("status", "active");
    expect(screen.getByPlaceholderText("New column name")).toHaveValue("");
  });

  test("does not call onAddColumn when the new field name is blank", async () => {
    const user = userEvent.setup();
    const onAddColumn = jest.fn();
    render(<FeatureAttributesPanel feature={baseFeature} onAddColumn={onAddColumn} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "+ Add Column" }));

    expect(onAddColumn).not.toHaveBeenCalled();
  });

  test("preserves edit mode across an attribute update for the same feature (same click position)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<FeatureAttributesPanel feature={baseFeature} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();

    const updatedSameFeature = { ...baseFeature, attributes: { OBJECTID: 1, name: "Merlion Updated" } };
    rerender(<FeatureAttributesPanel feature={updatedSameFeature} />);

    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  test("resets edit mode when a different feature (different click position) is selected", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<FeatureAttributesPanel feature={baseFeature} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();

    const differentFeature = { ...baseFeature, x: 999, attributes: { OBJECTID: 2, name: "Other" } };
    rerender(<FeatureAttributesPanel feature={differentFeature} />);

    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.getByText("Other")).toBeInTheDocument();
  });

  test("positions the popup on the left/top when it doesn't overflow the viewport", () => {
    const { container } = render(<FeatureAttributesPanel feature={{ ...baseFeature, x: 10, y: 10 }} />);
    const panel = container.querySelector(".feature-attributes-panel");
    expect(panel.style.left).toBe("24px");
    expect(panel.style.top).toBe("24px");
  });

  test("resets selection state (including an empty draft) when the feature becomes null then reappears", () => {
    const { rerender } = render(<FeatureAttributesPanel feature={baseFeature} />);
    expect(screen.getByText("Tourist Attractions")).toBeInTheDocument();

    rerender(<FeatureAttributesPanel feature={null} />);
    expect(screen.queryByText("Tourist Attractions")).not.toBeInTheDocument();

    rerender(<FeatureAttributesPanel feature={baseFeature} />);
    expect(screen.getByText("Tourist Attractions")).toBeInTheDocument();
  });

  test("shows an empty input for a draft field with no value yet", async () => {
    const user = userEvent.setup();
    const featureWithUndefinedValue = {
      ...baseFeature,
      attributes: { OBJECTID: 1, name: "Merlion", note: undefined }
    };
    render(<FeatureAttributesPanel feature={featureWithUndefinedValue} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByText("note")).toBeInTheDocument();
    const inputs = screen.getAllByRole("textbox");
    expect(inputs.some((el) => el.value === "")).toBe(true);
  });

  test("flips to right/bottom positioning when the popup would overflow the viewport", () => {
    const overflowFeature = {
      ...baseFeature,
      x: window.innerWidth - 5,
      y: window.innerHeight - 5
    };
    const { container } = render(<FeatureAttributesPanel feature={overflowFeature} />);
    const panel = container.querySelector(".feature-attributes-panel");
    expect(panel.style.right).not.toBe("");
    expect(panel.style.bottom).not.toBe("");
  });
});
