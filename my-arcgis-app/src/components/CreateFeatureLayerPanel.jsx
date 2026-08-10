import { memo, useRef, useState } from "react";
import PropTypes from "prop-types";
import Icon from "./Icon";

const FIELD_TYPE_OPTIONS = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" }
];

// Split out of PortalLayerPanel into its own top-level card (2026-08):
// creating a brand-new hosted feature layer isn't really "adding from
// portal" - it happened to live nested two levels deep (behind both "ADD
// LAYER FROM PORTAL"'s own collapse and its own inner chevron) purely
// because it reused the same onCreateLayer plumbing. Collapsed by default,
// same reasoning as PortalLayerPanel - creating a layer is an occasional
// action, not something every session needs.
function CreateFeatureLayerPanel({ onCreateLayer, signedInUser }) {
  const [isOpen, setIsOpen] = useState(false);
  const [layerName, setLayerName] = useState("");
  const [geometryType, setGeometryType] = useState("point");
  const [fields, setFields] = useState([]);
  const [creatingLayer, setCreatingLayer] = useState(false);
  const fieldIdRef = useRef(0);

  const addFieldRow = () => {
    setFields((prev) => [...prev, { id: ++fieldIdRef.current, name: "", type: "text" }]);
  };

  const updateFieldRow = (id, change) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...change } : f)));
  };

  const removeFieldRow = (id) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
  };

  const handleCreateLayer = async (e) => {
    e.preventDefault();
    const name = layerName.trim();
    if (!name || creatingLayer) return;

    setCreatingLayer(true);
    try {
      await onCreateLayer({
        name,
        geometryType,
        fields: fields.filter((f) => f.name.trim()).map((f) => ({ name: f.name.trim(), type: f.type }))
      });
      setLayerName("");
      setGeometryType("point");
      setFields([]);
    } finally {
      setCreatingLayer(false);
    }
  };

  return (
    <div className="panel-card">
      <button
        type="button"
        className="panel-title panel-title-toggle"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
      >
        <span>CREATE FEATURE LAYER</span>
        <Icon name={isOpen ? "chevronUp" : "chevronDown"} />
      </button>

      {isOpen && (
        <div className="analysis-tool-section">
          {!signedInUser ? (
            <p className="analysis-tool-hint">
              Sign in with an ArcGIS account to create a new hosted feature layer.
            </p>
          ) : (
            <form onSubmit={handleCreateLayer}>
              <label className="analysis-aggregate-field">
                <span>Name</span>
                <input
                  type="text"
                  value={layerName}
                  onChange={(e) => setLayerName(e.target.value)}
                  placeholder="e.g. Site Inspections"
                  aria-label="New feature layer name"
                />
              </label>

              <label className="analysis-aggregate-field">
                <span>Geometry type</span>
                <select
                  value={geometryType}
                  onChange={(e) => setGeometryType(e.target.value)}
                  aria-label="New feature layer geometry type"
                >
                  <option value="point">Point</option>
                  <option value="polyline">Line</option>
                  <option value="polygon">Polygon</option>
                </select>
              </label>

              {fields.map((field, index) => (
                <div key={field.id} className="portal-field-row">
                  <input
                    type="text"
                    value={field.name}
                    onChange={(e) => updateFieldRow(field.id, { name: e.target.value })}
                    placeholder="Field name"
                    aria-label={`Field ${index + 1} name`}
                  />
                  <select
                    value={field.type}
                    onChange={(e) => updateFieldRow(field.id, { type: e.target.value })}
                    aria-label={`Field ${index + 1} type`}
                  >
                    {FIELD_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="gis-button-secondary portal-field-remove-btn"
                    aria-label={`Remove field ${index + 1}`}
                    onClick={() => removeFieldRow(field.id)}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ))}

              <button type="button" className="gis-button-secondary" onClick={addFieldRow}>
                + Add field
              </button>

              <button
                type="submit"
                className="gis-button"
                disabled={!layerName.trim() || creatingLayer}
              >
                {creatingLayer ? "Creating…" : "Create Layer"}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

CreateFeatureLayerPanel.propTypes = {
  onCreateLayer: PropTypes.func.isRequired,
  signedInUser: PropTypes.shape({
    username: PropTypes.string,
    fullName: PropTypes.string,
    orgId: PropTypes.string,
    thumbnailUrl: PropTypes.string
  })
};

// Memoized: ApplicationShell re-renders on any of its own state changes
// (toast, sidebar, draw state, layer refresh). Every prop this component
// receives from there is either a primitive or a useCallback/useMemo-stabilized
// value, so memo lets those unrelated re-renders stop at this boundary.
export default memo(CreateFeatureLayerPanel);
