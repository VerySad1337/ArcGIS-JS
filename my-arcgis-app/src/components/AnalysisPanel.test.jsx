import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AnalysisPanel from "./AnalysisPanel";

describe("AnalysisPanel", () => {
  test("is collapsed by default and reveals the route form when the Route Search section is opened", async () => {
    const user = userEvent.setup();
    const onRoute = jest.fn();
    render(
      <AnalysisPanel
        onBuffer={jest.fn()}
        onToggleSlice={jest.fn()}
        routeOn={true}
        toggleRoute={jest.fn()}
        onRoute={onRoute}
      />
    );

    expect(screen.queryByPlaceholderText("Start location")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "ANALYSIS" }));
    expect(screen.queryByPlaceholderText("Start location")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Route Search" }));
    await user.type(screen.getByPlaceholderText("Start location"), "A");
    await user.type(screen.getByPlaceholderText("End location"), "B");
    await user.click(screen.getByRole("button", { name: "Calculate Route" }));

    expect(onRoute).toHaveBeenCalledWith("A", "B");
  });

  test("route toggle button calls toggleRoute and reflects routeOn label", async () => {
    const user = userEvent.setup();
    const toggleRoute = jest.fn();
    const { rerender } = render(
      <AnalysisPanel
        onBuffer={jest.fn()}
        onToggleSlice={jest.fn()}
        routeOn={true}
        toggleRoute={toggleRoute}
        onRoute={jest.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "ANALYSIS" }));
    await user.click(screen.getByRole("button", { name: "Route Search" }));
    expect(screen.getByRole("button", { name: "Hide Route" })).toBeInTheDocument();

    rerender(
      <AnalysisPanel
        onBuffer={jest.fn()}
        onToggleSlice={jest.fn()}
        routeOn={false}
        toggleRoute={toggleRoute}
        onRoute={jest.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Show Route" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show Route" }));
    expect(toggleRoute).toHaveBeenCalled();
  });

  test("buffer section is independently collapsible and the apply button is gated on selection + distance", async () => {
    const user = userEvent.setup();
    const onBuffer = jest.fn();
    render(
      <AnalysisPanel
        selectedFeature={{ geometry: {} }}
        onBuffer={onBuffer}
        onToggleSlice={jest.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "ANALYSIS" }));
    expect(screen.queryByLabelText("Buffer distance")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Buffer" }));
    await user.clear(screen.getByLabelText("Buffer distance"));
    await user.type(screen.getByLabelText("Buffer distance"), "50");
    await user.click(screen.getByRole("button", { name: "Apply Buffer" }));

    expect(onBuffer).toHaveBeenCalledWith(50, "meters");
  });

  test("slice section is independently collapsible and shows a hint instead of the toggle button in 2D", async () => {
    const user = userEvent.setup();
    render(<AnalysisPanel is3D={false} onBuffer={jest.fn()} onToggleSlice={jest.fn()} />);

    await user.click(screen.getByRole("button", { name: "ANALYSIS" }));
    expect(screen.queryByText("Switch to 3D view to use Slice.")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Slice" }));

    expect(screen.getByText("Switch to 3D view to use Slice.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start Slice" })).not.toBeInTheDocument();
  });
});
