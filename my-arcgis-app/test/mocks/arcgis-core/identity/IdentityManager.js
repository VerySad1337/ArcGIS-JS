const IdentityManager = {
  getCredential: jest.fn().mockResolvedValue({ token: "mock-token" }),
  // Non-prompting lookup. Defaults to undefined ("nobody is signed in"),
  // which is the app's normal anonymous state - tests that exercise a
  // privileged path must opt in by mocking a return value, so a forced
  // sign-in can't creep back in unnoticed.
  findCredential: jest.fn().mockReturnValue(undefined),
  registerOAuthInfos: jest.fn(),
  checkSignInStatus: jest.fn().mockRejectedValue(new Error("not signed in")),
  destroyCredentials: jest.fn()
};

module.exports = IdentityManager;
module.exports.default = IdentityManager;
