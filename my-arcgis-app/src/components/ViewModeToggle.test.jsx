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
});
