import PropTypes from "prop-types";
import RouteInput from "./RouteInput";

export default function RoutingControlPanel({
  is3D,
  setIs3D,
  routeOn,
  toggleRoute,
  onRoute
}) {
  return (
    <>
      <div className="panel-card">
        <div className="panel-title">VIEW MODE</div>
        <fieldset className="view-mode-toggle" aria-label="Map view mode">
          <button
            type="button"
            className="view-mode-btn"
            aria-pressed={!is3D}
            onClick={() => setIs3D(false)}
          >
            2D
          </button>
          <button
            type="button"
            className="view-mode-btn"
            aria-pressed={is3D}
            onClick={() => setIs3D(true)}
          >
            3D
          </button>
        </fieldset>
      </div>

      <div className="panel-card">
        <div className="panel-title">ROUTE SEARCH</div>
        <RouteInput onRoute={onRoute} />
        <button type="button" className="gis-button gis-button-secondary" onClick={toggleRoute}>
          {routeOn ? "Hide Route" : "Show Route"}
        </button>
      </div>

    </>
  );
}

RoutingControlPanel.propTypes = {
  is3D: PropTypes.bool,
  setIs3D: PropTypes.func,
  routeOn: PropTypes.bool,
  toggleRoute: PropTypes.func,
  onRoute: PropTypes.func
};