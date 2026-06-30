export default function HeatmapControlPanel({
  heatOn,
  toggleHeatmap,
  heatIntensity,
  updateIntensity
}) {
  return (
    <div className="panel-card">
      <div className="panel-title">Heatmap</div>

      <button className="gis-button" onClick={toggleHeatmap}>
        {heatOn ? "Hide Heatmap" : "Show Heatmap"}
      </button>

      <div className="slider-section">
        <label>Intensity</label>

        <input
          type="range"
          min="1"
          max="100"
          value={heatIntensity}
          onChange={(e) => updateIntensity(Number(e.target.value))}
        />

        <div className="slider-value">{heatIntensity}</div>
      </div>
    </div>
  );
}