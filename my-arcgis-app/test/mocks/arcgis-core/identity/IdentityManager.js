const IdentityManager = {
  getCredential: jest.fn().mockResolvedValue({ token: "mock-token" }),
  registerOAuthInfos: jest.fn(),
  checkSignInStatus: jest.fn().mockRejectedValue(new Error("not signed in")),
  destroyCredentials: jest.fn()
};

module.exports = IdentityManager;
module.exports.default = IdentityManager;
