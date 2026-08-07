// Pure (ArcGIS-free) logic for turning a user-built filter into something
// two very different layer types can both honour:
//
//   * `buildWhereClause` -> a SQL `where` string for FeatureLayer's
//     `definitionExpression` / `queryFeatures`.
//   * `matchesAttributes` -> the same predicate evaluated in JS, for the
//     local `drawings` GraphicsLayer, which has no backing service to push a
//     `where` clause to.
//
// Both are here, side by side and unit-testable without a map, specifically so
// the two evaluation paths cannot drift apart: a filter that reads "RATING >= 4"
// must mean the same thing whether it lands on a hosted service or on an
// in-memory graphic.
//
// SECURITY: `where` clauses are string-concatenated by definition - the ArcGIS
// REST query language has no parameterized-query facility (the same constraint
// GISMapEngine.searchHostedLayer already documents). Everything that reaches
// the clause is therefore constrained rather than escaped-and-hoped:
//   * field names must match a field on the target layer's own schema, AND
//     match a conservative identifier pattern;
//   * operators are looked up in a fixed table - the caller's token is never
//     interpolated, only the table's own `sql` fragment is;
//   * numeric values must pass Number.isFinite, date values must parse to a
//     real date, and string values are single-quote-escaped and quoted.
// A value that fails any of these throws instead of producing a clause.

// Field names come from a layer's advertised schema, but for a portal layer
// that schema is supplied by a third-party service we do not control, so the
// names are still treated as untrusted input before being interpolated.
const FIELD_NAME_PATTERN = /^[A-Za-z_]\w*$/;

// Normalizes the many esriFieldType* names down to the three kinds the filter
// UI actually needs to distinguish, so operator availability and value
// coercion can be decided from one small vocabulary.
export function normalizeFieldType(esriType) {
  const type = String(esriType || "").toLowerCase();

  if (type.includes("string") || type.includes("guid") || type.includes("xml")) return "string";
  if (
    type.includes("integer") ||
    type.includes("double") ||
    type.includes("single") ||
    type.includes("small") ||
    type.includes("number") ||
    type.includes("oid")
  ) {
    return "number";
  }
  if (type.includes("date") || type.includes("time")) return "date";

  return "other";
}

// arity 0 operators take no value input; `kinds` gates which field types offer
// the operator in the UI and is re-checked here so a hand-built request can't
// smuggle e.g. a `contains` onto a numeric field.
export const FILTER_OPERATORS = {
  "=":          { label: "is",              sql: "=",  arity: 1, kinds: ["string", "number", "date", "other"] },
  "<>":         { label: "is not",          sql: "<>", arity: 1, kinds: ["string", "number", "date", "other"] },
  ">":          { label: "greater than",    sql: ">",  arity: 1, kinds: ["number", "date"] },
  ">=":         { label: "at least",        sql: ">=", arity: 1, kinds: ["number", "date"] },
  "<":          { label: "less than",       sql: "<",  arity: 1, kinds: ["number", "date"] },
  "<=":         { label: "at most",         sql: "<=", arity: 1, kinds: ["number", "date"] },
  contains:     { label: "contains",        sql: "LIKE", arity: 1, kinds: ["string"], wrap: (v) => `%${v}%` },
  startsWith:   { label: "starts with",     sql: "LIKE", arity: 1, kinds: ["string"], wrap: (v) => `${v}%` },
  endsWith:     { label: "ends with",       sql: "LIKE", arity: 1, kinds: ["string"], wrap: (v) => `%${v}` },
  isNull:       { label: "is empty",        sql: "IS NULL",     arity: 0, kinds: ["string", "number", "date", "other"] },
  isNotNull:    { label: "is not empty",    sql: "IS NOT NULL", arity: 0, kinds: ["string", "number", "date", "other"] }
};

export const FILTER_LOGIC = ["AND", "OR"];

export function operatorsForKind(kind) {
  return Object.entries(FILTER_OPERATORS)
    .filter(([, meta]) => meta.kinds.includes(kind))
    .map(([value, meta]) => ({ value, label: meta.label, arity: meta.arity }));
}

// Doubling the single quote is the SQL-92 escape the ArcGIS query language
// uses; it is the same approach GISMapEngine.searchHostedLayer applies to its
// own generated clause.
function quoteString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`"${value}" is not a valid date.`);
  }
  // ArcGIS standardized SQL date literal. Only the date part is used: the
  // filter UI collects a date, not a timestamp.
  return `DATE '${date.toISOString().slice(0, 10)}'`;
}

function formatValue(kind, rawValue) {
  if (kind === "number") {
    const numeric = Number(rawValue);
    if (rawValue === "" || rawValue === null || rawValue === undefined || !Number.isFinite(numeric)) {
      throw new Error(`"${rawValue}" is not a valid number.`);
    }
    return String(numeric);
  }

  if (kind === "date") return formatDate(rawValue);

  return quoteString(rawValue);
}

function resolveField(fields, fieldName) {
  const field = (fields || []).find((f) => f.name === fieldName);
  if (!field) {
    throw new Error(`"${fieldName}" is not a field on this layer.`);
  }
  if (!FIELD_NAME_PATTERN.test(field.name)) {
    throw new Error(`Field "${field.name}" has a name this filter cannot safely query.`);
  }
  return field;
}

function resolveOperator(field, operatorToken) {
  const operator = Object.hasOwn(FILTER_OPERATORS, operatorToken)
    ? FILTER_OPERATORS[operatorToken]
    : null;

  if (!operator) throw new Error(`"${operatorToken}" is not a supported filter operator.`);
  if (!operator.kinds.includes(field.kind)) {
    throw new Error(`"${operator.label}" cannot be used on the ${field.kind} field "${field.name}".`);
  }
  return operator;
}

// Drops rows the user has started but not finished (a chosen field with no
// value yet), so a half-typed condition narrows nothing instead of erroring
// on every keystroke. Value-less operators (is empty / is not empty) are kept.
export function usableConditions(conditions) {
  return (conditions || []).filter((condition) => {
    if (!condition?.field || !condition?.operator) return false;
    // An operator token that isn't in the table at all is deliberately kept
    // here rather than dropped, so it reaches buildWhereClause/
    // matchesAttributes's resolveOperator and throws a clear error instead
    // of silently vanishing as if the condition were merely incomplete.
    const operator = Object.hasOwn(FILTER_OPERATORS, condition.operator)
      ? FILTER_OPERATORS[condition.operator]
      : null;
    if (operator?.arity !== 0) {
      return condition.value !== "" && condition.value !== null && condition.value !== undefined;
    }
    return true;
  });
}

/**
 * Builds a validated SQL `where` clause from a filter definition.
 *
 * @param {Array<{name: string, kind: string}>} fields the target layer's own schema
 * @param {{conditions: Array, logic: string}} filter
 * @returns {string|null} the clause, or null when nothing usable was supplied
 * @throws when a field, operator, or value fails validation
 */
export function buildWhereClause(fields, filter) {
  const conditions = usableConditions(filter?.conditions);
  if (!conditions.length) return null;

  const logic = FILTER_LOGIC.includes(filter?.logic) ? filter.logic : "AND";

  const clauses = conditions.map((condition) => {
    const field = resolveField(fields, condition.field);
    const operator = resolveOperator(field, condition.operator);

    if (operator.arity === 0) return `${field.name} ${operator.sql}`;

    const value = operator.wrap ? operator.wrap(condition.value) : condition.value;
    return `${field.name} ${operator.sql} ${formatValue(field.kind, value)}`;
  });

  return clauses.map((clause) => `(${clause})`).join(` ${logic} `);
}

function compareValues(kind, left, right) {
  if (kind === "number") return Number(left) - Number(right);
  if (kind === "date") return new Date(left).getTime() - new Date(right).getTime();
  return String(left).localeCompare(String(right));
}

function matchesCondition(attributes, fields, condition) {
  const field = resolveField(fields, condition.field);
  const operator = resolveOperator(field, condition.operator);
  const actual = attributes?.[field.name];

  if (operator.arity === 0) {
    const isEmpty = actual === null || actual === undefined || actual === "";
    return condition.operator === "isNull" ? isEmpty : !isEmpty;
  }

  if (actual === null || actual === undefined) return false;

  // Text predicates are case-insensitive here to match the LIKE/UPPER
  // behaviour users get on the hosted layers.
  const haystack = String(actual).toLowerCase();
  const needle = String(condition.value).toLowerCase();

  switch (condition.operator) {
    case "contains":   return haystack.includes(needle);
    case "startsWith": return haystack.startsWith(needle);
    case "endsWith":   return haystack.endsWith(needle);
    case "=":          return compareValues(field.kind, actual, condition.value) === 0;
    case "<>":         return compareValues(field.kind, actual, condition.value) !== 0;
    case ">":          return compareValues(field.kind, actual, condition.value) > 0;
    case ">=":         return compareValues(field.kind, actual, condition.value) >= 0;
    case "<":          return compareValues(field.kind, actual, condition.value) < 0;
    case "<=":         return compareValues(field.kind, actual, condition.value) <= 0;
    default:           return false;
  }
}

/**
 * Client-side equivalent of `buildWhereClause`, for the local drawings layer.
 * Returns true when no usable condition exists, so an empty filter shows
 * everything rather than hiding everything.
 */
export function matchesAttributes(attributes, fields, filter) {
  const conditions = usableConditions(filter?.conditions);
  if (!conditions.length) return true;

  const logic = FILTER_LOGIC.includes(filter?.logic) ? filter.logic : "AND";

  return logic === "AND"
    ? conditions.every((c) => matchesCondition(attributes, fields, c))
    : conditions.some((c) => matchesCondition(attributes, fields, c));
}

// Short human-readable rendering of an active filter, for the layer panel's
// badge tooltip and the analysis panel's active-filter list.
export function describeFilter(filter) {
  const conditions = usableConditions(filter?.conditions);
  if (!conditions.length) return "";

  const logic = FILTER_LOGIC.includes(filter?.logic) ? filter.logic : "AND";

  return conditions
    .map((c) => {
      const label = FILTER_OPERATORS[c.operator]?.label ?? c.operator;
      return FILTER_OPERATORS[c.operator]?.arity === 0
        ? `${c.field} ${label}`
        : `${c.field} ${label} ${c.value}`;
    })
    .join(` ${logic} `);
}
