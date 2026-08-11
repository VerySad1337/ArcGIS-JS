import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ViewModeToggle from "./ViewModeToggle";

describe("ViewModeToggle", () => {
  test("reflects the current mode via aria-pressed", () => {
    render(<ViewModeToggle is3D={false} setIs3D={jest.fn()} />);

    expect(screen.getByRole("button", { name: "2D" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "3D" })).toHaveAttribute("aria-pressed", "false");
  });

  test("clicking 3D/2D calls setIs3D with the selected mode", async () => {
    const user = userEvent.setup();
    const setIs3D = jest.fn();
    render(<ViewModeToggle is3D={false} setIs3D={setIs3D} />);

    await user.click(screen.getByRole("button", { name: "3D" }));
    expect(setIs3D).toHaveBeenCalledWith(true);

    await user.click(screen.getByRole("button", { name: "2D" }));
    expect(setIs3D).toHaveBeenCalledWith(false);
  });

  test("satellite button reflects state and toggles it", async () => {
    const user = userEvent.setup();
    const onToggleSatelliteBasemap = jest.fn();
    render(
      <ViewModeToggle
        is3D={false}
        setIs3D={jest.fn()}
        satelliteBasemap={false}
        onToggleSatelliteBasemap={onToggleSatelliteBasemap}
      />
    );

    const satelliteBtn = screen.getByRole("button", { name: "Satellite imagery basemap" });
    expect(satelliteBtn).toHaveAttribute("aria-pressed", "false");

    await user.click(satelliteBtn);
    expect(onToggleSatelliteBasemap).toHaveBeenCalledWith(true);
  });
});
