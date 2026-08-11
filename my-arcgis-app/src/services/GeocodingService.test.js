import { addressToLocations, locationToAddress } from "@arcgis/core/rest/locator";
import { geocodeAddress, reverseGeocodeLocation } from "./GeocodingService";

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

describe("reverseGeocodeLocation", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("resolves to the address, postal code, and nearest block (AddNum) from the address-restricted Esri candidate", async () => {
    locationToAddress.mockResolvedValueOnce({
      address: "168 Bishan Street 13, Singapore",
      attributes: { Postal: "570168", AddNum: "168" }
    });

    const result = await reverseGeocodeLocation(1.2834, 103.8607);

    expect(result).toEqual({ address: "168 Bishan Street 13, Singapore", postalCode: "570168", block: "168" });
    expect(locationToAddress).toHaveBeenCalledTimes(1);
    // These MUST be the SDK's kebab-case GeocodeFeatureType values, not the
    // REST API docs' PascalCase names - see the comment on
    // ADDRESS_FEATURE_TYPES in GeocodingService.js for why passing the wrong
    // casing silently no-ops the restriction instead of erroring.
    expect(locationToAddress).toHaveBeenCalledWith(
      expect.stringContaining("geocode.arcgis.com"),
      expect.objectContaining({
        location: expect.objectContaining({ latitude: 1.2834, longitude: 103.8607 }),
        featureTypes: ["street-address", "point-address"],
        distance: 500
      })
    );
  });

  test("falls back to an unrestricted Esri match when nothing address-level (with a postal code) is nearby, so a POI-only area still resolves to something", async () => {
    locationToAddress
      .mockResolvedValueOnce({ address: "", attributes: {} })
      .mockResolvedValueOnce({
        address: "Wunderground at Tampines West Open Plaza",
        attributes: { Postal: "", AddNum: "" }
      });

    const result = await reverseGeocodeLocation(1.3493, 103.9342);

    expect(result).toEqual({ address: "Wunderground at Tampines West Open Plaza", postalCode: "", block: "" });
    expect(locationToAddress).toHaveBeenCalledTimes(2);
    expect(locationToAddress).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("geocode.arcgis.com"),
      expect.objectContaining({ featureTypes: ["street-address", "point-address"], distance: 500 })
    );
    expect(locationToAddress).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("geocode.arcgis.com"),
      expect.not.objectContaining({ featureTypes: expect.anything() })
    );
  });

  test("never reports a block number from a candidate with no postal code, even if AddNum is set (a POI's AddNum can echo an unrelated digit from a numbered street name)", async () => {
    locationToAddress
      .mockResolvedValueOnce({ address: "", attributes: {} })
      .mockResolvedValueOnce({
        address: "New Century Food House",
        // A real bug: this POI's AddNum came back "828" with no Postal at
        // all - not a genuine block/house number for this candidate.
        attributes: { Postal: "", AddNum: "828" }
      });

    const result = await reverseGeocodeLocation(1.3489, 103.9346);

    expect(result).toEqual({ address: "New Century Food House", postalCode: "", block: "" });
  });

  test("falls back to Nominatim only when both the restricted and unrestricted Esri lookups find nothing", async () => {
    locationToAddress
      .mockResolvedValueOnce({ address: "", attributes: {} })
      .mockResolvedValueOnce({ address: "", attributes: {} });
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        display_name: "Marina Bay Sands, Singapore",
        address: { postcode: "018956", house_number: "10" }
      })
    });

    const result = await reverseGeocodeLocation(1.2834, 103.8607);

    expect(result).toEqual({ address: "Marina Bay Sands, Singapore", postalCode: "018956", block: "10" });
    expect(locationToAddress).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining("nominatim.openstreetmap.org/reverse"));
  });

  test("strips the duplicated country and the redundant region segment from the Nominatim fallback's address", async () => {
    locationToAddress
      .mockResolvedValueOnce({ address: "", attributes: {} })
      .mockResolvedValueOnce({ address: "", attributes: {} });
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        display_name:
          "897, Tampines Street 81, Tampines Polyview, Tampines, East Region, Singapore, 520897, Singapore",
        address: { postcode: "520897", house_number: "897", state: "East Region" }
      })
    });

    const result = await reverseGeocodeLocation(1.347769, 103.934);

    expect(result).toEqual({
      address: "897, Tampines Street 81, Tampines Polyview, Tampines, Singapore, 520897",
      postalCode: "520897",
      block: "897"
    });
  });

  test("throws the original Esri error when both Esri and the Nominatim fallback fail", async () => {
    locationToAddress.mockRejectedValueOnce(new Error("Esri service unavailable"));
    global.fetch = jest.fn().mockRejectedValueOnce(new Error("network error"));

    await expect(reverseGeocodeLocation(1.2834, 103.8607)).rejects.toThrow("Esri service unavailable");
  });

  test("rejects an out-of-range latitude before calling either geocoder", async () => {
    await expect(reverseGeocodeLocation(200, 103.8607)).rejects.toThrow(
      "Latitude must be a number between -90 and 90."
    );
    expect(locationToAddress).not.toHaveBeenCalled();
  });

  test("rejects an out-of-range longitude before calling either geocoder", async () => {
    await expect(reverseGeocodeLocation(1.2834, 400)).rejects.toThrow(
      "Longitude must be a number between -180 and 180."
    );
    expect(locationToAddress).not.toHaveBeenCalled();
  });

  test("rejects a non-numeric coordinate", async () => {
    await expect(reverseGeocodeLocation("abc", 103.8607)).rejects.toThrow(
      "Latitude must be a number between -90 and 90."
    );
  });
});
