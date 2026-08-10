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

  test("hides every editing affordance when canEdit is false", () => {
    // Viewing attributes must never require an account. Offering Edit to a
    // user who can't write meant the rejection surfaced as IdentityManager's
    // own sign-in modal, which reads as the app demanding a login.
    render(<FeatureAttributesPanel feature={baseFeature} canEdit={false} />);

    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
    // Attribute values are still fully readable.
    expect(screen.getByText("Merlion")).toBeInTheDocument();
  });

  test("keeps the Edit button when canEdit is true", () => {
    render(<FeatureAttributesPanel feature={baseFeature} canEdit />);
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByText(/read-only/i)).not.toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: "Close" }));
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

  test("disables + Add Column until a name is typed", async () => {
    const user = userEvent.setup();
    render(<FeatureAttributesPanel feature={baseFeature} onAddColumn={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    const button = screen.getByRole("button", { name: "+ Add Column" });
    expect(button).toBeDisabled();

    await user.type(screen.getByPlaceholderText("New column name"), "status");
    expect(button).toBeEnabled();
  });

  test("offers a delete control per editable column, but never for the object id field", async () => {
    const user = userEvent.setup();
    render(<FeatureAttributesPanel feature={baseFeature} onDeleteColumn={jest.fn()} />);

    // Not offered outside edit mode.
    expect(screen.queryByRole("button", { name: "Delete column name" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByRole("button", { name: "Delete column name" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delete column OBJECTID" })
    ).not.toBeInTheDocument();
  });

  test("hides the delete control when no onDeleteColumn handler is supplied", async () => {
    const user = userEvent.setup();
    render(<FeatureAttributesPanel feature={baseFeature} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByRole("button", { name: "Delete column name" })).not.toBeInTheDocument();
  });

  test("deleting a column asks for confirmation first", async () => {
    const user = userEvent.setup();
    const onDeleteColumn = jest.fn().mockResolvedValue(undefined);
    render(<FeatureAttributesPanel feature={baseFeature} onDeleteColumn={onDeleteColumn} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Delete column name" }));

    expect(onDeleteColumn).not.toHaveBeenCalled();
    expect(screen.getByText('Delete "name"?')).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDeleteColumn).toHaveBeenCalledWith("name");
  });

  test("keeping the column restores the row and calls nothing", async () => {
    // The confirm's dismiss button is "Keep", not "Cancel": the footer's own
    // Cancel exits edit mode entirely, and two adjacent buttons named Cancel
    // that do different things is a trap in a popup this narrow.
    const user = userEvent.setup();
    const onDeleteColumn = jest.fn();
    render(<FeatureAttributesPanel feature={baseFeature} onDeleteColumn={onDeleteColumn} />);

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Delete column name" }));
    await user.click(screen.getByRole("button", { name: "Keep" }));

    expect(onDeleteColumn).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete "name"?')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Merlion")).toBeInTheDocument();
  });

  test("a deleted column is dropped from the draft, so a later Save can't resurrect it", async () => {
    const user = userEvent.setup();
    const onDeleteColumn = jest.fn().mockResolvedValue(undefined);
    const onSaveAttributes = jest.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <FeatureAttributesPanel
        feature={baseFeature}
        onDeleteColumn={onDeleteColumn}
        onSaveAttributes={onSaveAttributes}
      />
    );

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Delete column name" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));

    // The shell drops the key from its own copy of the attributes too.
    rerender(
      <FeatureAttributesPanel
        feature={{ ...baseFeature, attributes: { OBJECTID: 1 } }}
        onDeleteColumn={onDeleteColumn}
        onSaveAttributes={onSaveAttributes}
      />
    );

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSaveAttributes).toHaveBeenCalledWith({ OBJECTID: 1 });
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
