import { geocodeAddress, reverseGeocodeLocation } from "./GeocodingService";

describe("geocodeAddress", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("resolves to the first result's longitude/latitude via onemap-proxy's /api/onemap/search", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ LATITUDE: "1.3521", LONGITUDE: "103.8198" }] })
    });

    const result = await geocodeAddress("Marina Bay Sands");

    expect(result).toEqual({ longitude: 103.8198, latitude: 1.3521 });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith("/api/onemap/search?q=Marina%20Bay%20Sands");
  });

  test("prefixes a bare 6-digit postal code with 'S' before geocoding", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ LATITUDE: "1.32", LONGITUDE: "103.93" }] })
    });

    await geocodeAddress("460022");

    expect(global.fetch).toHaveBeenCalledWith("/api/onemap/search?q=S460022");
  });

  test("leaves an already-'S'-prefixed postal code unchanged", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ LATITUDE: "1.32", LONGITUDE: "103.93" }] })
    });

    await geocodeAddress("S460022");

    expect(global.fetch).toHaveBeenCalledWith("/api/onemap/search?q=S460022");
  });

  test("leaves a full address (not a bare 6-digit code) unchanged", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [{ LATITUDE: "1.33", LONGITUDE: "103.87" }] })
    });

    await geocodeAddress("3 Geylang Bahru Lane");

    expect(global.fetch).toHaveBeenCalledWith("/api/onemap/search?q=3%20Geylang%20Bahru%20Lane");
  });

  test("throws, with no fallback to any other provider, when the proxy finds nothing", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) });

    await expect(geocodeAddress("Nowhere")).rejects.toThrow("Location not found");
  });

  test("throws when the proxy itself responds with an error status", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 502 });

    await expect(geocodeAddress("Nowhere")).rejects.toThrow("Location not found");
  });
});

describe("reverseGeocodeLocation", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("resolves to the address, postal code, and block via onemap-proxy's /api/onemap/revgeocode", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        GeocodeInfo: [{ BUILDINGNAME: "NIL", BLOCK: "168", ROAD: "Bishan Street 13", POSTALCODE: "570168" }]
      })
    });

    const result = await reverseGeocodeLocation(1.2834, 103.8607);

    expect(result).toEqual({ address: "168 Bishan Street 13", postalCode: "570168", block: "168" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith("/api/onemap/revgeocode?lat=1.2834&lon=103.8607");
  });

  test("includes the building name when present", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        GeocodeInfo: [
          { BUILDINGNAME: "MARINA BAY SANDS", BLOCK: "1", ROAD: "BAYFRONT AVENUE", POSTALCODE: "018971" }
        ]
      })
    });

    const result = await reverseGeocodeLocation(1.2834, 103.8607);

    expect(result).toEqual({ address: "MARINA BAY SANDS, 1 BAYFRONT AVENUE", postalCode: "018971", block: "1" });
  });

  test("throws, with no fallback to any other provider, when the proxy finds nothing", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ GeocodeInfo: [] }) });

    await expect(reverseGeocodeLocation(1.2834, 103.8607)).rejects.toThrow("No address found for this location");
  });

  test("throws when the proxy itself responds with an error status", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: false, status: 502 });

    await expect(reverseGeocodeLocation(1.2834, 103.8607)).rejects.toThrow("No address found for this location");
  });

  test("rejects an out-of-range latitude before ever calling the proxy", async () => {
    global.fetch = jest.fn();

    await expect(reverseGeocodeLocation(200, 103.8607)).rejects.toThrow(
      "Latitude must be a number between -90 and 90."
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("rejects an out-of-range longitude before ever calling the proxy", async () => {
    global.fetch = jest.fn();

    await expect(reverseGeocodeLocation(1.2834, 400)).rejects.toThrow(
      "Longitude must be a number between -180 and 180."
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("rejects a non-numeric coordinate", async () => {
    await expect(reverseGeocodeLocation("abc", 103.8607)).rejects.toThrow(
      "Latitude must be a number between -90 and 90."
    );
  });
});
