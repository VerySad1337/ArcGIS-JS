import RouteInput from "./RouteInput";

export default function RoutingControlPanel({
  is3D,
  setIs3D,
  routeOn,
  toggleRoute,
  heatOn,
  toggleHeatmap,
  heatIntensity,
  updateIntensity,
  onRoute
}) {
  return (
    <>

      {/* VIEW MODE */}
      <div className="panel-card">
        <div className="panel-title">
          VIEW MODE
        </div>

        <button
          className="gis-button"
          onClick={() => setIs3D(!is3D)}
        >
          {is3D ? "Switch to 2D" : "Switch to 3D"}
        </button>
      </div>

      {/* ROUTE */}
      <div className="panel-card">
        <div className="panel-title">
          ROUTE SEARCH
        </div>

        <RouteInput onRoute={onRoute} />
      </div>

      {/* ROUTE TOGGLE */}
      <div className="panel-card">
        <div className="panel-title">
          ROUTE LAYER
        </div>

        <button className="gis-button" onClick={toggleRoute}>
          {routeOn ? "Hide Route" : "Show Route"}
        </button>
      </div>

      {/* HEATMAP */}
      <div className="panel-card">
        <div className="panel-title">
          HEATMAP
        </div>

        <button className="gis-button" onClick={toggleHeatmap}>
          {heatOn ? "Hide Heatmap" : "Show Heatmap"}
        </button>

        <input
          type="range"
          min="1"
          max="100"
          value={heatIntensity}
          onChange={(e) =>
            updateIntensity(Number(e.target.value))
          }
        />

        <div className="slider-value">
          {heatIntensity}
        </div>
      </div>

    </>
  );
}