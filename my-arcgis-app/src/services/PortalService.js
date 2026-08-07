import Portal from "@arcgis/core/portal/Portal";
import PortalQueryParams from "@arcgis/core/portal/PortalQueryParams";
import { PORTAL_URL } from "../config/ArcGISConfiguration";

// A single shared Portal instance (rather than one per search) so its load()
// only runs once per session. Explicitly targeting PORTAL_URL (ArcGIS Online
// by default, or an Enterprise portal if configured) rather than the
// no-args default means this stays in sync with AuthService's sign-in
// target - once AuthService.signIn() has a credential for PORTAL_URL,
// IdentityManager attaches it to this Portal's requests automatically, so
// searches start reflecting whatever the signed-in user's organization has
// shared with them instead of only public items.
const portal = new Portal({ url: PORTAL_URL });
let portalLoadPromise = null;

async function ensurePortalLoaded() {
  if (!portalLoadPromise) portalLoadPromise = portal.load();
  await portalLoadPromise;
  return portal;
}

// Searches the portal for Feature Service items the user can add as a map
// layer. Restricted to "Feature Service" so results are always something
// GISMapEngine.addPortalLayer can turn into a FeatureLayer; items with no
// `url` (e.g. some restricted/pending items) are filtered out here rather
// than surfacing an "Add" button that would fail.
export async function searchPortalLayers(query, { num = 10 } = {}) {
  const text = query?.trim();
  if (!text) return [];

  const loadedPortal = await ensurePortalLoaded();

  const response = await loadedPortal.queryItems(
    new PortalQueryParams({
      query: `(${text}) AND (type:"Feature Service")`,
      num
    })
  );

  return response.results
    .filter((item) => !!item.url)
    .map((item) => ({
      id: item.id,
      title: item.title,
      snippet: item.snippet,
      owner: item.owner,
      url: item.url,
      thumbnailUrl: item.thumbnailUrl || null
    }));
}
