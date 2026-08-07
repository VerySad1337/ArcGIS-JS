import PropTypes from "prop-types";

// Rendered at the very top of the sidebar, above every collapsible panel -
// switching 2D/3D is a frequent, always-relevant action, not scoped to
// routing or any other single panel.
export default function ViewModeToggle({ is3D, setIs3D }) {
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
      </fieldset>
    </div>
  );
}

ViewModeToggle.propTypes = {
  is3D: PropTypes.bool,
  setIs3D: PropTypes.func.isRequired
};
