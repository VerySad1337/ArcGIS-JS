// AuthService's behavior branches entirely on whether OAUTH_APP_ID is set,
// and registers its OAuthInfo/portal singleton state at module scope - so
// each scenario below re-mocks ArcGISConfiguration and re-requires the
// module fresh (jest.resetModules) rather than importing it once at the
// top of the file, to keep that module-scoped state from leaking between
// tests.
describe("AuthService when OAuth is not configured", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock("../config/ArcGISConfiguration", () => ({
      PORTAL_URL: "https://www.arcgis.com",
      OAUTH_APP_ID: null
    }));
  });

  test("isOAuthConfigured returns false", () => {
    const { isOAuthConfigured } = require("./AuthService");
    expect(isOAuthConfigured()).toBe(false);
  });

  test("checkSignInStatus resolves to null without calling IdentityManager", async () => {
    const { checkSignInStatus } = require("./AuthService");
    const IdentityManager = require("@arcgis/core/identity/IdentityManager");

    await expect(checkSignInStatus()).resolves.toBeNull();
    expect(IdentityManager.checkSignInStatus).not.toHaveBeenCalled();
  });

  test("signIn throws instead of prompting", async () => {
    const { signIn } = require("./AuthService");
    await expect(signIn()).rejects.toThrow("Portal sign-in isn't configured for this app.");
  });
});

describe("AuthService when OAuth is configured", () => {
  beforeEach(() => {
    jest.resetModules();
    jest.doMock("../config/ArcGISConfiguration", () => ({
      PORTAL_URL: "https://www.arcgis.com",
      OAUTH_APP_ID: "test-client-id"
    }));
  });

  test("isOAuthConfigured returns true", () => {
    const { isOAuthConfigured } = require("./AuthService");
    expect(isOAuthConfigured()).toBe(true);
  });

  test("signIn registers OAuthInfo, gets a credential for the portal's sharing root, and resolves the profile", async () => {
    const Portal = require("@arcgis/core/portal/Portal");
    Portal.prototype.load.mockImplementationOnce(function loadImpl() {
      this.user = { username: "jdoe", fullName: "Jane Doe", orgId: "org1", thumbnailUrl: "thumb.png" };
      return Promise.resolve(this);
    });
    const IdentityManager = require("@arcgis/core/identity/IdentityManager");
    const OAuthInfo = require("@arcgis/core/identity/OAuthInfo");

    const { signIn } = require("./AuthService");
    const user = await signIn();

    expect(IdentityManager.registerOAuthInfos).toHaveBeenCalledWith([expect.any(OAuthInfo)]);
    expect(IdentityManager.getCredential).toHaveBeenCalledWith("https://www.arcgis.com/sharing");
    expect(user).toEqual({
      username: "jdoe",
      fullName: "Jane Doe",
      orgId: "org1",
      thumbnailUrl: "thumb.png"
    });
  });

  test("signIn only registers OAuthInfo once across repeated calls", async () => {
    const IdentityManager = require("@arcgis/core/identity/IdentityManager");
    const { signIn } = require("./AuthService");

    await signIn();
    await signIn();

    expect(IdentityManager.registerOAuthInfos).toHaveBeenCalledTimes(1);
  });

  test("signIn resolves to null when the portal reports no signed-in user", async () => {
    const { signIn } = require("./AuthService");
    const user = await signIn();
    expect(user).toBeNull();
  });

  test("signIn falls back to username when fullName is missing", async () => {
    const Portal = require("@arcgis/core/portal/Portal");
    Portal.prototype.load.mockImplementationOnce(function loadImpl() {
      this.user = { username: "jdoe" };
      return Promise.resolve(this);
    });

    const { signIn } = require("./AuthService");
    const user = await signIn();

    expect(user).toEqual({ username: "jdoe", fullName: "jdoe", orgId: null, thumbnailUrl: null });
  });

  test("checkSignInStatus resolves to null when there is no existing session", async () => {
    const IdentityManager = require("@arcgis/core/identity/IdentityManager");
    IdentityManager.checkSignInStatus.mockRejectedValueOnce(new Error("not signed in"));

    const { checkSignInStatus } = require("./AuthService");
    await expect(checkSignInStatus()).resolves.toBeNull();
  });

  test("checkSignInStatus resolves the signed-in user's profile when a session already exists", async () => {
    const IdentityManager = require("@arcgis/core/identity/IdentityManager");
    IdentityManager.checkSignInStatus.mockResolvedValueOnce(undefined);
    const Portal = require("@arcgis/core/portal/Portal");
    Portal.prototype.load.mockImplementationOnce(function loadImpl() {
      this.user = { username: "jdoe", fullName: "Jane Doe" };
      return Promise.resolve(this);
    });

    const { checkSignInStatus } = require("./AuthService");
    const result = await checkSignInStatus();

    expect(IdentityManager.checkSignInStatus).toHaveBeenCalledWith("https://www.arcgis.com/sharing");
    expect(result).toEqual({ username: "jdoe", fullName: "Jane Doe", orgId: null, thumbnailUrl: null });
  });

  test("signOut destroys every credential", () => {
    const IdentityManager = require("@arcgis/core/identity/IdentityManager");
    const { signOut } = require("./AuthService");

    signOut();

    expect(IdentityManager.destroyCredentials).toHaveBeenCalled();
  });
});
