import { useState } from "react";
import PropTypes from "prop-types";
import Icon from "./Icon";

const BUFFER_UNITS = [
  { value: "meters", label: "Meters" },
  { value: "kilometers", label: "Kilometers" },
  { value: "feet", label: "Feet" },
  { value: "miles", label: "Miles" }
];

// Buffer works in both 2D and 3D (geodesicBuffer is pure geometry math,
// independent of the current view). Slice wraps an ArcGIS widget that only
// ever operates against a SceneView, so it alone is gated on is3D - shown
// as an explanatory hint instead of the toggle button whenever is3D is
// false, rather than a disabled control whose failure mode a user would
// have to guess at.
export default function AnalysisPanel({
  is3D,
  selectedFeature,
  onBuffer,
  sliceActive,
  onToggleSlice
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [distance, setDistance] = useState("100");
  const [unit, setUnit] = useState("meters");

  const distanceValue = Number(distance);
  const canBuffer = Boolean(selectedFeature) && Number.isFinite(distanceValue) && distanceValue > 0;

  const handleBuffer = () => {
    onBuffer(distanceValue, unit);
  };

  return (
    <div className="panel-card">
      <button
        type="button"
        className="panel-title panel-title-toggle"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
      >
        <span>ANALYSIS</span>
        <Icon name={isOpen ? "chevronUp" : "chevronDown"} />
      </button>

      {isOpen && (
        <>
          <div className="analysis-tool-section">
            <span className="analysis-tool-label">Buffer</span>
            <div className="analysis-tool-row">
              <input
                type="number"
                min="0"
                step="any"
                aria-label="Buffer distance"
                value={distance}
                onChange={(e) => setDistance(e.target.value)}
              />
              <select
                aria-label="Buffer unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              >
                {BUFFER_UNITS.map((u) => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </select>
            </div>
            {!selectedFeature && (
              <p className="analysis-tool-hint">Select a feature on the map first.</p>
            )}
            <button
              type="button"
              className="gis-button"
              disabled={!canBuffer}
              onClick={handleBuffer}
            >
              Apply Buffer
            </button>
          </div>

          <div className="analysis-tool-section">
            <span className="analysis-tool-label">Slice</span>
            {!is3D ? (
              <p className="analysis-tool-hint">Switch to 3D view to use Slice.</p>
            ) : (
              <>
                <p className="analysis-tool-hint">
                  Drag out a box on the scene to cut away part of the 3D view.
                </p>
                <button
                  type="button"
                  className="gis-button-secondary"
                  onClick={onToggleSlice}
                >
                  {sliceActive ? "Stop Slice" : "Start Slice"}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

AnalysisPanel.propTypes = {
  is3D: PropTypes.bool,
  selectedFeature: PropTypes.object,
  onBuffer: PropTypes.func.isRequired,
  sliceActive: PropTypes.bool,
  onToggleSlice: PropTypes.func.isRequired
};
