import {
  normalizeFieldType,
  operatorsForKind,
  usableConditions,
  buildWhereClause,
  matchesAttributes,
  describeFilter,
  FILTER_OPERATORS
} from "./LayerFilterExpression";

const FIELDS = [
  { name: "NAME", kind: "string" },
  { name: "RATING", kind: "number" },
  { name: "OPENED", kind: "date" }
];

describe("normalizeFieldType", () => {
  test("maps esriFieldType* names to the reduced string/number/date/other vocabulary", () => {
    expect(normalizeFieldType("esriFieldTypeString")).toBe("string");
    expect(normalizeFieldType("esriFieldTypeGUID")).toBe("string");
    expect(normalizeFieldType("esriFieldTypeInteger")).toBe("number");
    expect(normalizeFieldType("esriFieldTypeDouble")).toBe("number");
    expect(normalizeFieldType("esriFieldTypeSmallInteger")).toBe("number");
    expect(normalizeFieldType("esriFieldTypeDate")).toBe("date");
    expect(normalizeFieldType("esriFieldTypeBlob")).toBe("other");
    expect(normalizeFieldType(undefined)).toBe("other");
  });
});

describe("operatorsForKind", () => {
  test("only offers comparison operators for number/date, not string", () => {
    const stringOps = operatorsForKind("string").map((o) => o.value);
    const numberOps = operatorsForKind("number").map((o) => o.value);

    expect(stringOps).toContain("contains");
    expect(stringOps).not.toContain(">");
    expect(numberOps).toContain(">");
    expect(numberOps).not.toContain("contains");
    expect(numberOps).toContain("isNull");
  });
});

describe("usableConditions", () => {
  test("drops conditions with no field/operator, or a missing value on a valued operator", () => {
    const conditions = [
      { field: "", operator: "=", value: "x" },
      { field: "NAME", operator: "", value: "x" },
      { field: "NAME", operator: "=", value: "" },
      { field: "NAME", operator: "=", value: "ok" },
      { field: "NAME", operator: "isNull", value: "" }
    ];
    expect(usableConditions(conditions)).toEqual([
      { field: "NAME", operator: "=", value: "ok" },
      { field: "NAME", operator: "isNull", value: "" }
    ]);
  });

  test("handles a null/undefined conditions array", () => {
    expect(usableConditions(undefined)).toEqual([]);
    expect(usableConditions(null)).toEqual([]);
  });
});

describe("buildWhereClause", () => {
  test("returns null when there are no usable conditions", () => {
    expect(buildWhereClause(FIELDS, { conditions: [], logic: "AND" })).toBeNull();
    expect(buildWhereClause(FIELDS, undefined)).toBeNull();
  });

  test("builds a single numeric comparison clause", () => {
    const where = buildWhereClause(FIELDS, {
      conditions: [{ field: "RATING", operator: ">=", value: "4" }],
      logic: "AND"
    });
    expect(where).toBe("(RATING >= 4)");
  });

  test("joins multiple conditions with the given logic operator", () => {
    const where = buildWhereClause(FIELDS, {
      conditions: [
        { field: "RATING", operator: ">=", value: "4" },
        { field: "NAME", operator: "contains", value: "park" }
      ],
      logic: "OR"
    });
    expect(where).toBe("(RATING >= 4) OR (NAME LIKE '%park%')");
  });

  test("escapes single quotes in string values", () => {
    const where = buildWhereClause(FIELDS, {
      conditions: [{ field: "NAME", operator: "=", value: "O'Brien" }],
      logic: "AND"
    });
    expect(where).toBe("(NAME = 'O''Brien')");
  });

  test("wraps contains/startsWith/endsWith with % before quoting", () => {
    expect(
      buildWhereClause(FIELDS, { conditions: [{ field: "NAME", operator: "startsWith", value: "Mar" }] })
    ).toBe("(NAME LIKE 'Mar%')");
    expect(
      buildWhereClause(FIELDS, { conditions: [{ field: "NAME", operator: "endsWith", value: "ina" }] })
    ).toBe("(NAME LIKE '%ina')");
  });

  test("builds a DATE literal for date fields", () => {
    const where = buildWhereClause(FIELDS, {
      conditions: [{ field: "OPENED", operator: ">", value: "2024-01-15" }]
    });
    expect(where).toBe("(OPENED > DATE '2024-01-15')");
  });

  test("builds an IS NULL / IS NOT NULL clause with no value", () => {
    expect(
      buildWhereClause(FIELDS, { conditions: [{ field: "NAME", operator: "isNull" }] })
    ).toBe("(NAME IS NULL)");
    expect(
      buildWhereClause(FIELDS, { conditions: [{ field: "NAME", operator: "isNotNull" }] })
    ).toBe("(NAME IS NOT NULL)");
  });

  test("throws for a field not present on the layer's schema", () => {
    expect(() =>
      buildWhereClause(FIELDS, { conditions: [{ field: "NOPE", operator: "=", value: "x" }] })
    ).toThrow(/not a field/);
  });

  test("throws for an operator not valid for the field's kind", () => {
    expect(() =>
      buildWhereClause(FIELDS, { conditions: [{ field: "NAME", operator: ">", value: "x" }] })
    ).toThrow(/cannot be used/);
  });

  test("throws for an unrecognized operator token", () => {
    expect(() =>
      buildWhereClause(FIELDS, { conditions: [{ field: "NAME", operator: "; DROP TABLE", value: "x" }] })
    ).toThrow(/not a supported filter operator/);
  });

  test("throws for a non-numeric value on a number field", () => {
    expect(() =>
      buildWhereClause(FIELDS, { conditions: [{ field: "RATING", operator: "=", value: "abc" }] })
    ).toThrow(/not a valid number/);
  });

  test("throws for an unparseable date", () => {
    expect(() =>
      buildWhereClause(FIELDS, { conditions: [{ field: "OPENED", operator: "=", value: "not-a-date" }] })
    ).toThrow(/not a valid date/);
  });

  test("rejects a field whose name fails the safe-identifier pattern, even if a caller injects it", () => {
    const maliciousFields = [{ name: "RATING; DROP TABLE X;--", kind: "number" }];
    expect(() =>
      buildWhereClause(maliciousFields, {
        conditions: [{ field: "RATING; DROP TABLE X;--", operator: "=", value: "1" }]
      })
    ).toThrow(/cannot safely query/);
  });
});

describe("FILTER_OPERATORS coverage sanity", () => {
  test("every operator declares kinds and arity", () => {
    Object.values(FILTER_OPERATORS).forEach((op) => {
      expect(Array.isArray(op.kinds)).toBe(true);
      expect([0, 1]).toContain(op.arity);
    });
  });
});

describe("matchesAttributes", () => {
  test("returns true (show everything) when there are no usable conditions", () => {
    expect(matchesAttributes({ NAME: "x" }, FIELDS, { conditions: [], logic: "AND" })).toBe(true);
  });

  test("evaluates a single condition case-insensitively for text operators", () => {
    expect(
      matchesAttributes(
        { NAME: "Gardens by the Bay" },
        FIELDS,
        { conditions: [{ field: "NAME", operator: "contains", value: "GARDENS" }] }
      )
    ).toBe(true);
  });

  test("combines conditions with AND (all must match)", () => {
    const filter = {
      conditions: [
        { field: "RATING", operator: ">=", value: "4" },
        { field: "NAME", operator: "contains", value: "park" }
      ],
      logic: "AND"
    };
    expect(matchesAttributes({ RATING: 4.5, NAME: "Central Park" }, FIELDS, filter)).toBe(true);
    expect(matchesAttributes({ RATING: 4.5, NAME: "Gardens" }, FIELDS, filter)).toBe(false);
  });

  test("combines conditions with OR (any may match)", () => {
    const filter = {
      conditions: [
        { field: "RATING", operator: ">=", value: "4.9" },
        { field: "NAME", operator: "contains", value: "park" }
      ],
      logic: "OR"
    };
    expect(matchesAttributes({ RATING: 3, NAME: "Central Park" }, FIELDS, filter)).toBe(true);
    expect(matchesAttributes({ RATING: 3, NAME: "Gardens" }, FIELDS, filter)).toBe(false);
  });

  test("isNull/isNotNull treat missing, null, and empty-string as empty", () => {
    const isNullFilter = { conditions: [{ field: "NAME", operator: "isNull" }] };
    expect(matchesAttributes({}, FIELDS, isNullFilter)).toBe(true);
    expect(matchesAttributes({ NAME: null }, FIELDS, isNullFilter)).toBe(true);
    expect(matchesAttributes({ NAME: "" }, FIELDS, isNullFilter)).toBe(true);
    expect(matchesAttributes({ NAME: "x" }, FIELDS, isNullFilter)).toBe(false);
  });

  test("a valued operator never matches a null/undefined attribute", () => {
    expect(
      matchesAttributes({}, FIELDS, { conditions: [{ field: "RATING", operator: ">=", value: "0" }] })
    ).toBe(false);
  });

  test("numeric and date comparisons use real value ordering, not string ordering", () => {
    expect(
      matchesAttributes(
        { RATING: 10 },
        FIELDS,
        { conditions: [{ field: "RATING", operator: ">", value: "9" }] }
      )
    ).toBe(true); // "10" > "9" is false as strings, true as numbers

    expect(
      matchesAttributes(
        { OPENED: "2024-06-01" },
        FIELDS,
        { conditions: [{ field: "OPENED", operator: ">", value: "2024-01-01" }] }
      )
    ).toBe(true);
  });
});

describe("describeFilter", () => {
  test("returns an empty string for an empty/unusable filter", () => {
    expect(describeFilter({ conditions: [] })).toBe("");
    expect(describeFilter(undefined)).toBe("");
  });

  test("renders a human-readable summary joined by the logic operator", () => {
    const description = describeFilter({
      conditions: [
        { field: "RATING", operator: ">=", value: "4" },
        { field: "NAME", operator: "isNotNull" }
      ],
      logic: "AND"
    });
    expect(description).toBe("RATING at least 4 AND NAME is not empty");
  });
});
