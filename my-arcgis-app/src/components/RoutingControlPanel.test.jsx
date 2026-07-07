import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RoutingControlPanel from "./RoutingControlPanel";

describe("RoutingControlPanel", () => {
  test("toggles view mode label and calls setIs3D", async () => {
    const user = userEvent.setup();
    const setIs3D = jest.fn();
    render(
      <RoutingControlPanel
        is3D={false}
        setIs3D={setIs3D}
        routeOn={true}
        toggleRoute={jest.fn()}
        heatOn={false}
        toggleHeatmap={jest.fn()}
        heatIntensity={50}
        updateIntensity={jest.fn()}
        onRoute={jest.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Switch to 3D" }));
    expect(setIs3D).toHaveBeenCalledWith(true);
  });

  test("renders the route search section and forwards submissions", async () => {
    const user = userEvent.setup();
    const onRoute = jest.fn();
    render(
      <RoutingControlPanel
        is3D={true}
        setIs3D={jest.fn()}
        onRoute={onRoute}
      />
    );

    expect(screen.getByText("ROUTE SEARCH")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch to 2D" })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Start location"), "A");
    await user.type(screen.getByPlaceholderText("End location"), "B");
    await user.click(screen.getByRole("button", { name: "Calculate Route" }));

    expect(onRoute).toHaveBeenCalledWith("A", "B");
  });
});
