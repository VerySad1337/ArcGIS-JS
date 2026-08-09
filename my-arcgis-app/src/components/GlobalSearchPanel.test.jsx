import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GlobalSearchPanel from "./GlobalSearchPanel";

describe("GlobalSearchPanel", () => {
  test("runs a search and selecting a result calls onSelectResult", async () => {
    const user = userEvent.setup();
    const onSearch = jest.fn().mockResolvedValue([
      { type: "address", layerId: "address", label: "1 Some Street" }
    ]);
    const onSelectResult = jest.fn();

    render(<GlobalSearchPanel onSearch={onSearch} onSelectResult={onSelectResult} />);

    await user.type(screen.getByLabelText("Search features or an address"), "1 Some Street");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(onSearch).toHaveBeenCalledWith("1 Some Street");
    await user.click(await screen.findByRole("option", { name: /1 Some Street/ }));
    expect(onSelectResult).toHaveBeenCalledWith({
      type: "address",
      layerId: "address",
      label: "1 Some Street"
    });
  });

  test("does not show the save-as-layer form without a placed search result", () => {
    render(
      <GlobalSearchPanel
        onSearch={jest.fn()}
        onSelectResult={jest.fn()}
        hasSearchResult={false}
        onCreateSearchResultLayer={jest.fn()}
      />
    );

    expect(screen.queryByLabelText("New search result layer name")).not.toBeInTheDocument();
  });

  test("shows the save-as-layer form once a search result exists, and saves a trimmed name", async () => {
    const user = userEvent.setup();
    const onCreateSearchResultLayer = jest.fn().mockResolvedValue(undefined);

    render(
      <GlobalSearchPanel
        onSearch={jest.fn()}
        onSelectResult={jest.fn()}
        hasSearchResult={true}
        onCreateSearchResultLayer={onCreateSearchResultLayer}
      />
    );

    const nameInput = screen.getByLabelText("New search result layer name");
    const saveButton = screen.getByRole("button", { name: "Add to Layers" });
    expect(saveButton).toBeDisabled();

    await user.type(nameInput, "  Client Site  ");
    expect(saveButton).not.toBeDisabled();

    await user.click(saveButton);
    expect(onCreateSearchResultLayer).toHaveBeenCalledWith("Client Site");
  });

  test("resets the address query and results back to their initial state once a search result is saved", async () => {
    const user = userEvent.setup();
    const onSearch = jest.fn().mockResolvedValue([
      { type: "address", layerId: "address", label: "1 Some Street" }
    ]);
    const onCreateSearchResultLayer = jest.fn().mockResolvedValue(undefined);

    render(
      <GlobalSearchPanel
        onSearch={onSearch}
        onSelectResult={jest.fn()}
        hasSearchResult={true}
        onCreateSearchResultLayer={onCreateSearchResultLayer}
      />
    );

    const queryInput = screen.getByLabelText("Search features or an address");
    await user.type(queryInput, "1 Some Street");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(await screen.findByRole("option", { name: /1 Some Street/ })).toBeInTheDocument();

    await user.type(screen.getByLabelText("New search result layer name"), "Client Site");
    await user.click(screen.getByRole("button", { name: "Add to Layers" }));

    expect(queryInput).toHaveValue("");
    expect(screen.queryByRole("listbox", { name: "Search results" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /1 Some Street/ })).not.toBeInTheDocument();
  });
});
