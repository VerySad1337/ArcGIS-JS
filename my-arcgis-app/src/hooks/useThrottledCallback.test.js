import { act, renderHook } from "@testing-library/react";
import useThrottledCallback from "./useThrottledCallback";

describe("useThrottledCallback", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("runs the first call in a burst synchronously (leading edge)", () => {
    const spy = jest.fn();
    const { result } = renderHook(() => useThrottledCallback(spy, 80));

    act(() => result.current("a"));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("a");
  });

  test("coalesces calls inside the window into one trailing call with the latest arguments", () => {
    const spy = jest.fn();
    const { result } = renderHook(() => useThrottledCallback(spy, 80));

    act(() => {
      result.current(1);
      result.current(2);
      result.current(3);
    });

    // Only the leading call has run so far.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith(1);

    act(() => jest.advanceTimersByTime(80));

    // The final value a user dragged to is never dropped.
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith(3);
  });

  test("a call after the window has elapsed runs synchronously again", () => {
    const spy = jest.fn();
    const { result } = renderHook(() => useThrottledCallback(spy, 80));

    act(() => result.current("first"));
    act(() => jest.advanceTimersByTime(200));
    act(() => result.current("second"));

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenLastCalledWith("second");
  });

  test("keeps a stable identity across re-renders while still invoking the latest callback", () => {
    const first = jest.fn();
    const second = jest.fn();
    const { result, rerender } = renderHook(({ cb }) => useThrottledCallback(cb, 80), {
      initialProps: { cb: first }
    });

    const throttled = result.current;
    rerender({ cb: second });

    expect(result.current).toBe(throttled);

    act(() => jest.advanceTimersByTime(200));
    act(() => result.current("x"));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith("x");
  });

  test("does not fire a pending trailing call after unmount", () => {
    const spy = jest.fn();
    const { result, unmount } = renderHook(() => useThrottledCallback(spy, 80));

    act(() => {
      result.current(1);
      result.current(2);
    });
    unmount();

    act(() => jest.advanceTimersByTime(200));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenLastCalledWith(1);
  });
});
