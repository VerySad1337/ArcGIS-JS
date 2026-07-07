import { useState } from "react";
import PropTypes from "prop-types";

const POPUP_WIDTH = 280;
const POPUP_MAX_HEIGHT = 320;
const OFFSET = 14;

export default function FeatureAttributesPanel({ feature, onClose, onSaveAttributes, onAddColumn }) {
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState({});
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldValue, setNewFieldValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectionKey, setSelectionKey] = useState(null);

  // Reset edit state only when a *different* feature is selected (identified by
  // click position), not when the same feature's attributes are updated in place
  // after a save/add-column round trip.
  const currentKey = feature ? `${feature.layerId}:${feature.x}:${feature.y}` : null;
  if (currentKey !== selectionKey) {
    setSelectionKey(currentKey);
    setEditMode(false);
    setDraft(feature?.attributes || {});
    setNewFieldName("");
    setNewFieldValue("");
  }

  if (!feature) return null;

  const { layerTitle, attributes, objectIdField, x, y } = feature;
  const entries = Object.entries(attributes || {});

  const overflowsRight = x + OFFSET + POPUP_WIDTH > window.innerWidth;
  const overflowsBottom = y + OFFSET + POPUP_MAX_HEIGHT > window.innerHeight;

  const style = {
    left: overflowsRight ? undefined : x + OFFSET,
    right: overflowsRight ? window.innerWidth - x + OFFSET : undefined,
    top: overflowsBottom ? undefined : y + OFFSET,
    bottom: overflowsBottom ? window.innerHeight - y + OFFSET : undefined
  };

  const startEdit = () => {
    setDraft(attributes || {});
    setEditMode(true);
  };

  const cancelEdit = () => {
    setDraft(attributes || {});
    setEditMode(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSaveAttributes?.(draft);
      setEditMode(false);
    } finally {
      setSaving(false);
    }
  };

  const handleAddColumn = async () => {
    const name = newFieldName.trim();
    if (!name) return;
    await onAddColumn?.(name, newFieldValue);
    setNewFieldName("");
    setNewFieldValue("");
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
            {editMode && key !== objectIdField ? (
              <input
                className="feature-attribute-input"
                value={draft[key] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
              />
            ) : (
              <span className="feature-attribute-value">{String(value)}</span>
            )}
          </div>
        ))}

        {editMode && (
          <div className="feature-attributes-add-column">
            <input
              className="feature-attribute-input"
              placeholder="New column name"
              value={newFieldName}
              onChange={(e) => setNewFieldName(e.target.value)}
            />
            <input
              className="feature-attribute-input"
              placeholder="Default value"
              value={newFieldValue}
              onChange={(e) => setNewFieldValue(e.target.value)}
            />
            <button type="button" onClick={handleAddColumn}>
              + Add Column
            </button>
          </div>
        )}
      </div>

      <div className="feature-attributes-footer">
        {editMode ? (
          <>
            <button type="button" disabled={saving} onClick={handleSave}>
              {saving ? "Saving..." : "Save"}
            </button>
            <button type="button" disabled={saving} onClick={cancelEdit}>
              Cancel
            </button>
          </>
        ) : (
          <button type="button" onClick={startEdit}>
            Edit
          </button>
        )}
      </div>
    </div>
  );
}

FeatureAttributesPanel.propTypes = {
  feature: PropTypes.shape({
    layerId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    layerTitle: PropTypes.string,
    attributes: PropTypes.object,
    objectIdField: PropTypes.string,
    x: PropTypes.number,
    y: PropTypes.number
  }),
  onClose: PropTypes.func,
  onSaveAttributes: PropTypes.func,
  onAddColumn: PropTypes.func
};
