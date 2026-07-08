import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RoutingControlPanel from "./RoutingControlPanel";

describe("RoutingControlPanel", () => {
  test("view mode segmented control calls setIs3D with the selected mode", async () => {
    const user = userEvent.setup();
    const setIs3D = jest.fn();
    render(
      <RoutingControlPanel
        is3D={false}
        setIs3D={setIs3D}
        routeOn={true}
        toggleRoute={jest.fn()}
        onRoute={jest.fn()}
      />
    );

    const btn2D = screen.getByRole("button", { name: "2D" });
    const btn3D = screen.getByRole("button", { name: "3D" });
    expect(btn2D).toHaveAttribute("aria-pressed", "true");
    expect(btn3D).toHaveAttribute("aria-pressed", "false");

    await user.click(btn3D);
    expect(setIs3D).toHaveBeenCalledWith(true);
  });

  test("renders the route search section and forwards submissions", async () => {
    const user = userEvent.setup();
    const onRoute = jest.fn();
    render(
      <RoutingControlPanel
        is3D={true}
        setIs3D={jest.fn()}
        routeOn={true}
        toggleRoute={jest.fn()}
        onRoute={onRoute}
      />
    );

    expect(screen.getByText("ROUTE SEARCH")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2D" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "3D" })).toHaveAttribute("aria-pressed", "true");

    await user.type(screen.getByPlaceholderText("Start location"), "A");
    await user.type(screen.getByPlaceholderText("End location"), "B");
    await user.click(screen.getByRole("button", { name: "Calculate Route" }));

    expect(onRoute).toHaveBeenCalledWith("A", "B");
  });

  test("route toggle button calls toggleRoute and reflects routeOn label", () => {
    const toggleRoute = jest.fn();
    const { rerender } = render(
      <RoutingControlPanel
        is3D={false}
        setIs3D={jest.fn()}
        routeOn={true}
        toggleRoute={toggleRoute}
        onRoute={jest.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Hide Route" })).toBeInTheDocument();

    rerender(
      <RoutingControlPanel
        is3D={false}
        setIs3D={jest.fn()}
        routeOn={false}
        toggleRoute={toggleRoute}
        onRoute={jest.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Show Route" })).toBeInTheDocument();
  });
});
