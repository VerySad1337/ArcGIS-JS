import { addressToLocations } from "@arcgis/core/rest/locator";
import { geocodeAddress } from "./GeocodingService";

describe("geocodeAddress", () => {
  test("resolves to the first result's longitude/latitude", async () => {
    addressToLocations.mockResolvedValueOnce([{ location: { x: 103.8, y: 1.3 } }]);

    const result = await geocodeAddress("Marina Bay Sands");

    expect(result).toEqual({ longitude: 103.8, latitude: 1.3 });
    expect(addressToLocations).toHaveBeenCalledWith(
      expect.stringContaining("geocode.arcgis.com"),
      { address: { SingleLine: "Marina Bay Sands" } }
    );
  });

  test("throws when no locations are found", async () => {
    addressToLocations.mockResolvedValueOnce([]);
    await expect(geocodeAddress("Nowhere")).rejects.toThrow("Location not found");
  });
});
