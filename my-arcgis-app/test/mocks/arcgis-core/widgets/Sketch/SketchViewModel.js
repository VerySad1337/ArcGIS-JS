class SketchViewModel {
  constructor(props = {}) {
    this.view = props.view;
    this.layer = props.layer;
    this._handlers = {};
    this.create = jest.fn();
    this.cancel = jest.fn();
    this.destroy = jest.fn();
  }
  on(eventName, callback) {
    this._handlers[eventName] = callback;
    return { remove: jest.fn() };
  }
  // Test helper: not part of the real ArcGIS API, lets tests simulate a
  // SketchViewModel "create" event completing.
  emit(eventName, payload) {
    this._handlers[eventName]?.(payload);
  }
}

module.exports = SketchViewModel;
module.exports.default = SketchViewModel;
