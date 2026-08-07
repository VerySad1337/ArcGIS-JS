// queryItems/load live on the prototype (shared by every instance,
// including the PortalService.js module-level singleton) rather than being
// assigned per-instance in the constructor, so tests can reach them via
// `Portal.prototype.queryItems` without needing a handle on that singleton -
// jest's `clearMocks` config resets each mock's call history before every
// test but leaves its prototype-level implementation intact.
// Constructor props are copied onto the instance and every instance is
// recorded, so tests can assert on construction-time options (notably
// `authMode`, which decides whether the SDK may open a sign-in dialog) without
// needing a handle on PortalService.js's module-level instance. `instances`
// is plain state, not a jest mock, so tests that read it must reset it
// themselves - jest's `clearMocks` does not.
class Portal {
  constructor(props = {}) {
    Object.assign(this, props);
    Portal.instances.push(this);
  }
}

Portal.instances = [];

Portal.prototype.load = jest.fn(function load() {
  return Promise.resolve(this);
});
Portal.prototype.queryItems = jest.fn().mockResolvedValue({ results: [] });

module.exports = Portal;
module.exports.default = Portal;
