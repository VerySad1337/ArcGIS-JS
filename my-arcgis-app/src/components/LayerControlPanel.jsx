import { useRef, useState } from "react";
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

// A layer's position after removing `removedIndex` from the array it came
// from - splice(from, 1) shifts everything after `removedIndex` down by
// one, so a neighbor's post-removal index differs from its original index
// whenever the neighbor sat after the removed item.
function indexAfterRemoval(originalIndex, removedIndex) {
  return originalIndex < removedIndex ? originalIndex : originalIndex - 1;
}

// Moves each id in `blockIds` (processed in their given order) to sit
// immediately after `anchorId`, chaining the anchor forward to the
// just-moved id each time so the block's members end up contiguous and in
// their original relative order. Mutates `workingIds` in place and returns
// the sequence of [from, to] index pairs that reproduces the same result
// via repeated single-item onReorder(from, to) calls.
function moveBlockAfter(workingIds, blockIds, anchorId) {
  const moves = [];
  let anchor = anchorId;
  for (const id of blockIds) {
    const fromIndex = workingIds.indexOf(id);
    const anchorIndex = workingIds.indexOf(anchor);
    const toIndex = indexAfterRemoval(anchorIndex, fromIndex) + 1;
    if (toIndex !== fromIndex) {
      moves.push([fromIndex, toIndex]);
      const [moved] = workingIds.splice(fromIndex, 1);
      workingIds.splice(toIndex, 0, moved);
    }
    anchor = id;
  }
  return moves;
}

// Swaps two currently-adjacent blocks (firstBlockIds directly followed by
// secondBlockIds) so the order becomes [...secondBlockIds, ...firstBlockIds]
// - implemented as moving firstBlockIds to after secondBlockIds' last id.
function swapAdjacentBlocks(workingIds, firstBlockIds, secondBlockIds) {
  return moveBlockAfter(workingIds, firstBlockIds, secondBlockIds[secondBlockIds.length - 1]);
}

// Mirror of moveBlockAfter: moves each id in `blockIds` to sit immediately
// before `anchorId`. Processes in reverse order (last id first) so each
// earlier id lands just before the one already placed, keeping the block's
// original relative order intact - unlike moveBlockAfter, this needs no
// special case for "anchor is the very first item", which is exactly why
// drag-and-drop (which can target any block, including the first one) uses
// this instead of chaining moveBlockAfter with a "preceding id" lookup.
function moveBlockBefore(workingIds, blockIds, anchorId) {
  const moves = [];
  let anchor = anchorId;
  for (let i = blockIds.length - 1; i >= 0; i--) {
    const id = blockIds[i];
    const fromIndex = workingIds.indexOf(id);
    const anchorIndex = workingIds.indexOf(anchor);
    const toIndex = indexAfterRemoval(anchorIndex, fromIndex);
    if (toIndex !== fromIndex) {
      moves.push([fromIndex, toIndex]);
      const [moved] = workingIds.splice(fromIndex, 1);
      workingIds.splice(toIndex, 0, moved);
    }
    anchor = id;
  }
  return moves;
}

// Groups are a session-only, purely client-side way to organize the layer
// list (no engine/persistence changes) - see knowledge/index.md's Layer
// Grouping System. Assigning a layer to a group DOES move it in the real
// map draw order (via the existing onReorder -> engine.reorderLayers path)
// so a group's members end up contiguous; removing a layer from a group
// leaves it wherever it currently sits. Rendering doesn't assume strict
// contiguity, though - a group always renders as one block at the position
// of its first-seen member, so a stray drag-and-drop that splits a group's
// members apart in the underlying order still displays sensibly.
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
  const [dragBlockIndex, setDragBlockIndex] = useState(null);
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
  const [groups, setGroups] = useState([]);
  const [groupByLayerId, setGroupByLayerId] = useState({});
  const [groupOpenById, setGroupOpenById] = useState({});
  const [newGroupName, setNewGroupName] = useState("");
  const nextGroupId = useRef(0);

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

  const addGroup = () => {
    const name = newGroupName.trim();
    if (!name) return;
    nextGroupId.current += 1;
    const id = `group-${nextGroupId.current}`;
    setGroups((prev) => [...prev, { id, name }]);
    setGroupOpenById((prev) => ({ ...prev, [id]: true }));
    setNewGroupName("");
  };

  const deleteGroup = (groupId) => {
    setGroups((prev) => prev.filter((g) => g.id !== groupId));
    setGroupByLayerId((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((layerId) => {
        if (next[layerId] === groupId) delete next[layerId];
      });
      return next;
    });
    setGroupOpenById((prev) => {
      const next = { ...prev };
      delete next[groupId];
      return next;
    });
  };

  const toggleGroupOpen = (groupId) => {
    setGroupOpenById((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  // Assigning a layer into a group moves it (in the real map draw order)
  // to sit right after that group's other members, so the group ends up
  // contiguous in layerOrder. The first layer assigned to a brand-new group
  // has no existing members to move next to, so it simply anchors the
  // group at its current position. Ungrouping never reorders - the layer
  // just stops being visually clustered.
  const assignLayerGroup = (layer, index, groupId) => {
    setGroupByLayerId((prev) => {
      const next = { ...prev };
      if (groupId) next[layer.id] = groupId;
      else delete next[layer.id];
      return next;
    });

    if (!groupId) return;

    const memberIndices = visibleLayers
      .map((l, i) => (l.id !== layer.id && groupByLayerId[l.id] === groupId ? i : -1))
      .filter((i) => i !== -1);

    if (memberIndices.length === 0) return;

    const lastMemberIndex = Math.max(...memberIndices);
    const target = indexAfterRemoval(lastMemberIndex, index) + 1;
    if (target !== index) onReorder(index, target);
  };

  // Two-pass grouping: walk the flat, real-draw-order list once and place
  // each layer either directly (ungrouped) or as part of its group's block
  // rendered at the position of its first-seen member. A group's later
  // members are absorbed into that same block instead of rendered again at
  // their own position. A brand-new, still-empty group is appended at the
  // end since the pass never encounters a layer that references it.
  const buildBlocks = () => {
    const blocks = [];
    const placedGroupIds = new Set();
    visibleLayers.forEach((layer, index) => {
      const groupId = groupByLayerId[layer.id];
      const group = groupId ? groups.find((g) => g.id === groupId) : null;
      if (group) {
        if (placedGroupIds.has(group.id)) return;
        placedGroupIds.add(group.id);
        const members = visibleLayers
          .map((l, i) => ({ layer: l, index: i }))
          .filter(({ layer: l }) => groupByLayerId[l.id] === group.id);
        blocks.push({ type: "group", group, members });
      } else {
        blocks.push({ type: "layer", layer, index });
      }
    });
    groups.forEach((group) => {
      if (!placedGroupIds.has(group.id)) {
        blocks.push({ type: "group", group, members: [] });
      }
    });
    return blocks;
  };

  const blockIds = (block) => (block.type === "group" ? block.members.map((m) => m.layer.id) : [block.layer.id]);

  // Moves a whole group up/down as a single unit, swapping it with whichever
  // adjacent block (a lone layer or another group) currently sits next to
  // it - the same "change sequence" affordance individual layers already
  // have via their up/down buttons, just operating on every member of the
  // group at once so the group stays together.
  const moveGroup = (groupId, direction) => {
    const blocks = buildBlocks();
    const blockIndex = blocks.findIndex((b) => b.type === "group" && b.group.id === groupId);
    const targetBlockIndex = blockIndex + direction;
    if (blockIndex === -1 || targetBlockIndex < 0 || targetBlockIndex >= blocks.length) return;

    const firstIdx = Math.min(blockIndex, targetBlockIndex);
    const secondIdx = Math.max(blockIndex, targetBlockIndex);
    const workingIds = visibleLayers.map((l) => l.id);
    const moves = swapAdjacentBlocks(workingIds, blockIds(blocks[firstIdx]), blockIds(blocks[secondIdx]));
    moves.forEach(([from, to]) => onReorder(from, to));
  };

  // Drag-and-drop for a group: unlike moveGroup above (an adjacent-only
  // swap for the up/down buttons), a drop target can be any other block -
  // possibly several positions away - so this moves the whole source block
  // to sit directly against the target block, on whichever side the drag
  // came from (after the target if dropped further down the list, before
  // it if dropped further up), same as how dropping a single layer row
  // already behaves via onReorder(dragIndex, index).
  const moveBlockToBlock = (sourceBlockIndex, targetBlockIndex) => {
    if (sourceBlockIndex === targetBlockIndex) return;
    const blocks = buildBlocks();
    const sourceIds = blockIds(blocks[sourceBlockIndex]);
    const targetIds = blockIds(blocks[targetBlockIndex]);
    const workingIds = visibleLayers.map((l) => l.id);
    const moves = targetBlockIndex > sourceBlockIndex
      ? moveBlockAfter(workingIds, sourceIds, targetIds[targetIds.length - 1])
      : moveBlockBefore(workingIds, sourceIds, targetIds[0]);
    moves.forEach(([from, to]) => onReorder(from, to));
  };

  // Mass visibility control: if any member is currently visible, hide every
  // member; otherwise show every member. Only calls onToggle (a bare flip)
  // for layers that actually need to change state, so a mixed group doesn't
  // double-toggle an already-correct layer. Toggling the group never
  // prevents toggling an individual member afterward - each row's own eye
  // button is untouched by this.
  const toggleGroupVisibility = (members) => {
    const nextVisible = !members.some(({ layer }) => layer.visible);
    members.forEach(({ layer }) => {
      if (layer.visible !== nextVisible) onToggle(layer.id);
    });
  };

  const renderLayerRow = (layer, index, topLevelBlockIndex) => {
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
            // This row only carries topLevelBlockIndex when it's rendered
            // at the top level, not when it's a member row nested inside an
            // open group's body - there, this branch intentionally does
            // nothing itself and leaves dragBlockIndex untouched, letting
            // the native drop event bubble up to the enclosing .layer-group
            // container's own onDrop (see below), so dropping anywhere
            // within another group's card - including on one of its member
            // rows - moves the dragged group there, the same as dropping
            // directly on that group's header would.
            if (dragBlockIndex !== null) {
              if (topLevelBlockIndex === undefined) return;
              moveBlockToBlock(dragBlockIndex, topLevelBlockIndex);
              setDragBlockIndex(null);
              return;
            }
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
            onDragStart={() => {
              setDragIndex(index);
              setDragBlockIndex(null);
            }}
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

          {/* Grouped so mobile CSS can drop these onto their own
              right-aligned line — on a narrow drawer, keeping every row
              control on one line left too little room for the name
              (forcing it to wrap to two lines). display:contents on
              desktop keeps this invisible to the flex layout there. */}
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

        {/* Its own line below the row, not a flex item competing with the
            eye/drag/zoom/reorder/chevron icons on one line - the row was
            already tight with five icon-sized controls, and a <select>
            can't shrink to nothing without either clipping its text or
            crushing .layer-name (which has no width floor of its own) down
            to a sliver. See knowledge/index.md's Layer Grouping System. */}
        {groups.length > 0 && (
          <div className="layer-group-picker">
            <label>
              <span>Group</span>
              <select
                className="layer-group-select"
                aria-label={`Group ${layer.name}`}
                value={groupByLayerId[layer.id] || ""}
                onChange={(e) => assignLayerGroup(layer, index, e.target.value || null)}
              >
                <option value="">Ungrouped</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

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

                {conditions.map((condition, conditionIndex) => {
                  const fieldMeta = fields.find((f) => f.name === condition.field);
                  const kind = fieldMeta?.kind;
                  const operators = kind ? operatorsForKind(kind) : [];
                  const selectedOperator = operators.find((o) => o.value === condition.operator);

                  return (
                    <div key={conditionIndex} className="analysis-condition-row">
                      <select
                        value={condition.field}
                        onChange={(e) => updateCondition(layer.id, conditionIndex, { field: e.target.value })}
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
                        onChange={(e) =>
                          updateCondition(layer.id, conditionIndex, { operator: e.target.value, value: "" })
                        }
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
                          onChange={(e) => updateCondition(layer.id, conditionIndex, { value: e.target.value })}
                          placeholder="Value"
                          aria-label="Value"
                        />
                      )}

                      <button
                        type="button"
                        className="analysis-condition-remove"
                        aria-label="Remove condition"
                        onClick={() => removeCondition(layer.id, conditionIndex)}
                      >
                        <Icon name="close" size={12} />
                      </button>
                    </div>
                  );
                })}

                <div className="analysis-filter-actions">
                  <button
                    type="button"
                    className="gis-button-secondary analysis-add-condition"
                    onClick={() => addCondition(layer.id)}
                  >
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

                <button
                  type="button"
                  className="gis-button"
                  disabled={runningById[layer.id]}
                  onClick={() => runAggregate(layer.id)}
                >
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
  };

  const blocks = buildBlocks();

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

      {visibleLayers.length > 0 && (
        <form
          className="layer-group-form"
          onSubmit={(e) => {
            e.preventDefault();
            addGroup();
          }}
        >
          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="New group name"
            aria-label="New group name"
          />
          <button type="submit" className="gis-button-secondary" disabled={!newGroupName.trim()}>
            + Add Group
          </button>
        </form>
      )}

      {blocks.map((block, blockIndex) =>
        block.type === "layer" ? (
          renderLayerRow(block.layer, block.index, blockIndex)
        ) : (
          <div
            key={block.group.id}
            className="layer-group"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragBlockIndex === null || dragBlockIndex === blockIndex) return;
              moveBlockToBlock(dragBlockIndex, blockIndex);
              setDragBlockIndex(null);
            }}
          >
            <div className="layer-group-header">
              <button
                type="button"
                className="drag-handle"
                draggable
                aria-label={`Drag to reorder group ${block.group.name}, or use the move up/down buttons`}
                onDragStart={() => {
                  setDragBlockIndex(blockIndex);
                  setDragIndex(null);
                }}
                onDragEnd={() => setDragBlockIndex(null)}
              >
                <Icon name="drag" />
              </button>

              <button
                type="button"
                className="layer-group-eye-btn"
                aria-label={
                  block.members.some((m) => m.layer.visible)
                    ? `Hide all layers in ${block.group.name}`
                    : `Show all layers in ${block.group.name}`
                }
                disabled={block.members.length === 0}
                onClick={() => toggleGroupVisibility(block.members)}
              >
                <Icon name={block.members.some((m) => m.layer.visible) ? "eye" : "eyeOff"} />
              </button>

              <button
                type="button"
                className="layer-group-toggle"
                aria-expanded={Boolean(groupOpenById[block.group.id])}
                onClick={() => toggleGroupOpen(block.group.id)}
              >
                <Icon name={groupOpenById[block.group.id] ? "chevronUp" : "chevronDown"} size={14} />
                <span>{block.group.name}</span>
                <span className="layer-group-count">({block.members.length})</span>
              </button>

              <div className="layer-reorder-btns">
                <button
                  type="button"
                  className="layer-reorder-btn"
                  aria-label={`Move group ${block.group.name} up`}
                  disabled={blockIndex === 0}
                  onClick={() => moveGroup(block.group.id, -1)}
                >
                  <Icon name="arrowUp" />
                </button>
                <button
                  type="button"
                  className="layer-reorder-btn"
                  aria-label={`Move group ${block.group.name} down`}
                  disabled={blockIndex === blocks.length - 1}
                  onClick={() => moveGroup(block.group.id, 1)}
                >
                  <Icon name="arrowDown" />
                </button>
              </div>

              <button
                type="button"
                className="layer-group-delete"
                aria-label={`Delete group ${block.group.name}`}
                onClick={() => deleteGroup(block.group.id)}
              >
                <Icon name="close" size={12} />
              </button>
            </div>

            {groupOpenById[block.group.id] && (
              <div className="layer-group-body">
                {block.members.map(({ layer: l, index: i }) => renderLayerRow(l, i))}
              </div>
            )}
          </div>
        )
      )}
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
