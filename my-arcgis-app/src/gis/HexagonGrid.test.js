import { buildHexagonGrid, countPointsInHexagons } from "./HexagonGrid";

describe("buildHexagonGrid", () => {
  test("returns closed rings covering the given extent", () => {
    const extent = { xmin: 0, ymin: 0, xmax: 1000, ymax: 1000 };
    const hexagons = buildHexagonGrid(extent, 200);

    expect(hexagons.length).toBeGreaterThan(0);
    hexagons.forEach(({ ring }) => {
      expect(ring.length).toBe(7); // 6 vertices + closing repeat
      expect(ring[0]).toEqual(ring[6]);
    });
  });

  test("a smaller cell size produces more hexagons over the same extent", () => {
    const extent = { xmin: 0, ymin: 0, xmax: 1000, ymax: 1000 };
    expect(buildHexagonGrid(extent, 100).length).toBeGreaterThan(buildHexagonGrid(extent, 400).length);
  });
});

describe("countPointsInHexagons", () => {
  test("counts a point inside a hexagon's own center bin, and never double-counts across hexagons", () => {
    const extent = { xmin: 0, ymin: 0, xmax: 1000, ymax: 1000 };
    const hexagons = buildHexagonGrid(extent, 200);
    const points = [[10, 10], [15, 15], [990, 990]];

    const counts = countPointsInHexagons(hexagons, points);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(points.length);
  });

  test("a point far outside every hexagon contributes to no bin", () => {
    const extent = { xmin: 0, ymin: 0, xmax: 1000, ymax: 1000 };
    const hexagons = buildHexagonGrid(extent, 200);
    const counts = countPointsInHexagons(hexagons, [[1_000_000, 1_000_000]]);

    expect(counts.reduce((a, b) => a + b, 0)).toBe(0);
  });
});
