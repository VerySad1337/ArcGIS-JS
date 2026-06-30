import { useState } from "react";

export function useHeatmapAnalysis() {
  const [enabled, setEnabled] = useState(false);

  return {
    heatmapEnabled: enabled,
    toggleHeatmap: () => setEnabled((v) => !v)
  };
}