import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PortalLayerPanel from "./PortalLayerPanel";

const noop = jest.fn();

describe("PortalLayerPanel", () => {
  test("is collapsed by default and reveals the search form when the title is clicked", async () => {
    const user = userEvent.setup();
    render(<PortalLayerPanel onSearch={jest.fn()} onAddLayer={jest.fn()} onCreateLayer={noop} />);

    expect(screen.queryByPlaceholderText("Search ArcGIS portal feature layers")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /add layer from portal/i }));

    expect(screen.getByPlaceholderText("Search ArcGIS portal feature layers")).toBeInTheDocument();
  });

  test("submits a search and renders results with an Add button per item", async () => {
    const user = userEvent.setup();
    const onSearch = jest.fn().mockResolvedValue([
      { id: "abc", title: "Parks", url: "https://example.com/Parks/FeatureServer" }
    ]);
    render(<PortalLayerPanel onSearch={onSearch} onAddLayer={jest.fn()} onCreateLayer={noop} />);

    await user.click(screen.getByRole("button", { name: /add layer from portal/i }));
    await user.type(screen.getByPlaceholderText("Search ArcGIS portal feature layers"), "parks");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(onSearch).toHaveBeenCalledWith("parks");
    expect(await screen.findByText("Parks")).toBeInTheDocument();
  });

  test("calls onAddLayer with the picked result", async () => {
    const user = userEvent.setup();
    const item = { id: "abc", title: "Parks", url: "https://example.com/Parks/FeatureServer" };
    const onAddLayer = jest.fn();
    render(
      <PortalLayerPanel onSearch={jest.fn().mockResolvedValue([item])} onAddLayer={onAddLayer} onCreateLayer={noop} />
    );

    await user.click(screen.getByRole("button", { name: /add layer from portal/i }));
    await user.type(screen.getByPlaceholderText("Search ArcGIS portal feature layers"), "parks");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(await screen.findByRole("button", { name: "Add" }));

    expect(onAddLayer).toHaveBeenCalledWith(item);
  });

  test("shows an empty-state message when a search returns no results", async () => {
    const user = userEvent.setup();
    render(<PortalLayerPanel onSearch={jest.fn().mockResolvedValue([])} onAddLayer={jest.fn()} onCreateLayer={noop} />);

    await user.click(screen.getByRole("button", { name: /add layer from portal/i }));
    await user.type(screen.getByPlaceholderText("Search ArcGIS portal feature layers"), "nothing");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("No portal layers found for that search.")).toBeInTheDocument();
  });

  test("does not search on an empty query", async () => {
    const user = userEvent.setup();
    const onSearch = jest.fn();
    render(<PortalLayerPanel onSearch={onSearch} onAddLayer={jest.fn()} onCreateLayer={noop} />);

    await user.click(screen.getByRole("button", { name: /add layer from portal/i }));
    expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
    expect(onSearch).not.toHaveBeenCalled();
  });

  test("Create Feature Layer section shows a sign-in hint when signed out", async () => {
    const user = userEvent.setup();
    render(
      <PortalLayerPanel onSearch={jest.fn()} onAddLayer={jest.fn()} onCreateLayer={noop} signedInUser={null} />
    );

    await user.click(screen.getByRole("button", { name: /add layer from portal/i }));
    await user.click(screen.getByRole("button", { name: /create feature layer/i }));

    expect(
      screen.getByText("Sign in with an ArcGIS account to create a new hosted feature layer.")
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("New feature layer name")).not.toBeInTheDocument();
  });

  test("signed-in users can submit the Create Feature Layer form", async () => {
    const user = userEvent.setup();
    const onCreateLayer = jest.fn().mockResolvedValue();
    render(
      <PortalLayerPanel
        onSearch={jest.fn()}
        onAddLayer={jest.fn()}
        onCreateLayer={onCreateLayer}
        signedInUser={{ username: "jdoe", fullName: "Jane Doe" }}
      />
    );

    await user.click(screen.getByRole("button", { name: /add layer from portal/i }));
    await user.click(screen.getByRole("button", { name: /create feature layer/i }));
    await user.type(screen.getByLabelText("New feature layer name"), "Site Inspections");
    await user.click(screen.getByRole("button", { name: "Create Layer" }));

    expect(onCreateLayer).toHaveBeenCalledWith({ name: "Site Inspections", geometryType: "point", fields: [] });
  });
});
