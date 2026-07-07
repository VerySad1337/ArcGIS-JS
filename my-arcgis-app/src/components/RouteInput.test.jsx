import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RouteInput from "./RouteInput";

describe("RouteInput", () => {
  test("calls onRoute with start and end when both are filled in", async () => {
    const user = userEvent.setup();
    const onRoute = jest.fn();
    render(<RouteInput onRoute={onRoute} />);

    await user.type(screen.getByPlaceholderText("Start location"), "A");
    await user.type(screen.getByPlaceholderText("End location"), "B");
    await user.click(screen.getByRole("button", { name: "Calculate Route" }));

    expect(onRoute).toHaveBeenCalledWith("A", "B");
  });

  test("does not call onRoute when start or end is empty", async () => {
    const user = userEvent.setup();
    const onRoute = jest.fn();
    render(<RouteInput onRoute={onRoute} />);

    await user.click(screen.getByRole("button", { name: "Calculate Route" }));
    expect(onRoute).not.toHaveBeenCalled();

    await user.type(screen.getByPlaceholderText("Start location"), "A");
    await user.click(screen.getByRole("button", { name: "Calculate Route" }));
    expect(onRoute).not.toHaveBeenCalled();
  });
});
