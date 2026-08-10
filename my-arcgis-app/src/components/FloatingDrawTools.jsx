import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import Icon from "./Icon";

const DRAW_STATUS_LABEL = {
  point: "Drawing point…",
  polyline: "Drawing line…",
  polygon: "Drawing polygon…"
};

// Every draw tool this app can offer, tagged with the geometryType it
// produces so it can be filtered against the selected draw target's own
// geometryType (see ALL_TOOLS.filter below). "line"'s key stays "line" for
// existing test/CSS-hook compatibility even though the geometry type it
// draws is SketchViewModel's "polyline".
const ALL_TOOLS = [
  { key: "point", icon: "point", label: "Point", geometryType: "point" },
  { key: "polygon", icon: "polygon", label: "Polygon", geometryType: "polygon" },
  { key: "line", icon: "line", label: "Line", geometryType: "polyline" }
];

export default function FloatingDrawTools({
  drawPoint,
  drawLine,
  drawPolygon,
  activeDrawType,
  onCancelDraw,
  drawTargetLayerId,
  drawTargetOptions,
  onChangeDrawTarget
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const runAndClose = (action) => () => {
    action();
    setIsOpen(false);
  };

  const actionByGeometryType = {
    point: runAndClose(drawPoint),
    polygon: runAndClose(drawPolygon),
    polyline: runAndClose(drawLine)
  };

  // The selected target's own geometryType (null when nothing is selected
  // yet, or an unrecognized/not-yet-loaded target) means "no restriction" -
  // show every tool. Otherwise show only the one tool matching that
  // geometry, since a hosted/portal feature layer only ever accepts its own
  // single geometry type.
  const selectedTarget = drawTargetOptions?.find((option) => option.id === drawTargetLayerId);
  const geometryType = selectedTarget?.geometryType ?? null;
  const tools = geometryType ? ALL_TOOLS.filter((tool) => tool.geometryType === geometryType) : ALL_TOOLS;

  return (
    <div
      className={`fab-container${isOpen ? " open" : ""}`}
      ref={containerRef}
    >
      <div className="fab-tool-stack">
        {tools.map((tool, i) => {
          const style = {
            transitionDelay: isOpen ? `${(tools.length - 1 - i) * 30}ms` : "0ms"
          };

          return (
            <button
              key={tool.key}
              type="button"
              className="fab-tool"
              style={style}
              title={tool.label}
              tabIndex={isOpen ? 0 : -1}
              onClick={actionByGeometryType[tool.geometryType]}
            >
              <Icon name={tool.icon} />
              <span className="fab-tool-label">{tool.label}</span>
            </button>
          );
        })}

        {drawTargetOptions && drawTargetOptions.length > 0 && (
          <label
            className="draw-target-bar"
            style={{ transitionDelay: isOpen ? `${tools.length * 30}ms` : "0ms" }}
          >
            <span>Draw into</span>
            <select
              value={drawTargetLayerId}
              onChange={(e) => onChangeDrawTarget(e.target.value)}
              aria-label="Layer to draw new features into"
              tabIndex={isOpen ? 0 : -1}
            >
              {!drawTargetLayerId && <option value="">Select a layer…</option>}
              {drawTargetOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {activeDrawType && (
        <output className="draw-status-chip">
          <span>{DRAW_STATUS_LABEL[activeDrawType] ?? "Drawing…"}</span>
          <button
            type="button"
            aria-label="Cancel drawing"
            title="Cancel drawing"
            onClick={onCancelDraw}
          >
            <Icon name="close" size={13} />
          </button>
        </output>
      )}

      <button
        type="button"
        className="fab-main"
        aria-expanded={isOpen}
        aria-label={isOpen ? "Close drawing tools" : "Open drawing tools"}
        onClick={() => setIsOpen((open) => !open)}
      >
        +
      </button>
    </div>
  );
}

FloatingDrawTools.propTypes = {
  drawPoint: PropTypes.func.isRequired,
  drawLine: PropTypes.func.isRequired,
  drawPolygon: PropTypes.func.isRequired,
  activeDrawType: PropTypes.oneOf(["point", "polyline", "polygon"]),
  onCancelDraw: PropTypes.func,
  drawTargetLayerId: PropTypes.string,
  drawTargetOptions: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      name: PropTypes.string,
      geometryType: PropTypes.oneOf(["point", "polyline", "polygon", null])
    })
  ),
  onChangeDrawTarget: PropTypes.func
};
