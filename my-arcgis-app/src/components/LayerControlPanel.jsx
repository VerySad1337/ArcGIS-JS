import { useState } from "react";
import PropTypes from "prop-types";
import Icon from "./Icon";
import { FILTER_LOGIC, operatorsForKind } from "../gis/LayerFilterExpression";

const STATISTIC_OPTIONS = [
  { value: "sum", label: "Sum" },
  { value: "avg", label: "Average" },
  { value: "min", label: "Min" },
  { value: "max", label: "Max" }
];

function emptyCondition() {
  return { field: "", operator: "", value: "" };
}

// Filter & Aggregate controls live inline in each filterable layer's row,
// behind the same chevron that reveals styling controls, rather than in a
// separate "FILTER & AGGREGATE" card with its own layer checklist. Scoping
// to one layer at a time (opening that layer's row) replaces the previous
// multi-select-then-combine flow; there is deliberately no cross-layer
// combined total anymore - each row only ever shows its own count/stats.
export default function LayerControlPanel({
  layers,
  onToggle,
  onReorder,
  onStyleChange,
  onZoomToLayer,
  onRemove,
  heatIntensity,
  updateIntensity,
  onGetLayerFields,
  onApplyFilter,
  onClearFilter,
  onRunAggregate
}) {
  const [dragIndex, setDragIndex] = useState(null);
  const [expandedIds, setExpandedIds] = useState({});
  const [openSectionsById, setOpenSectionsById] = useState({});
  const [fieldsById, setFieldsById] = useState({});
  const [conditionsById, setConditionsById] = useState({});
  const [logicById, setLogicById] = useState({});
  const [applyingById, setApplyingById] = useState({});
  const [aggregateFieldById, setAggregateFieldById] = useState({});
  const [statisticsById, setStatisticsById] = useState({});
  const [aggregateResultsById, setAggregateResultsById] = useState({});
  const [runningById, setRunningById] = useState({});

  const visibleLayers = layers.filter(Boolean);

  const moveLayer = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= visibleLayers.length) return;
    onReorder(index, target);
  };

  const ensureFieldsLoaded = async (id) => {
    if (fieldsById[id]) return fieldsById[id];
    const schema = await onGetLayerFields(id);
    const fields = schema?.fields || [];
    setFieldsById((prev) => ({ ...prev, [id]: fields }));
    return fields;
  };

  const toggleExpanded = (layer, isFilterable) => {
    const opening = !expandedIds[layer.id];
    setExpandedIds((prev) => ({ ...prev, [layer.id]: !prev[layer.id] }));
    if (opening && isFilterable) {
      if (!fieldsById[layer.id]) ensureFieldsLoaded(layer.id);
      setConditionsById((prev) => (prev[layer.id] ? prev : { ...prev, [layer.id]: [emptyCondition()] }));
      setLogicById((prev) => (prev[layer.id] ? prev : { ...prev, [layer.id]: "AND" }));
    }
  };

  // Symbology/Filter/Aggregate are three independently-collapsible
  // sub-sections within a layer's expanded row, rather than all rendering
  // at once - a filterable+stylable layer would otherwise dump three
  // separate control blocks on the user simultaneously.
  const isSectionOpen = (layerId, section) => Boolean(openSectionsById[layerId]?.[section]);

  const toggleSection = (layerId, section) => {
    setOpenSectionsById((prev) => ({
      ...prev,
      [layerId]: { ...prev[layerId], [section]: !prev[layerId]?.[section] }
    }));
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
    setApplyingById((prev) => ({ ...prev, [id]: true }));
    try {
      await onApplyFilter(id, { conditions: conditionsById[id] || [], logic: logicById[id] || "AND" });
    } finally {
      setApplyingById((prev) => ({ ...prev, [id]: false }));
    }
  };

  const clearFilter = (id) => {
    setConditionsById((prev) => ({ ...prev, [id]: [emptyCondition()] }));
    onClearFilter(id);
  };

  const toggleStatistic = (id, stat) => {
    setStatisticsById((prev) => {
      const current = prev[id] || [];
      return { ...prev, [id]: current.includes(stat) ? current.filter((s) => s !== stat) : [...current, stat] };
    });
  };

  const runAggregate = async (id) => {
    setRunningById((prev) => ({ ...prev, [id]: true }));
    try {
      const result = await onRunAggregate([id], {
        field: (aggregateFieldById[id] || "").trim() || undefined,
        statistics: statisticsById[id] || []
      });
      setAggregateResultsById((prev) => ({ ...prev, [id]: result?.total || null }));
    } finally {
      setRunningById((prev) => ({ ...prev, [id]: false }));
    }
  };

  const formatStat = (value) => (typeof value === "number" ? Math.round(value * 100) / 100 : "—");

  return (
    <div className="panel-card">
      <div className="panel-title">LAYERS</div>

      {visibleLayers.length === 0 && (
        <p className="layer-empty-state">Layers will appear here once the map finishes loading.</p>
      )}

      {visibleLayers.length > 1 && (
        <p className="layer-order-note">
          Drag to reorder. The layer at the bottom of this list is drawn on top of the others on the map.
        </p>
      )}

      {visibleLayers.map((layer, index) => {
        const styleGroups = layer.styleGroups ?? [];
        const isStylable = styleGroups.length > 0;
        const isFilterable = Boolean(layer.filterable);
        const isExpandable = isStylable || isFilterable;
        const isExpanded = isExpandable && expandedIds[layer.id];
        const fields = fieldsById[layer.id] || [];
        const conditions = conditionsById[layer.id] || [emptyCondition()];
        const logic = logicById[layer.id] || "AND";
        const statistics = statisticsById[layer.id] || [];
        const aggregateField = aggregateFieldById[layer.id] || "";
        const aggregateResult = aggregateResultsById[layer.id];
        const numericFieldSuggestions = fields.filter((f) => f.kind === "number").map((f) => f.name);

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

            <span className="layer-name">
              {layer.name}
              {layer.filterDescription && (
                <span className="analysis-filter-badge" title={layer.filterDescription}>
                  filtered
                </span>
              )}
            </span>

            {/* Grouped so mobile CSS can drop these three onto their own
                right-aligned line — on a narrow drawer, keeping all six
                row controls on one line left ~50px for the name (forcing
                it to wrap to two lines) and squeezed the chevron off the
                edge. display:contents on desktop keeps this invisible to
                the flex layout there. */}
            <div className="layer-row-secondary">
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
                style={{ visibility: isExpandable ? "visible" : "hidden" }}
                disabled={!isExpandable}
                onClick={() => toggleExpanded(layer, isFilterable)}
                aria-label="Toggle layer styling and filter options"
              >
                <Icon name={isExpanded ? "chevronUp" : "chevronDown"} />
              </button>

              {layer.removable && (
                <button
                  type="button"
                  className="layer-remove-btn"
                  aria-label={`Remove ${layer.name}`}
                  onClick={() => onRemove(layer.id)}
                >
                  <Icon name="close" size={14} />
                </button>
              )}
            </div>
          </fieldset>

          {isExpanded && isStylable && (
            <div className="layer-section">
              <button
                type="button"
                className="layer-section-toggle"
                aria-expanded={isSectionOpen(layer.id, "symbology")}
                onClick={() => toggleSection(layer.id, "symbology")}
              >
                <Icon name={isSectionOpen(layer.id, "symbology") ? "chevronUp" : "chevronDown"} size={14} />
                <span>Symbology</span>
              </button>

              {isSectionOpen(layer.id, "symbology") && styleGroups.map((group) => {
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
            </div>
          )}

          {isExpanded && isFilterable && (
            <div className="layer-section">
              <button
                type="button"
                className="layer-section-toggle"
                aria-expanded={isSectionOpen(layer.id, "filter")}
                onClick={() => toggleSection(layer.id, "filter")}
              >
                <Icon name={isSectionOpen(layer.id, "filter") ? "chevronUp" : "chevronDown"} size={14} />
                <span>Filter</span>
              </button>

              {isSectionOpen(layer.id, "filter") && (
            <div className="layer-filter-controls">
              {layer.filterDescription && (
                <div className="analysis-active-filter">
                  <span>{layer.filterDescription}</span>
                  <button
                    type="button"
                    className="analysis-chip-clear"
                    onClick={() => clearFilter(layer.id)}
                    aria-label={`Clear filter on ${layer.name}`}
                  >
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
                      onChange={(e) => updateCondition(layer.id, index, { field: e.target.value })}
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
                      onChange={(e) => updateCondition(layer.id, index, { operator: e.target.value, value: "" })}
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
                        onChange={(e) => updateCondition(layer.id, index, { value: e.target.value })}
                        placeholder="Value"
                        aria-label="Value"
                      />
                    )}

                    <button
                      type="button"
                      className="analysis-condition-remove"
                      aria-label="Remove condition"
                      onClick={() => removeCondition(layer.id, index)}
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                );
              })}

              <div className="analysis-filter-actions">
                <button type="button" className="gis-button-secondary analysis-add-condition" onClick={() => addCondition(layer.id)}>
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
                        onClick={() => setLogicById((prev) => ({ ...prev, [layer.id]: op }))}
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
                  disabled={applyingById[layer.id]}
                  onClick={() => applyFilter(layer.id)}
                >
                  {applyingById[layer.id] ? "Applying…" : "Apply Filter"}
                </button>
                <button type="button" className="gis-button-secondary" onClick={() => clearFilter(layer.id)}>
                  Clear
                </button>
              </div>
            </div>
              )}
            </div>
          )}

          {isExpanded && isFilterable && (
            <div className="layer-section">
              <button
                type="button"
                className="layer-section-toggle"
                aria-expanded={isSectionOpen(layer.id, "aggregate")}
                onClick={() => toggleSection(layer.id, "aggregate")}
              >
                <Icon name={isSectionOpen(layer.id, "aggregate") ? "chevronUp" : "chevronDown"} size={14} />
                <span>Aggregate</span>
              </button>

              {isSectionOpen(layer.id, "aggregate") && (
            <div className="layer-filter-controls">
              <label className="analysis-aggregate-field">
                <span>Numeric field</span>
                <input
                  list={`layer-numeric-fields-${layer.id}`}
                  value={aggregateField}
                  onChange={(e) => setAggregateFieldById((prev) => ({ ...prev, [layer.id]: e.target.value }))}
                  placeholder="e.g. RATING"
                />
                <datalist id={`layer-numeric-fields-${layer.id}`}>
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
                      onChange={() => toggleStatistic(layer.id, s.value)}
                      disabled={!aggregateField.trim()}
                    />
                    <span>{s.label}</span>
                  </label>
                ))}
              </div>

              <button type="button" className="gis-button" disabled={runningById[layer.id]} onClick={() => runAggregate(layer.id)}>
                {runningById[layer.id] ? "Running…" : "Run Aggregate"}
              </button>

              {aggregateResult && (
                <div className="layer-aggregate-results">
                  <span>Count: {aggregateResult.count}</span>
                  {statistics.map((s) => (
                    <span key={s}>
                      {STATISTIC_OPTIONS.find((o) => o.value === s)?.label}: {formatStat(aggregateResult[s])}
                    </span>
                  ))}
                </div>
              )}
            </div>
              )}
            </div>
          )}

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
      styleGroups: PropTypes.array,
      removable: PropTypes.bool,
      filterable: PropTypes.bool,
      filterDescription: PropTypes.string
    })
  ).isRequired,
  onToggle: PropTypes.func.isRequired,
  onReorder: PropTypes.func.isRequired,
  onStyleChange: PropTypes.func.isRequired,
  onZoomToLayer: PropTypes.func.isRequired,
  onRemove: PropTypes.func,
  heatIntensity: PropTypes.number,
  updateIntensity: PropTypes.func,
  onGetLayerFields: PropTypes.func.isRequired,
  onApplyFilter: PropTypes.func.isRequired,
  onClearFilter: PropTypes.func.isRequired,
  onRunAggregate: PropTypes.func.isRequired
};
