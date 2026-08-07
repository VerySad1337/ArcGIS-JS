import { addressToLocations } from "@arcgis/core/rest/locator";
import { geocodeAddress } from "./GeocodingService";

describe("geocodeAddress", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("resolves to the first result's longitude/latitude", async () => {
    addressToLocations.mockResolvedValueOnce([{ location: { x: 103.8, y: 1.3 } }]);

    const result = await geocodeAddress("Marina Bay Sands");

    expect(result).toEqual({ longitude: 103.8, latitude: 1.3 });
    expect(addressToLocations).toHaveBeenCalledWith(
      expect.stringContaining("geocode.arcgis.com"),
      expect.objectContaining({
        address: { SingleLine: "Marina Bay Sands" },
        countryCode: "SGP"
      })
    );
  });

  test("falls back to Nominatim when Esri finds nothing, without needing an API key", async () => {
    addressToLocations.mockResolvedValueOnce([]);
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [{ lon: "103.8198", lat: "1.3521" }]
    });

    const result = await geocodeAddress("238801");

    expect(result).toEqual({ longitude: 103.8198, latitude: 1.3521 });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("nominatim.openstreetmap.org/search")
    );
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("countrycodes=sg"));
    // "238801" is a bare 6-digit postal code, so it should be normalized to
    // the "S238801" form before being sent to either geocoder.
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("q=S238801"));
  });

  test("prefixes a bare 6-digit postal code with 'S' before geocoding", async () => {
    addressToLocations.mockResolvedValueOnce([{ location: { x: 103.93, y: 1.32 } }]);

    await geocodeAddress("460022");

    expect(addressToLocations).toHaveBeenCalledWith(
      expect.stringContaining("geocode.arcgis.com"),
      expect.objectContaining({ address: { SingleLine: "S460022" } })
    );
  });

  test("leaves an already-'S'-prefixed postal code unchanged", async () => {
    addressToLocations.mockResolvedValueOnce([{ location: { x: 103.93, y: 1.32 } }]);

    await geocodeAddress("S460022");

    expect(addressToLocations).toHaveBeenCalledWith(
      expect.stringContaining("geocode.arcgis.com"),
      expect.objectContaining({ address: { SingleLine: "S460022" } })
    );
  });

  test("leaves a full address (not a bare 6-digit code) unchanged", async () => {
    addressToLocations.mockResolvedValueOnce([{ location: { x: 103.87, y: 1.33 } }]);

    await geocodeAddress("3 Geylang Bahru Lane");

    expect(addressToLocations).toHaveBeenCalledWith(
      expect.stringContaining("geocode.arcgis.com"),
      expect.objectContaining({ address: { SingleLine: "3 Geylang Bahru Lane" } })
    );
  });

  test("throws the original Esri error when both Esri and the Nominatim fallback fail", async () => {
    addressToLocations.mockRejectedValueOnce(new Error("Esri service unavailable"));
    global.fetch = jest.fn().mockRejectedValueOnce(new Error("network error"));

    await expect(geocodeAddress("Nowhere")).rejects.toThrow("Esri service unavailable");
  });

  test("throws when neither Esri nor Nominatim find a location", async () => {
    addressToLocations.mockResolvedValueOnce([]);
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => []
    });

    await expect(geocodeAddress("Nowhere")).rejects.toThrow("Location not found");
  });
});
