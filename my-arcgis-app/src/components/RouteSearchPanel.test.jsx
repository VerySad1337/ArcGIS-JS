import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RouteSearchPanel from "./RouteSearchPanel";

describe("RouteSearchPanel", () => {
  test("renders the title and forwards route submission to onRoute", async () => {
    const user = userEvent.setup();
    const onRoute = jest.fn();
    render(<RouteSearchPanel onRoute={onRoute} />);

    expect(screen.getByText("Route Search")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Start location"), "A");
    await user.type(screen.getByPlaceholderText("End location"), "B");
    await user.click(screen.getByRole("button", { name: "Calculate Route" }));

    expect(onRoute).toHaveBeenCalledWith("A", "B");
  });
});
