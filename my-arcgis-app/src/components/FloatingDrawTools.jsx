import { useEffect, useRef, useState } from "react";

// Arc that the fan sweeps across, in degrees (0 = pointing right, 90 = pointing up).
const FAN_START_ANGLE = 100;
const FAN_END_ANGLE = 190;
const FAN_RADIUS = 110;

export default function FloatingDrawTools({
  drawPoint,
  drawLine,
  drawPolygon,
  saveGeoJSON,
  uploadGeoJSON
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
    { key: "point", icon: "📍", label: "Point", onClick: runAndClose(drawPoint) },
    { key: "polygon", icon: "⬠", label: "Polygon", onClick: runAndClose(drawPolygon) },
    { key: "line", icon: "📏", label: "Line", onClick: runAndClose(drawLine) },
    { key: "save", icon: "💾", label: "Save GeoJSON", onClick: runAndClose(saveGeoJSON) },
    { key: "upload", icon: "📂", label: "Upload GeoJSON", isUpload: true }
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
            <label
              key={tool.key}
              className="fab-tool fab-upload"
              style={style}
              title={tool.label}
            >
              {tool.icon}
              <input
                hidden
                type="file"
                accept=".geojson,.json"
                onChange={handleFileUpload}
              />
            </label>
          );
        }

        return (
          <button
            key={tool.key}
            className="fab-tool"
            style={style}
            title={tool.label}
            onClick={tool.onClick}
          >
            {tool.icon}
          </button>
        );
      })}

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
