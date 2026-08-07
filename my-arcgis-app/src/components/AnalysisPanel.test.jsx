import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AnalysisPanel from "./AnalysisPanel";

const LAYERS = [
  { id: "touristAttractions", name: "Tourist Attractions", filterable: true, filterDescription: null },
  { id: "drawings", name: "Drawings", filterable: true, filterDescription: null },
  { id: "route", name: "Route Layer", filterable: false }
];

const FIELDS = {
  touristAttractions: {
    fields: [
      { name: "RATING", kind: "number" },
      { name: "NAME", kind: "string" }
    ]
  },
  drawings: { fields: [{ name: "RATING", kind: "number" }] }
};

function renderPanel(overrides = {}) {
  const props = {
    layers: LAYERS,
    onGetLayerFields: jest.fn((id) => Promise.resolve(FIELDS[id] || { fields: [] })),
    onApplyFilter: jest.fn().mockResolvedValue(undefined),
    onClearFilter: jest.fn(),
    onRunAnalysis: jest.fn().mockResolvedValue({
      perLayer: [{ id: "touristAttractions", name: "Tourist Attractions", count: 3, stats: { sum: 12 } }],
      total: { count: 3, sum: 12, avg: 4, min: null, max: null }
    }),
    ...overrides
  };
  return { user: userEvent.setup(), props, ...render(<AnalysisPanel {...props} />) };
}

async function open(user) {
  await user.click(screen.getByRole("button", { name: /filter & aggregate/i }));
}

describe("AnalysisPanel", () => {
  test("is collapsed by default and reveals its content when the title is clicked", async () => {
    const { user } = renderPanel();
    expect(screen.queryByText("Tourist Attractions")).not.toBeInTheDocument();

    await open(user);
    expect(screen.getByText("Tourist Attractions")).toBeInTheDocument();
  });

  test("only lists layers marked filterable", async () => {
    const { user } = renderPanel();
    await open(user);

    expect(screen.getByText("Tourist Attractions")).toBeInTheDocument();
    expect(screen.getByText("Drawings")).toBeInTheDocument();
    expect(screen.queryByText("Route Layer")).not.toBeInTheDocument();
  });

  test("selecting a layer loads its field schema and shows a filter builder", async () => {
    const { user, props } = renderPanel();
    await open(user);

    await user.click(screen.getByRole("checkbox", { name: "Tourist Attractions" }));

    expect(props.onGetLayerFields).toHaveBeenCalledWith("touristAttractions");
    expect(await screen.findByRole("group", { name: "Tourist Attractions" })).toBeInTheDocument();
  });

  test("builds a condition and applies the filter", async () => {
    const { user, props } = renderPanel();
    await open(user);
    await user.click(screen.getByRole("checkbox", { name: "Tourist Attractions" }));

    const group = await screen.findByRole("group", { name: "Tourist Attractions" });
    await user.selectOptions(within(group).getByLabelText("Field"), "RATING");
    await user.selectOptions(within(group).getByLabelText("Operator"), "at least");
    await user.type(within(group).getByLabelText("Value"), "4");
    await user.click(within(group).getByRole("button", { name: "Apply Filter" }));

    expect(props.onApplyFilter).toHaveBeenCalledWith("touristAttractions", {
      conditions: [{ field: "RATING", operator: ">=", value: "4" }],
      logic: "AND"
    });
  });

  test("shows the active filter description with a clear control when the layer is already filtered", async () => {
    const { user, props } = renderPanel({
      layers: [
        {
          id: "touristAttractions",
          name: "Tourist Attractions",
          filterable: true,
          filterDescription: "RATING at least 4"
        }
      ]
    });
    await open(user);
    await user.click(screen.getByRole("checkbox", { name: "Tourist Attractions filtered" }));

    expect(await screen.findByText("RATING at least 4")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear filter on Tourist Attractions" }));
    expect(props.onClearFilter).toHaveBeenCalledWith("touristAttractions");
  });

  test("switching to Aggregate mode runs an analysis and renders per-layer and total rows", async () => {
    const { user, props } = renderPanel();
    await open(user);
    await user.click(screen.getByRole("checkbox", { name: "Tourist Attractions" }));
    await user.click(screen.getByRole("button", { name: "Aggregate" }));

    await user.type(screen.getByPlaceholderText("e.g. RATING"), "RATING");
    await user.click(screen.getByRole("checkbox", { name: "Sum" }));
    await user.click(screen.getByRole("button", { name: "Run Aggregate" }));

    expect(props.onRunAnalysis).toHaveBeenCalledWith(["touristAttractions"], {
      field: "RATING",
      statistics: ["sum"]
    });

    expect(await screen.findByText("Total")).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    expect(rows.some((r) => within(r).queryByText("12"))).toBe(true);
  });

  test("statistic checkboxes are disabled until a field is entered", async () => {
    const { user } = renderPanel();
    await open(user);
    await user.click(screen.getByRole("checkbox", { name: "Tourist Attractions" }));
    await user.click(screen.getByRole("button", { name: "Aggregate" }));

    expect(screen.getByRole("checkbox", { name: "Sum" })).toBeDisabled();
    await user.type(screen.getByPlaceholderText("e.g. RATING"), "RATING");
    expect(screen.getByRole("checkbox", { name: "Sum" })).toBeEnabled();
  });
});
