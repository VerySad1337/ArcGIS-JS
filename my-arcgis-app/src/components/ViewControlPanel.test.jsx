import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ViewControlPanel from "./ViewControlPanel";

describe("ViewControlPanel", () => {
  test("shows 'Switch to 3D' when in 2D mode and calls setIs3D(true) on click", async () => {
    const user = userEvent.setup();
    const setIs3D = jest.fn();
    render(<ViewControlPanel is3D={false} setIs3D={setIs3D} />);

    const button = screen.getByRole("button", { name: "Switch to 3D" });
    await user.click(button);

    expect(setIs3D).toHaveBeenCalledWith(true);
  });

  test("shows 'Switch to 2D' when in 3D mode and calls setIs3D(false) on click", async () => {
    const user = userEvent.setup();
    const setIs3D = jest.fn();
    render(<ViewControlPanel is3D={true} setIs3D={setIs3D} />);

    await user.click(screen.getByRole("button", { name: "Switch to 2D" }));

    expect(setIs3D).toHaveBeenCalledWith(false);
  });
});
