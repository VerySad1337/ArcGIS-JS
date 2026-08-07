import Portal from "@arcgis/core/portal/Portal";
import { searchPortalLayers } from "./PortalService";

describe("searchPortalLayers", () => {
  test("builds an anonymous portal when nobody is signed in, so search can never prompt", async () => {
    // Searching public portal content is a no-account feature. Leaving
    // authMode to the SDK default lets it resolve a missing credential by
    // opening a sign-in dialog, which turns portal search into a login wall.
    // AuthService.hasPortalCredential() is false here because the shared
    // IdentityManager mock's findCredential returns undefined by default.
    // This is the first search in the file, so it is the call that actually
    // constructs and loads PortalService's cached Portal - which is why the
    // load() assertion lives here rather than in a later test that would only
    // ever see the already-cached instance.
    Portal.instances.length = 0;

    await searchPortalLayers("parks");

    expect(Portal.instances[0].authMode).toBe("anonymous");
    expect(Portal.instances[0].url).toBe("https://www.arcgis.com");
    expect(Portal.prototype.load).toHaveBeenCalled();
  });

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
