import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GeocoderToggle from "./GeocoderToggle";

describe("GeocoderToggle", () => {
  test("reflects the current provider via aria-pressed", () => {
    render(<GeocoderToggle provider="esri" onChangeProvider={jest.fn()} />);

    expect(screen.getByRole("button", { name: "Esri" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "OneMap" })).toHaveAttribute("aria-pressed", "false");
  });

  test("clicking OneMap/Esri calls onChangeProvider with the selected provider", async () => {
    const user = userEvent.setup();
    const onChangeProvider = jest.fn();
    render(<GeocoderToggle provider="esri" onChangeProvider={onChangeProvider} />);

    await user.click(screen.getByRole("button", { name: "OneMap" }));
    expect(onChangeProvider).toHaveBeenCalledWith("onemap");

    await user.click(screen.getByRole("button", { name: "Esri" }));
    expect(onChangeProvider).toHaveBeenCalledWith("esri");
  });
});
