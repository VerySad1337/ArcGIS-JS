import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RoutingControlPanel from "./RoutingControlPanel";

describe("RoutingControlPanel", () => {
  test("is collapsed by default and reveals the route form when the title is clicked", async () => {
    const user = userEvent.setup();
    const onRoute = jest.fn();
    render(
      <RoutingControlPanel
        routeOn={true}
        toggleRoute={jest.fn()}
        onRoute={onRoute}
      />
    );

    expect(screen.queryByPlaceholderText("Start location")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ROUTE SEARCH" }));
    await user.type(screen.getByPlaceholderText("Start location"), "A");
    await user.type(screen.getByPlaceholderText("End location"), "B");
    await user.click(screen.getByRole("button", { name: "Calculate Route" }));

    expect(onRoute).toHaveBeenCalledWith("A", "B");
  });

  test("route toggle button calls toggleRoute and reflects routeOn label", async () => {
    const user = userEvent.setup();
    const toggleRoute = jest.fn();
    const { rerender } = render(
      <RoutingControlPanel
        routeOn={true}
        toggleRoute={toggleRoute}
        onRoute={jest.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "ROUTE SEARCH" }));
    expect(screen.getByRole("button", { name: "Hide Route" })).toBeInTheDocument();

    rerender(
      <RoutingControlPanel
        routeOn={false}
        toggleRoute={toggleRoute}
        onRoute={jest.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Show Route" })).toBeInTheDocument();
  });
});
