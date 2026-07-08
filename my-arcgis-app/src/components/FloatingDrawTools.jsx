import { Fragment, useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import Icon from "./Icon";

// Arc that the fan sweeps across, in degrees (0 = pointing right, 90 = pointing up).
const FAN_START_ANGLE = 100;
const FAN_END_ANGLE = 190;
const FAN_RADIUS = 110;

const DRAW_STATUS_LABEL = {
  point: "Drawing point…",
  polyline: "Drawing line…",
  polygon: "Drawing polygon…"
};

export default function FloatingDrawTools({
  drawPoint,
  drawLine,
  drawPolygon,
  saveGeoJSON,
  uploadGeoJSON,
  activeDrawType,
  onCancelDraw
}) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);
  const uploadInputRef = useRef(null);

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

  const handleFileUpload = ({ target }) => {
    const file = target.files?.[0];
    if (!file) return;
    uploadGeoJSON(file);
    target.value = "";
    setIsOpen(false);
  };

  const runAndClose = (action) => () => {
    action();
    setIsOpen(false);
  };

  const tools = [
    { key: "point", icon: "point", label: "Point", onClick: runAndClose(drawPoint) },
    { key: "polygon", icon: "polygon", label: "Polygon", onClick: runAndClose(drawPolygon) },
    { key: "line", icon: "line", label: "Line", onClick: runAndClose(drawLine) },
    { key: "save", icon: "save", label: "Save GeoJSON", onClick: runAndClose(saveGeoJSON) },
    { key: "upload", icon: "upload", label: "Upload GeoJSON", isUpload: true }
  ];

  const step =
    tools.length > 1 ? (FAN_END_ANGLE - FAN_START_ANGLE) / (tools.length - 1) : 0;

  return (
    <div
      className={`fab-container${isOpen ? " open" : ""}`}
      ref={containerRef}
    >
      {tools.map((tool, i) => {
        const angleDeg = FAN_START_ANGLE + step * i;
        const angleRad = (angleDeg * Math.PI) / 180;
        const dx = FAN_RADIUS * Math.cos(angleRad);
        const dy = -FAN_RADIUS * Math.sin(angleRad);
        const style = {
          "--dx": `${dx}px`,
          "--dy": `${dy}px`,
          transitionDelay: isOpen ? `${i * 30}ms` : "0ms"
        };

        if (tool.isUpload) {
          return (
            <Fragment key={tool.key}>
              <button
                type="button"
                className="fab-tool fab-upload"
                style={style}
                title={tool.label}
                aria-label={tool.label}
                tabIndex={isOpen ? 0 : -1}
                onClick={() => uploadInputRef.current?.click()}
              >
                <Icon name={tool.icon} />
              </button>
              <input
                ref={uploadInputRef}
                hidden
                type="file"
                accept=".geojson,.json"
                tabIndex={-1}
                onChange={handleFileUpload}
              />
            </Fragment>
          );
        }

        return (
          <button
            key={tool.key}
            className="fab-tool"
            style={style}
            title={tool.label}
            aria-label={tool.label}
            tabIndex={isOpen ? 0 : -1}
            onClick={tool.onClick}
          >
            <Icon name={tool.icon} />
          </button>
        );
      })}

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
  saveGeoJSON: PropTypes.func.isRequired,
  uploadGeoJSON: PropTypes.func.isRequired,
  activeDrawType: PropTypes.oneOf(["point", "polyline", "polygon"]),
  onCancelDraw: PropTypes.func
};
