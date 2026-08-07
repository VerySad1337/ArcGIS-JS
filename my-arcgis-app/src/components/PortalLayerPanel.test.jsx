import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PortalLayerPanel from "./PortalLayerPanel";

describe("PortalLayerPanel", () => {
  test("is collapsed by default and reveals the search form when the title is clicked", async () => {
    const user = userEvent.setup();
    render(<PortalLayerPanel onSearch={jest.fn()} onAddLayer={jest.fn()} />);

    expect(screen.queryByPlaceholderText("Search ArcGIS portal feature layers")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /add layer from portal/i }));

    expect(screen.getByPlaceholderText("Search ArcGIS portal feature layers")).toBeInTheDocument();
  });

  test("submits a search and renders results with an Add button per item", async () => {
    const user = userEvent.setup();
    const onSearch = jest.fn().mockResolvedValue([
      { id: "abc", title: "Parks", url: "https://example.com/Parks/FeatureServer" }
    ]);
    render(<PortalLayerPanel onSearch={onSearch} onAddLayer={jest.fn()} />);

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
      <PortalLayerPanel onSearch={jest.fn().mockResolvedValue([item])} onAddLayer={onAddLayer} />
    );

    await user.click(screen.getByRole("button", { name: /add layer from portal/i }));
    await user.type(screen.getByPlaceholderText("Search ArcGIS portal feature layers"), "parks");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(await screen.findByRole("button", { name: "Add" }));

    expect(onAddLayer).toHaveBeenCalledWith(item);
  });

  test("shows an empty-state message when a search returns no results", async () => {
    const user = userEvent.setup();
    render(<PortalLayerPanel onSearch={jest.fn().mockResolvedValue([])} onAddLayer={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: /add layer from portal/i }));
    await user.type(screen.getByPlaceholderText("Search ArcGIS portal feature layers"), "nothing");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("No portal layers found for that search.")).toBeInTheDocument();
  });

  test("does not search on an empty query", async () => {
    const user = userEvent.setup();
    const onSearch = jest.fn();
    render(<PortalLayerPanel onSearch={onSearch} onAddLayer={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: /add layer from portal/i }));
    expect(screen.getByRole("button", { name: "Search" })).toBeDisabled();
    expect(onSearch).not.toHaveBeenCalled();
  });

  test("shows no account row when OAuth isn't configured", async () => {
    const user = userEvent.setup();
    render(<PortalLayerPanel onSearch={jest.fn()} onAddLayer={jest.fn()} oauthConfigured={false} />);

    await user.click(screen.getByRole("button", { name: /add layer from portal/i }));

    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
  });

  test("shows a Sign in button when OAuth is configured and no user is signed in", async () => {
    const user = userEvent.setup();
    const onSignIn = jest.fn();
    render(
      <PortalLayerPanel
        onSearch={jest.fn()}
        onAddLayer={jest.fn()}
        oauthConfigured={true}
        signedInUser={null}
        onSignIn={onSignIn}
      />
    );

    await user.click(screen.getByRole("button", { name: /add layer from portal/i }));
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(onSignIn).toHaveBeenCalled();
  });

  test("disables the Sign in button while signing in", async () => {
    const user = userEvent.setup();
    render(
      <PortalLayerPanel
        onSearch={jest.fn()}
        onAddLayer={jest.fn()}
        oauthConfigured={true}
        signedInUser={null}
        signingIn={true}
      />
    );

    await user.click(screen.getByRole("button", { name: /add layer from portal/i }));
    expect(screen.getByRole("button", { name: "Signing in…" })).toBeDisabled();
  });

  test("shows the signed-in user's name and a Sign out button once signed in", async () => {
    const user = userEvent.setup();
    const onSignOut = jest.fn();
    render(
      <PortalLayerPanel
        onSearch={jest.fn()}
        onAddLayer={jest.fn()}
        oauthConfigured={true}
        signedInUser={{ username: "jdoe", fullName: "Jane Doe" }}
        onSignOut={onSignOut}
      />
    );

    await user.click(screen.getByRole("button", { name: /add layer from portal/i }));
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalled();
  });
});
