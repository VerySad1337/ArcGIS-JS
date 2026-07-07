import { renderHook, act } from "@testing-library/react";
import { useHeatmapAnalysis } from "./useHeatmapAnalysis";

describe("useHeatmapAnalysis", () => {
  test("starts disabled and toggles on/off", () => {
    const { result } = renderHook(() => useHeatmapAnalysis());

    expect(result.current.heatmapEnabled).toBe(false);

    act(() => result.current.toggleHeatmap());
    expect(result.current.heatmapEnabled).toBe(true);

    act(() => result.current.toggleHeatmap());
    expect(result.current.heatmapEnabled).toBe(false);
  });
});
