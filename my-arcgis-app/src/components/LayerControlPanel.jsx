import { useState } from "react";

export default function LayerControlPanel({
  layers,
  onToggle,
  onReorder,
  heatIntensity,
  updateIntensity
}) {
  const [dragIndex, setDragIndex] = useState(null);

  return (
    <div className="panel-card">
      <div className="panel-title">LAYERS</div>

      {layers.filter(Boolean).map((layer, index) => (
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
          </div>

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
      ))}
    </div>
  );
}