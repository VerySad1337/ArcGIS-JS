const IdentityManager = {
  getCredential: jest.fn().mockResolvedValue({ token: "mock-token" })
};

module.exports = IdentityManager;
module.exports.default = IdentityManager;
