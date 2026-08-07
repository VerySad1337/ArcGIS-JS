import { useState } from "react";
import PropTypes from "prop-types";
import Icon from "./Icon";
import { FILTER_LOGIC, operatorsForKind } from "../gis/LayerFilterExpression";

const MODES = [
  { value: "filter", label: "Filter" },
  { value: "aggregate", label: "Aggregate" },
  { value: "both", label: "Both" }
];

const STATISTIC_OPTIONS = [
  { value: "sum", label: "Sum" },
  { value: "avg", label: "Average" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" }
];

function emptyCondition() {
  return { field: "", operator: "", value: "" };
}

// Collapsed by default and placed below LayerControlPanel, the same
// occasional-action pattern PortalLayerPanel uses (see its own comment) -
// most sessions never touch filtering/aggregation, so it shouldn't push the
// always-relevant LAYERS panel further down the sidebar.
//
// "Filter" and "Aggregate" are one panel, not two, because the user picks
// which of the two (or both) they want per layer selection rather than the
// app assuming one implies the other - and because aggregate statistics are
// computed over whatever a layer's active filter leaves visible (see
// GISMapEngine.getLayerAggregate), so showing them side by side makes that
// composition visible instead of hiding it behind separate panels.
export default function AnalysisPanel({
  layers,
  onGetLayerFields,
  onApplyFilter,
  onClearFilter,
  onRunAnalysis
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState("filter");
  const [selectedIds, setSelectedIds] = useState([]);
  const [fieldsById, setFieldsById] = useState({});
  const [conditionsById, setConditionsById] = useState({});
  const [logicById, setLogicById] = useState({});
  const [applying, setApplying] = useState({});
  const [aggregateField, setAggregateField] = useState("");
  const [statistics, setStatistics] = useState([]);
  const [results, setResults] = useState(null);
  const [running, setRunning] = useState(false);

  const filterableLayers = layers.filter((l) => l?.filterable);

  const ensureFieldsLoaded = async (id) => {
    if (fieldsById[id]) return fieldsById[id];
    const schema = await onGetLayerFields(id);
    const fields = schema?.fields || [];
    setFieldsById((prev) => ({ ...prev, [id]: fields }));
    return fields;
  };

  const toggleLayerSelection = async (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    if (!fieldsById[id]) await ensureFieldsLoaded(id);
    setConditionsById((prev) => (prev[id] ? prev : { ...prev, [id]: [emptyCondition()] }));
    setLogicById((prev) => (prev[id] ? prev : { ...prev, [id]: "AND" }));
  };

  const updateCondition = (id, index, patch) => {
    setConditionsById((prev) => {
      const next = [...(prev[id] || [])];
      // Changing the field resets the operator/value - an operator valid for
      // the old field's kind (e.g. ">=" on a number) can be meaningless or
      // rejected outright for the new one (e.g. a string field).
      const merged = { ...next[index], ...patch };
      if (patch.field !== undefined) {
        merged.operator = "";
        merged.value = "";
      }
      next[index] = merged;
      return { ...prev, [id]: next };
    });
  };

  const addCondition = (id) => {
    setConditionsById((prev) => ({ ...prev, [id]: [...(prev[id] || []), emptyCondition()] }));
  };

  const removeCondition = (id, index) => {
    setConditionsById((prev) => {
      const next = (prev[id] || []).filter((_, i) => i !== index);
      return { ...prev, [id]: next.length ? next : [emptyCondition()] };
    });
  };

  const applyFilter = async (id) => {
    setApplying((prev) => ({ ...prev, [id]: true }));
    try {
      await onApplyFilter(id, { conditions: conditionsById[id] || [], logic: logicById[id] || "AND" });
    } finally {
      setApplying((prev) => ({ ...prev, [id]: false }));
    }
  };

  const clearFilter = (id) => {
    setConditionsById((prev) => ({ ...prev, [id]: [emptyCondition()] }));
    onClearFilter(id);
  };

  // The aggregate field is one shared name typed against all selected
  // layers at once (GISMapEngine.runAnalysis takes a single `field`) rather
  // than one picker per layer, since layers rarely share an identical
  // schema; the datalist below just offers spelling help from whichever
  // fields the selected layers actually have.
  const numericFieldSuggestions = Array.from(
    new Set(
      selectedIds.flatMap((id) => (fieldsById[id] || []).filter((f) => f.kind === "number").map((f) => f.name))
    )
  );

  const toggleStatistic = (stat) => {
    setStatistics((prev) => (prev.includes(stat) ? prev.filter((s) => s !== stat) : [...prev, stat]));
  };

  const runAnalysis = async () => {
    if (!selectedIds.length) return;
    setRunning(true);
    try {
      const result = await onRunAnalysis(selectedIds, {
        field: aggregateField.trim() || undefined,
        statistics
      });
      setResults(result);
    } finally {
      setRunning(false);
    }
  };

  const formatStat = (value) =>
    typeof value === "number" ? Math.round(value * 100) / 100 : "—";

  return (
    <div className="panel-card">
      <button
        type="button"
        className="panel-title panel-title-toggle"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
      >
        <span>FILTER &amp; AGGREGATE</span>
        <Icon name={isOpen ? "chevronUp" : "chevronDown"} />
      </button>

      {isOpen && (
        <>
          <div className="analysis-mode-bar" role="radiogroup" aria-label="Analysis mode">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                className={`analysis-mode-btn${mode === m.value ? " active" : ""}`}
                aria-pressed={mode === m.value}
                onClick={() => setMode(m.value)}
              >
                {m.label}
              </button>
            ))}
          </div>

          {filterableLayers.length === 0 && (
            <p className="layer-empty-state">Layers will appear here once the map finishes loading.</p>
          )}

          <div className="analysis-layer-picker">
            {filterableLayers.map((layer) => (
              <label key={layer.id} className="analysis-layer-checkbox">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(layer.id)}
                  onChange={() => toggleLayerSelection(layer.id)}
                />
                <span>{layer.name}</span>
                {layer.filterDescription && (
                  <span className="analysis-filter-badge" title={layer.filterDescription}>
                    filtered
                  </span>
                )}
              </label>
            ))}
          </div>

          {(mode === "filter" || mode === "both") &&
            selectedIds.map((id) => {
              const layer = filterableLayers.find((l) => l.id === id);
              const fields = fieldsById[id] || [];
              const conditions = conditionsById[id] || [emptyCondition()];
              const logic = logicById[id] || "AND";

              return (
                <fieldset key={id} className="analysis-filter-group">
                  <legend>{layer?.name || id}</legend>

                  {layer?.filterDescription && (
                    <div className="analysis-active-filter">
                      <span>{layer.filterDescription}</span>
                      <button type="button" className="analysis-chip-clear" onClick={() => clearFilter(id)} aria-label={`Clear filter on ${layer.name}`}>
                        <Icon name="close" size={12} />
                      </button>
                    </div>
                  )}

                  {conditions.map((condition, index) => {
                    const fieldMeta = fields.find((f) => f.name === condition.field);
                    const kind = fieldMeta?.kind;
                    const operators = kind ? operatorsForKind(kind) : [];
                    const selectedOperator = operators.find((o) => o.value === condition.operator);

                    return (
                      <div key={index} className="analysis-condition-row">
                        <select
                          value={condition.field}
                          onChange={(e) => updateCondition(id, index, { field: e.target.value })}
                          aria-label="Field"
                        >
                          <option value="">Field…</option>
                          {fields.map((f) => (
                            <option key={f.name} value={f.name}>
                              {f.name}
                            </option>
                          ))}
                        </select>

                        <select
                          value={condition.operator}
                          onChange={(e) => updateCondition(id, index, { operator: e.target.value, value: "" })}
                          disabled={!condition.field}
                          aria-label="Operator"
                        >
                          <option value="">Operator…</option>
                          {operators.map((op) => (
                            <option key={op.value} value={op.value}>
                              {op.label}
                            </option>
                          ))}
                        </select>

                        {selectedOperator && selectedOperator.arity > 0 && (
                          <input
                            type={kind === "number" ? "number" : kind === "date" ? "date" : "text"}
                            value={condition.value}
                            onChange={(e) => updateCondition(id, index, { value: e.target.value })}
                            placeholder="Value"
                            aria-label="Value"
                          />
                        )}

                        <button
                          type="button"
                          className="analysis-condition-remove"
                          aria-label="Remove condition"
                          onClick={() => removeCondition(id, index)}
                        >
                          <Icon name="close" size={12} />
                        </button>
                      </div>
                    );
                  })}

                  <div className="analysis-filter-actions">
                    <button type="button" className="gis-button-secondary analysis-add-condition" onClick={() => addCondition(id)}>
                      + Add condition
                    </button>

                    {conditions.length > 1 && (
                      <div className="analysis-logic-toggle" role="radiogroup" aria-label="Combine conditions with">
                        {FILTER_LOGIC.map((op) => (
                          <button
                            key={op}
                            type="button"
                            className={`analysis-logic-btn${logic === op ? " active" : ""}`}
                            aria-pressed={logic === op}
                            onClick={() => setLogicById((prev) => ({ ...prev, [id]: op }))}
                          >
                            {op}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="analysis-filter-buttons">
                    <button
                      type="button"
                      className="gis-button"
                      disabled={applying[id]}
                      onClick={() => applyFilter(id)}
                    >
                      {applying[id] ? "Applying…" : "Apply Filter"}
                    </button>
                    <button type="button" className="gis-button-secondary" onClick={() => clearFilter(id)}>
                      Clear
                    </button>
                  </div>
                </fieldset>
              );
            })}

          {(mode === "aggregate" || mode === "both") && selectedIds.length > 0 && (
            <div className="analysis-aggregate-group">
              <label className="analysis-aggregate-field">
                <span>Numeric field</span>
                <input
                  list="analysis-numeric-fields"
                  value={aggregateField}
                  onChange={(e) => setAggregateField(e.target.value)}
                  placeholder="e.g. RATING"
                />
                <datalist id="analysis-numeric-fields">
                  {numericFieldSuggestions.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </label>

              <div className="analysis-statistics">
                <span className="analysis-statistics-label">Count is always included.</span>
                {STATISTIC_OPTIONS.map((s) => (
                  <label key={s.value} className="analysis-statistic-checkbox">
                    <input
                      type="checkbox"
                      checked={statistics.includes(s.value)}
                      onChange={() => toggleStatistic(s.value)}
                      disabled={!aggregateField.trim()}
                    />
                    <span>{s.label}</span>
                  </label>
                ))}
              </div>

              <button type="button" className="gis-button" disabled={running} onClick={runAnalysis}>
                {running ? "Running…" : "Run Aggregate"}
              </button>

              {results && (
                <div className="analysis-results">
                  <table className="analysis-results-table">
                    <thead>
                      <tr>
                        <th>Layer</th>
                        <th>Count</th>
                        {statistics.map((s) => (
                          <th key={s}>{s}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {results.perLayer.map((row) => (
                        <tr key={row.id}>
                          <td>{row.name}</td>
                          <td>{row.count}</td>
                          {statistics.map((s) => (
                            <td key={s}>{formatStat(row.stats[s])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td>Total</td>
                        <td>{results.total.count}</td>
                        {statistics.map((s) => (
                          <td key={s}>{formatStat(results.total[s])}</td>
                        ))}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}

          {selectedIds.length === 0 && filterableLayers.length > 0 && (
            <p className="layer-empty-state">Select one or more layers above to filter or aggregate.</p>
          )}
        </>
      )}
    </div>
  );
}

AnalysisPanel.propTypes = {
  layers: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      name: PropTypes.string,
      filterable: PropTypes.bool,
      filterDescription: PropTypes.string
    })
  ).isRequired,
  onGetLayerFields: PropTypes.func.isRequired,
  onApplyFilter: PropTypes.func.isRequired,
  onClearFilter: PropTypes.func.isRequired,
  onRunAnalysis: PropTypes.func.isRequired
};
