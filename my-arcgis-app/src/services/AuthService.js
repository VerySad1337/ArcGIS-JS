import IdentityManager from "@arcgis/core/identity/IdentityManager";
import OAuthInfo from "@arcgis/core/identity/OAuthInfo";
import Portal from "@arcgis/core/portal/Portal";
import { OAUTH_APP_ID, PORTAL_URL } from "../config/ArcGISConfiguration";

// Sign-in is entirely optional: with no OAuth_APP_ID configured (the
// default), every function below is a safe no-op, so PortalService's
// existing anonymous search keeps working exactly as before this feature
// existed.
export const isOAuthConfigured = () => Boolean(OAUTH_APP_ID);

// OAuthInfo/registerOAuthInfos only need to happen once per session, no
// matter how many times sign-in is attempted or checked.
let oAuthInfo = null;
function ensureOAuthRegistered() {
  if (!isOAuthConfigured()) return null;
  if (!oAuthInfo) {
    oAuthInfo = new OAuthInfo({
      appId: OAUTH_APP_ID,
      portalUrl: PORTAL_URL,
      // Opens sign-in in a popup rather than redirecting the whole app away
      // and back, so in-progress app state (drawings, route, layer panel)
      // isn't lost to a full-page navigation.
      popup: true
    });
    IdentityManager.registerOAuthInfos([oAuthInfo]);
  }
  return oAuthInfo;
}

async function loadSignedInUser() {
  const portal = new Portal({ url: PORTAL_URL });
  await portal.load();
  if (!portal.user) return null;

  return {
    username: portal.user.username,
    fullName: portal.user.fullName || portal.user.username,
    orgId: portal.user.orgId || null,
    thumbnailUrl: portal.user.thumbnailUrl || null
  };
}

// Called once on app startup to pick up an existing signed-in session
// (IdentityManager persists credentials in the browser across reloads)
// without prompting the user again. Resolves to null - never throws - when
// there's no existing session, so callers can treat it as "logged out".
export async function checkSignInStatus() {
  if (!isOAuthConfigured()) return null;
  ensureOAuthRegistered();

  try {
    await IdentityManager.checkSignInStatus(`${PORTAL_URL}/sharing`);
    return await loadSignedInUser();
  } catch {
    return null;
  }
}

// Prompts the user to sign in (via the popup registered above) and
// resolves to their profile once IdentityManager has a credential for the
// configured portal.
export async function signIn() {
  if (!isOAuthConfigured()) {
    throw new Error("Portal sign-in isn't configured for this app.");
  }
  ensureOAuthRegistered();

  await IdentityManager.getCredential(`${PORTAL_URL}/sharing`);
  return loadSignedInUser();
}

// Destroys every credential IdentityManager is holding, immediately
// reverting subsequent portal requests (e.g. the next search) to
// anonymous.
export function signOut() {
  IdentityManager.destroyCredentials();
}
