// queryItems/load live on the prototype (shared by every instance,
// including the PortalService.js module-level singleton) rather than being
// assigned per-instance in the constructor, so tests can reach them via
// `Portal.prototype.queryItems` without needing a handle on that singleton -
// jest's `clearMocks` config resets each mock's call history before every
// test but leaves its prototype-level implementation intact.
class Portal {}

Portal.prototype.load = jest.fn(function load() {
  return Promise.resolve(this);
});
Portal.prototype.queryItems = jest.fn().mockResolvedValue({ results: [] });

module.exports = Portal;
module.exports.default = Portal;
