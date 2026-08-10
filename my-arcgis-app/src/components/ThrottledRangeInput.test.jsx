import { act, fireEvent, render, screen } from "@testing-library/react";
import ThrottledRangeInput from "./ThrottledRangeInput";

const setup = (overrides = {}) => {
  const props = {
    value: 50,
    min: "1",
    max: "100",
    ariaLabel: "Intensity",
    onCommit: jest.fn(),
    ...overrides
  };
  render(<ThrottledRangeInput {...props} />);
  return { props, slider: screen.getByLabelText("Intensity") };
};

describe("ThrottledRangeInput", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("renders a range input seeded from value", () => {
    const { slider } = setup();

    expect(slider).toHaveAttribute("type", "range");
    expect(slider).toHaveValue("50");
  });

  test("a single change commits immediately, so a discrete interaction is not delayed", () => {
    const { props, slider } = setup();

    fireEvent.change(slider, { target: { value: "40" } });

    expect(props.onCommit).toHaveBeenCalledWith(40);
  });

  test("the thumb tracks every event even though only the last one is committed", () => {
    const { props, slider } = setup();

    act(() => {
      fireEvent.change(slider, { target: { value: "60" } });
      fireEvent.change(slider, { target: { value: "70" } });
      fireEvent.change(slider, { target: { value: "80" } });
    });

    // Displayed position is never throttled - it is local state.
    expect(slider).toHaveValue("80");
    // ...but the engine has only been asked to re-render once so far.
    expect(props.onCommit).toHaveBeenCalledTimes(1);
    expect(props.onCommit).toHaveBeenLastCalledWith(60);

    act(() => jest.advanceTimersByTime(100));

    // The value the drag ended on is still committed.
    expect(props.onCommit).toHaveBeenCalledTimes(2);
    expect(props.onCommit).toHaveBeenLastCalledWith(80);
  });

  test("reports every intermediate value through onDraftChange for a live readout", () => {
    const onDraftChange = jest.fn();
    const { slider } = setup({ onDraftChange });

    act(() => {
      fireEvent.change(slider, { target: { value: "60" } });
      fireEvent.change(slider, { target: { value: "70" } });
    });

    expect(onDraftChange.mock.calls).toEqual([[60], [70]]);
  });

  test("ignores a value prop that changes under a drag, so the thumb never snaps backwards", () => {
    const props = { value: 50, ariaLabel: "Intensity", onCommit: jest.fn() };
    const { rerender } = render(<ThrottledRangeInput {...props} />);
    const slider = screen.getByLabelText("Intensity");

    fireEvent.change(slider, { target: { value: "90" } });
    // The parent echoes back a stale value (its own state lags the throttled
    // commit); adopting it mid-drag is exactly what this must not do.
    rerender(<ThrottledRangeInput {...props} value={50} />);

    expect(slider).toHaveValue("90");
  });
});
