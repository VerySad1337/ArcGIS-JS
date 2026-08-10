import { useRef, useState } from "react";
import PropTypes from "prop-types";
import Icon from "./Icon";

const FIELD_TYPE_OPTIONS = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" }
];

// Collapsed by default: searching the portal is an occasional action, not
// something every session needs, and it shouldn't push the always-relevant
// LAYERS panel further down the sidebar. Mirrors LayerControlPanel's
// per-row chevron-collapse pattern.
export default function PortalLayerPanel({
  onSearch,
  onAddLayer,
  onCreateLayer,
  signedInUser
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const requestIdRef = useRef(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [layerName, setLayerName] = useState("");
  const [geometryType, setGeometryType] = useState("point");
  const [fields, setFields] = useState([]);
  const [creatingLayer, setCreatingLayer] = useState(false);
  const fieldIdRef = useRef(0);

  const runSearch = async (e) => {
    e.preventDefault();
    const text = query.trim();
    if (!text) return;

    const requestId = ++requestIdRef.current;
    setSearching(true);
    try {
      const found = await onSearch(text);
      if (requestId !== requestIdRef.current) return;
      setResults(found || []);
      setSearched(true);
    } finally {
      if (requestId === requestIdRef.current) setSearching(false);
    }
  };

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
        <span>ADD LAYER FROM PORTAL</span>
        <Icon name={isOpen ? "chevronUp" : "chevronDown"} />
      </button>

      {isOpen && (
        <>
          <form className="global-search-form" onSubmit={runSearch}>
            <div className="global-search-input-wrap">
              <Icon name="search" size={16} className="global-search-icon" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search ArcGIS portal feature layers"
                aria-label="Search ArcGIS portal feature layers"
              />
            </div>
            <button type="submit" className="gis-button" disabled={searching || !query.trim()}>
              {searching ? "Searching…" : "Search"}
            </button>
          </form>

          {searched && !searching && results.length === 0 && (
            <p className="layer-empty-state">No portal layers found for that search.</p>
          )}

          {results.length > 0 && (
            <ul className="portal-search-results">
              {results.map((item) => (
                <li key={item.id} className="portal-search-result">
                  <span className="portal-result-title" title={item.snippet || item.title}>
                    {item.title}
                  </span>
                  <button
                    type="button"
                    className="gis-button-secondary portal-result-add-btn"
                    onClick={() => onAddLayer(item)}
                  >
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="layer-section">
            <button
              type="button"
              className="layer-section-toggle"
              aria-expanded={createOpen}
              onClick={() => setCreateOpen((open) => !open)}
            >
              <Icon name={createOpen ? "chevronUp" : "chevronDown"} size={14} />
              <span>Create Feature Layer</span>
            </button>

            {createOpen && (
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
        </>
      )}
    </div>
  );
}

PortalLayerPanel.propTypes = {
  onSearch: PropTypes.func.isRequired,
  onAddLayer: PropTypes.func.isRequired,
  onCreateLayer: PropTypes.func.isRequired,
  signedInUser: PropTypes.shape({
    username: PropTypes.string,
    fullName: PropTypes.string,
    orgId: PropTypes.string,
    thumbnailUrl: PropTypes.string
  })
};
