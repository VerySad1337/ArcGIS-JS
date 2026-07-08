import { useState } from "react";
import PropTypes from "prop-types";
import Icon from "./Icon";

export default function LayerControlPanel({
  layers,
  onToggle,
  onReorder,
  onStyleChange,
  onZoomToLayer,
  heatIntensity,
  updateIntensity
}) {
  const [dragIndex, setDragIndex] = useState(null);
  const [expandedIds, setExpandedIds] = useState({});

  const toggleExpanded = (id) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const visibleLayers = layers.filter(Boolean);

  const moveLayer = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= visibleLayers.length) return;
    onReorder(index, target);
  };

  return (
    <div className="panel-card">
      <div className="panel-title">LAYERS</div>

      {visibleLayers.length === 0 && (
        <p className="layer-empty-state">Layers will appear here once the map finishes loading.</p>
      )}

      {visibleLayers.map((layer, index) => {
        const styleGroups = layer.styleGroups ?? [];
        const isStylable = styleGroups.length > 0;
        const isExpanded = isStylable && expandedIds[layer.id];

        return (
        <div key={layer.id} className="layer-row-wrapper">
          <fieldset
            className="layer-row"
            aria-label={`${layer.name} controls`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragIndex === null || dragIndex === index) return;
              onReorder(dragIndex, index);
              setDragIndex(null);
            }}
          >
            <button
              className="layer-eye-btn"
              aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
              onClick={() => onToggle(layer.id)}
            >
              <Icon name={layer.visible ? "eye" : "eyeOff"} />
            </button>

            <button
              type="button"
              className="drag-handle"
              draggable
              aria-label={`Drag to reorder ${layer.name}, or use this button and the arrow up/down keys`}
              onDragStart={() => setDragIndex(index)}
              onDragEnd={() => setDragIndex(null)}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  moveLayer(index, -1);
                } else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  moveLayer(index, 1);
                }
              }}
            >
              <Icon name="drag" />
            </button>

            <span className="layer-name">{layer.name}</span>

            <button
              type="button"
              className="layer-zoom-btn"
              aria-label={`Zoom to ${layer.name}`}
              onClick={() => onZoomToLayer(layer.id)}
            >
              <Icon name="zoomTo" />
            </button>

            <div className="layer-reorder-btns">
              <button
                type="button"
                className="layer-reorder-btn"
                aria-label="Move layer up"
                disabled={index === 0}
                onClick={() => moveLayer(index, -1)}
              >
                <Icon name="arrowUp" />
              </button>
              <button
                type="button"
                className="layer-reorder-btn"
                aria-label="Move layer down"
                disabled={index === visibleLayers.length - 1}
                onClick={() => moveLayer(index, 1)}
              >
                <Icon name="arrowDown" />
              </button>
            </div>

            <button
              className="layer-chevron-btn"
              style={{ visibility: isStylable ? "visible" : "hidden" }}
              disabled={!isStylable}
              onClick={() => toggleExpanded(layer.id)}
              aria-label="Toggle layer styling options"
            >
              <Icon name={isExpanded ? "chevronUp" : "chevronDown"} />
            </button>
          </fieldset>

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
                  <span>{isPolygon ? "Fill Color" : "Color"}</span>
                  <input
                    type="color"
                    value={group.color}
                    onChange={(e) => applyStyle({ color: e.target.value })}
                  />
                </label>

                {isPolygon && (
                  <label className="layer-style-field">
                    <span>Border Color</span>
                    <input
                      type="color"
                      value={group.outlineColor ?? "#000000"}
                      onChange={(e) => applyStyle({ outlineColor: e.target.value })}
                    />
                  </label>
                )}

                <label className="layer-style-field">
                  <span>Border Width</span>
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

LayerControlPanel.propTypes = {
  layers: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      name: PropTypes.string,
      visible: PropTypes.bool,
      styleGroups: PropTypes.array
    })
  ).isRequired,
  onToggle: PropTypes.func.isRequired,
  onReorder: PropTypes.func.isRequired,
  onStyleChange: PropTypes.func.isRequired,
  onZoomToLayer: PropTypes.func.isRequired,
  heatIntensity: PropTypes.number,
  updateIntensity: PropTypes.func
};