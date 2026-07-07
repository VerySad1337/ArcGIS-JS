import PropTypes from "prop-types";
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
      <div className="panel-card">
        <div className="panel-title">VIEW MODE</div>
        <button
          className="gis-button"
          onClick={() => setIs3D(!is3D)}
        >
          {is3D ? "Switch to 2D" : "Switch to 3D"}
        </button>
      </div>
      <div className="panel-card">
        <div className="panel-title">ROUTE SEARCH</div>
        <RouteInput onRoute={onRoute} />
      </div>
    </>
  );
}

RoutingControlPanel.propTypes = {
  is3D: PropTypes.bool,
  setIs3D: PropTypes.func,
  routeOn: PropTypes.bool,
  toggleRoute: PropTypes.func,
  heatOn: PropTypes.bool,
  toggleHeatmap: PropTypes.func,
  heatIntensity: PropTypes.number,
  updateIntensity: PropTypes.func,
  onRoute: PropTypes.func
};