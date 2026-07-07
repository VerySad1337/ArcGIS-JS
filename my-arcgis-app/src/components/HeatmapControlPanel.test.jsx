import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HeatmapControlPanel from "./HeatmapControlPanel";

describe("HeatmapControlPanel", () => {
  test("shows 'Show Heatmap' when off and toggles on click", async () => {
    const user = userEvent.setup();
    const toggleHeatmap = jest.fn();
    render(
      <HeatmapControlPanel
        heatOn={false}
        toggleHeatmap={toggleHeatmap}
        heatIntensity={50}
        updateIntensity={jest.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Show Heatmap" }));
    expect(toggleHeatmap).toHaveBeenCalled();
  });

  test("shows 'Hide Heatmap' when on", () => {
    render(
      <HeatmapControlPanel
        heatOn={true}
        toggleHeatmap={jest.fn()}
        heatIntensity={70}
        updateIntensity={jest.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Hide Heatmap" })).toBeInTheDocument();
    expect(screen.getByText("70")).toBeInTheDocument();
  });

  test("calls updateIntensity with a number when the slider changes", () => {
    const updateIntensity = jest.fn();
    render(
      <HeatmapControlPanel
        heatOn={false}
        toggleHeatmap={jest.fn()}
        heatIntensity={50}
        updateIntensity={updateIntensity}
      />
    );

    const slider = screen.getByLabelText("Intensity");
    fireEvent.change(slider, { target: { value: "80" } });

    expect(updateIntensity).toHaveBeenCalledWith(80);
  });
});
