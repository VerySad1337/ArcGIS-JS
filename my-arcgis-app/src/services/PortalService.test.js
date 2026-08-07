import Portal from "@arcgis/core/portal/Portal";
import { searchPortalLayers } from "./PortalService";

describe("searchPortalLayers", () => {
  test("returns an empty array for a blank query without querying the portal", async () => {
    const results = await searchPortalLayers("   ");
    expect(results).toEqual([]);
    expect(Portal.prototype.queryItems).not.toHaveBeenCalled();
  });

  test("loads the portal and maps results, filtering out items with no url", async () => {
    Portal.prototype.queryItems.mockResolvedValueOnce({
      results: [
        {
          id: "abc123",
          title: "Parks",
          snippet: "Park boundaries",
          owner: "gis_admin",
          url: "https://example.com/Parks/FeatureServer",
          thumbnailUrl: "https://example.com/thumb.png"
        },
        { id: "no-url-item", title: "Restricted Layer", url: null }
      ]
    });

    const results = await searchPortalLayers("parks");

    expect(results).toEqual([
      {
        id: "abc123",
        title: "Parks",
        snippet: "Park boundaries",
        owner: "gis_admin",
        url: "https://example.com/Parks/FeatureServer",
        thumbnailUrl: "https://example.com/thumb.png"
      }
    ]);
    expect(Portal.prototype.load).toHaveBeenCalled();
  });

  test("restricts the query to Feature Service items and respects num", async () => {
    Portal.prototype.queryItems.mockResolvedValueOnce({ results: [] });

    await searchPortalLayers("transit", { num: 5 });

    expect(Portal.prototype.queryItems).toHaveBeenCalledWith(
      expect.objectContaining({
        query: '(transit) AND (type:"Feature Service")',
        num: 5
      })
    );
  });

  test("defaults thumbnailUrl to null when the portal doesn't provide one", async () => {
    Portal.prototype.queryItems.mockResolvedValueOnce({
      results: [{ id: "x", title: "No Thumb", url: "https://example.com/x/FeatureServer" }]
    });

    const results = await searchPortalLayers("x");

    expect(results[0].thumbnailUrl).toBeNull();
  });
});
