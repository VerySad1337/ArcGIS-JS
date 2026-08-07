import { useState } from "react";
import PropTypes from "prop-types";
import RouteInput from "./RouteInput";
import Icon from "./Icon";

// Route search is collapsed by default: most sessions are drawing/browsing,
// not actively routing, so it shouldn't sit permanently expanded above the
// always-relevant LAYERS panel. Mirrors PortalLayerPanel/AnalysisPanel's
// collapsed-by-default pattern. The 2D/3D view-mode toggle lives separately
// in ViewModeToggle, at the top of the sidebar - see ApplicationShell.
export default function RoutingControlPanel({
  routeOn,
  toggleRoute,
  onRoute,
  isRouting
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="panel-card">
      <button
        type="button"
        className="panel-title panel-title-toggle"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
      >
        <span>ROUTE SEARCH</span>
        <Icon name={isOpen ? "chevronUp" : "chevronDown"} />
      </button>

      {isOpen && (
        <>
          <RouteInput onRoute={onRoute} isRouting={isRouting} />
          <button type="button" className="gis-button gis-button-secondary" onClick={toggleRoute}>
            {routeOn ? "Hide Route" : "Show Route"}
          </button>
        </>
      )}
    </div>
  );
}

RoutingControlPanel.propTypes = {
  routeOn: PropTypes.bool,
  toggleRoute: PropTypes.func,
  onRoute: PropTypes.func,
  isRouting: PropTypes.bool
};