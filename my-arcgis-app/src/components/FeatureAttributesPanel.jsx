const POPUP_WIDTH = 280;
const POPUP_MAX_HEIGHT = 320;
const OFFSET = 14;

export default function FeatureAttributesPanel({ feature, onClose }) {
  if (!feature) return null;

  const { layerTitle, attributes, x, y } = feature;
  const entries = Object.entries(attributes || {});

  const overflowsRight = x + OFFSET + POPUP_WIDTH > window.innerWidth;
  const overflowsBottom = y + OFFSET + POPUP_MAX_HEIGHT > window.innerHeight;

  const style = {
    left: overflowsRight ? undefined : x + OFFSET,
    right: overflowsRight ? window.innerWidth - x + OFFSET : undefined,
    top: overflowsBottom ? undefined : y + OFFSET,
    bottom: overflowsBottom ? window.innerHeight - y + OFFSET : undefined
  };

  return (
    <div className="feature-attributes-panel" style={style}>
      <div className="feature-attributes-header">
        <span className="panel-title">{layerTitle}</span>
        <button className="feature-attributes-close" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="feature-attributes-body">
        {entries.map(([key, value]) => (
          <div key={key} className="feature-attribute-row">
            <span className="feature-attribute-key">{key}</span>
            <span className="feature-attribute-value">{String(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
