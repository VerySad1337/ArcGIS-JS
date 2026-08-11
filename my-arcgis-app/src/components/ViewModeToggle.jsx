import { memo } from "react";
import PropTypes from "prop-types";

// Rendered at the very top of the sidebar, above every collapsible panel -
// switching 2D/3D is a frequent, always-relevant action, not scoped to
// routing or any other single panel.
function ViewModeToggle({ is3D, setIs3D, satelliteBasemap, onToggleSatelliteBasemap }) {
  return (
    <div className="view-mode-bar">
      <span className="view-mode-bar-label">View</span>
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
        <button
          type="button"
          className="view-mode-btn view-mode-satellite-btn"
          aria-pressed={satelliteBasemap}
          aria-label="Satellite imagery basemap"
          title="Satellite imagery"
          onClick={() => onToggleSatelliteBasemap(!satelliteBasemap)}
        >
          Satellite
        </button>
      </fieldset>
    </div>
  );
}

ViewModeToggle.propTypes = {
  is3D: PropTypes.bool,
  setIs3D: PropTypes.func.isRequired,
  satelliteBasemap: PropTypes.bool,
  onToggleSatelliteBasemap: PropTypes.func.isRequired
};

// Memoized: ApplicationShell re-renders on any of its own state changes
// (toast, sidebar, draw state, layer refresh). Every prop this component
// receives from there is either a primitive or a useCallback/useMemo-stabilized
// value, so memo lets those unrelated re-renders stop at this boundary.
export default memo(ViewModeToggle);
