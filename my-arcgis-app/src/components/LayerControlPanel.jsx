import { useState } from "react";

export default function LayerControlPanel({
  layers,
  onToggle,
  onReorder,
  onStyleChange,
  heatIntensity,
  updateIntensity
}) {
  const [dragIndex, setDragIndex] = useState(null);
  const [expandedIds, setExpandedIds] = useState({});

  const toggleExpanded = (id) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="panel-card">
      <div className="panel-title">LAYERS</div>

      {layers.filter(Boolean).map((layer, index) => {
        const styleGroups = layer.styleGroups ?? [];
        const isStylable = styleGroups.length > 0;
        const isExpanded = isStylable && expandedIds[layer.id];

        return (
        <div key={layer.id} className="layer-row-wrapper">
          <div
            className="layer-row"
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex === null || dragIndex === index) return;
              onReorder(dragIndex, index);
              setDragIndex(null);
            }}
            onDragEnd={() => setDragIndex(null)}
          >
            <button
              className="layer-eye-btn"
              onClick={() => onToggle(layer.id)}
            >
              {layer.visible ? "👁" : "🚫"}
            </button>

            <span className="drag-handle">☰</span>

            <span className="layer-name">{layer.name}</span>

            {isStylable && (
              <button
                className="layer-chevron-btn"
                onClick={() => toggleExpanded(layer.id)}
                aria-label="Toggle layer styling options"
              >
                {isExpanded ? "▲" : "▼"}
              </button>
            )}
          </div>

          {isExpanded && styleGroups.map((group) => {
            const isPolygon = group.symbolType === "simple-fill";
            const applyStyle = (change) =>
              onStyleChange(layer.id, { ...change, symbolType: group.symbolType });

            return (
              <div key={group.symbolType} className="layer-style-controls">
                {styleGroups.length > 1 && (
                  <span className="layer-style-group-label">{group.label}</span>
                )}

                <label className="layer-style-field">
                  {isPolygon ? "Fill Color" : "Color"}
                  <input
                    type="color"
                    value={group.color}
                    onChange={(e) => applyStyle({ color: e.target.value })}
                  />
                </label>

                {isPolygon && (
                  <label className="layer-style-field">
                    Border Color
                    <input
                      type="color"
                      value={group.outlineColor ?? "#000000"}
                      onChange={(e) => applyStyle({ outlineColor: e.target.value })}
                    />
                  </label>
                )}

                <label className="layer-style-field">
                  Border Width
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={group.borderWidth ?? 0}
                    onChange={(e) => applyStyle({ borderWidth: Number(e.target.value) })}
                  />
                </label>
              </div>
            );
          })}

          {layer.id === "heat" && layer.visible && (
            <div className="heat-slider-container">
              <input
                type="range"
                min="1"
                max="100"
                value={heatIntensity}
                onChange={(e) => updateIntensity(Number(e.target.value))}
              />

              <div className="slider-value">
                Heat Intensity: {heatIntensity}
              </div>
            </div>
          )}
        </div>
        );
      })}
    </div>
  );
}