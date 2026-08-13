import { memo } from "react";
import PropTypes from "prop-types";

// Rendered right below ViewModeToggle, for the same reason that one sits at
// the very top of the sidebar rather than inside a single panel: which
// geocoder answers Route Search, Reverse Geocode, and Global Search's
// address lookups is one app-wide choice, not scoped to any one of those
// three panels - see ApplicationShell.jsx's geocoderProvider state, which
// all three read from.
function GeocoderToggle({ provider, onChangeProvider }) {
  return (
    <div className="view-mode-bar">
      <span className="view-mode-bar-label">Geocoder</span>
      <fieldset className="view-mode-toggle" aria-label="Geocoding provider">
        <button
          type="button"
          className="view-mode-btn"
          aria-pressed={provider === "esri"}
          onClick={() => onChangeProvider("esri")}
        >
          Esri
        </button>
        <button
          type="button"
          className="view-mode-btn"
          aria-pressed={provider === "onemap"}
          onClick={() => onChangeProvider("onemap")}
        >
          OneMap
        </button>
      </fieldset>
    </div>
  );
}

GeocoderToggle.propTypes = {
  provider: PropTypes.oneOf(["esri", "onemap"]),
  onChangeProvider: PropTypes.func.isRequired
};

// Memoized for the same reason ViewModeToggle is - see that component's own
// comment.
export default memo(GeocoderToggle);
