import Portal from "@arcgis/core/portal/Portal";
import PortalQueryParams from "@arcgis/core/portal/PortalQueryParams";
import { PORTAL_URL } from "../config/ArcGISConfiguration";
import { hasPortalCredential } from "./AuthService";

// A shared Portal instance (rather than one per search) so its load() only
// runs once per sign-in state. Explicitly targeting PORTAL_URL (ArcGIS Online
// by default, or an Enterprise portal if configured) rather than the no-args
// default keeps it aimed at AuthService's sign-in target - once signIn() has
// a credential for PORTAL_URL, IdentityManager attaches it to this Portal's
// requests automatically.
//
// `authMode` is set explicitly rather than left to the SDK default, because
// searching public content must work with no account at all:
//
//   "anonymous" (no credential) - the portal is forbidden from prompting.
//                Leaving this to the default hands the SDK the decision, and
//                its way of resolving a missing credential is to open a
//                sign-in dialog - turning a core no-account feature into an
//                apparent login wall.
//   "auto" (signed in) - use the existing credential, so results include the
//                user's org/private/group-shared items.
//
// The instance is rebuilt when that state changes, since authMode is fixed at
// construction: a Portal built while anonymous would stay anonymous for the
// rest of the session, so signing in would never widen the search results.
let portal = null;
let portalLoadPromise = null;
let builtAuthenticated = null;

async function ensurePortalLoaded() {
  const authenticated = hasPortalCredential();

  if (!portal || builtAuthenticated !== authenticated) {
    builtAuthenticated = authenticated;
    portal = new Portal({
      url: PORTAL_URL,
      authMode: authenticated ? "auto" : "anonymous"
    });
    portalLoadPromise = portal.load();
  }

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
