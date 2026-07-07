import { renderHook, act } from "@testing-library/react";
import { geocodeAddress } from "../services/GeocodingService";
import { solveRoute } from "../services/RoutingService";
import { useRoutingEngine } from "./useRoutingEngine";

jest.mock("../services/GeocodingService");
jest.mock("../services/RoutingService");

describe("useRoutingEngine", () => {
  test("geocodes both endpoints, solves the route, and stores the resulting geometry", async () => {
    geocodeAddress
      .mockResolvedValueOnce({ longitude: 1, latitude: 2 })
      .mockResolvedValueOnce({ longitude: 3, latitude: 4 });
    const geometry = { type: "polyline" };
    solveRoute.mockResolvedValue({ routeResults: [{ route: { geometry } }] });

    const { result } = renderHook(() => useRoutingEngine());
    expect(result.current.routeGeometry).toBeNull();

    await act(async () => {
      await result.current.calculateRoute("Start St", "End Ave");
    });

    expect(geocodeAddress).toHaveBeenNthCalledWith(1, "Start St");
    expect(geocodeAddress).toHaveBeenNthCalledWith(2, "End Ave");
    expect(solveRoute).toHaveBeenCalledWith({
      type: "features",
      features: [
        { geometry: { longitude: 1, latitude: 2 } },
        { geometry: { longitude: 3, latitude: 4 } }
      ]
    });
    expect(result.current.routeGeometry).toBe(geometry);
  });
});
