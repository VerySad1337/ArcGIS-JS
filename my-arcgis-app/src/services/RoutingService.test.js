import { solve } from "@arcgis/core/rest/route.js";
import { solveRoute } from "./RoutingService";

describe("solveRoute", () => {
  test("resolves to the first route result's geometry", async () => {
    const geometry = { type: "polyline", paths: [[[0, 0], [1, 1]]] };
    solve.mockResolvedValueOnce({ routeResults: [{ route: { geometry } }] });

    const result = await solveRoute(
      { longitude: 1, latitude: 2 },
      { longitude: 3, latitude: 4 }
    );

    expect(result).toBe(geometry);
    expect(solve).toHaveBeenCalledWith(
      expect.stringContaining("route.arcgis.com"),
      expect.objectContaining({ returnDirections: true, returnRoutes: true })
    );
  });

  test("throws when no route results are returned", async () => {
    solve.mockResolvedValueOnce({ routeResults: [] });
    await expect(
      solveRoute({ longitude: 1, latitude: 2 }, { longitude: 3, latitude: 4 })
    ).rejects.toThrow("No route returned");
  });

  test("throws when the result is missing routeResults entirely", async () => {
    solve.mockResolvedValueOnce({});
    await expect(
      solveRoute({ longitude: 1, latitude: 2 }, { longitude: 3, latitude: 4 })
    ).rejects.toThrow("No route returned");
  });
});
