import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import Icon from "./Icon";

const POPUP_WIDTH = 280;
const POPUP_MAX_HEIGHT = 320;
const OFFSET = 14;

// `canEdit` gates the editing affordances rather than the edit *attempt*.
// Showing Edit/Add Column to a user who can't use them meant the rejection
// surfaced as IdentityManager's own sign-in modal, which reads as the app
// demanding a login. Viewing attributes never requires an account, so the
// read-only panel is the default and editing is additive.
export default function FeatureAttributesPanel({
  feature,
  onClose,
  onSaveAttributes,
  onAddColumn,
  onDeleteColumn,
  onDeleteFeature,
  canEdit = true
}) {
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState({});
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldValue, setNewFieldValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [pendingFeatureDelete, setPendingFeatureDelete] = useState(false);
  const [selectionKey, setSelectionKey] = useState(null);
  const closeButtonRef = useRef(null);

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
    setPendingDelete(null);
    setPendingFeatureDelete(false);
  }

  useEffect(() => {
    if (!currentKey) return;
    closeButtonRef.current?.focus();

    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [currentKey, onClose]);

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
    setPendingDelete(null);
    setPendingFeatureDelete(false);
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

  // Dropping a column destroys that value on every feature in the layer and
  // (for a hosted layer) is not undoable from here, so the ✕ arms a
  // confirmation in place of the row rather than deleting on first click.
  const handleDeleteColumn = async (key) => {
    setSaving(true);
    try {
      await onDeleteColumn?.(key);
      setPendingDelete(null);
      setDraft((d) => {
        const remaining = { ...d };
        delete remaining[key];
        return remaining;
      });
    } finally {
      setSaving(false);
    }
  };

  // Deleting the feature removes the whole point/line/polygon from its layer -
  // for a hosted layer that is a server-side delete with no undo from here -
  // so it takes the same arm-then-confirm step a column delete does, rather
  // than firing on a single click next to Save.
  const handleDeleteFeature = async () => {
    setSaving(true);
    try {
      await onDeleteFeature?.();
      setPendingFeatureDelete(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="feature-attributes-panel" style={style}>
      <div className="feature-attributes-header">
        <span className="panel-title">{layerTitle}</span>
        <button
          ref={closeButtonRef}
          className="feature-attributes-close"
          aria-label="Close"
          onClick={onClose}
        >
          <Icon name="close" size={14} />
        </button>
      </div>

      <div className="feature-attributes-body">
        {entries.map(([key, value]) => {
          const editable = editMode && key !== objectIdField;

          if (editable && pendingDelete === key) {
            return (
              <div key={key} className="feature-attribute-row feature-attribute-confirm">
                <span className="feature-attribute-key">Delete &quot;{key}&quot;?</span>
                <div className="feature-attribute-confirm-actions">
                  <button
                    type="button"
                    className="feature-attribute-confirm-delete"
                    disabled={saving}
                    onClick={() => handleDeleteColumn(key)}
                  >
                    Delete
                  </button>
                  {/* "Keep", not "Cancel": the footer already has a Cancel
                      (which exits edit mode entirely), and two buttons named
                      Cancel a few pixels apart doing different things is a
                      trap - in a popup this narrow especially. */}
                  <button type="button" disabled={saving} onClick={() => setPendingDelete(null)}>
                    Keep
                  </button>
                </div>
              </div>
            );
          }

          return (
            <div key={key} className="feature-attribute-row">
              <span className="feature-attribute-key">{key}</span>
              {editable ? (
                <>
                  <input
                    className="feature-attribute-input"
                    value={draft[key] ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                  />
                  {onDeleteColumn && (
                    <button
                      type="button"
                      className="feature-attribute-delete"
                      aria-label={`Delete column ${key}`}
                      title={`Delete column ${key}`}
                      onClick={() => {
                        setPendingFeatureDelete(false);
                        setPendingDelete(key);
                      }}
                    >
                      <Icon name="close" size={12} />
                    </button>
                  )}
                </>
              ) : (
                <span className="feature-attribute-value">{String(value)}</span>
              )}
            </div>
          );
        })}

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
            {/* Blank names were always silently ignored; with nothing
                disabled the button looked identically clickable either way,
                which read as broken rather than inert. */}
            <button
              type="button"
              disabled={!newFieldName.trim()}
              title={!newFieldName.trim() ? "Enter a column name first" : undefined}
              onClick={handleAddColumn}
            >
              + Add Column
            </button>
          </div>
        )}
      </div>

      <div className="feature-attributes-footer">
        {!canEdit && (
          <span className="feature-attributes-readonly-note">
            Read-only — sign in with an account that can edit this layer.
          </span>
        )}
        {canEdit && editMode && (
          <>
            <button type="button" disabled={saving} onClick={handleSave}>
              {saving ? "Saving..." : "Save"}
            </button>
            <button type="button" disabled={saving} onClick={cancelEdit}>
              Cancel
            </button>
            {/* Like the per-column confirmation, this replaces the control it
                belongs to rather than the whole footer, so Save/Cancel stay
                where the user left them. */}
            {onDeleteFeature && !pendingFeatureDelete && (
              <button
                type="button"
                className="feature-attributes-delete-feature"
                disabled={saving}
                onClick={() => {
                  // Only one confirmation is ever armed at a time, so two
                  // identical Delete/Keep pairs can't sit in the popup at once.
                  setPendingDelete(null);
                  setPendingFeatureDelete(true);
                }}
              >
                Delete Feature
              </button>
            )}
            {onDeleteFeature && pendingFeatureDelete && (
              <div className="feature-attributes-confirm-feature">
                <span>Delete this feature?</span>
                <div className="feature-attribute-confirm-actions">
                  <button
                    type="button"
                    className="feature-attribute-confirm-delete"
                    disabled={saving}
                    onClick={handleDeleteFeature}
                  >
                    Delete
                  </button>
                  {/* "Keep", not "Cancel", for the same reason the column
                      confirmation uses it: the footer's own Cancel exits
                      edit mode entirely. */}
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setPendingFeatureDelete(false)}
                  >
                    Keep
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {canEdit && !editMode && (
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
  onAddColumn: PropTypes.func,
  onDeleteColumn: PropTypes.func,
  onDeleteFeature: PropTypes.func,
  canEdit: PropTypes.bool
};
