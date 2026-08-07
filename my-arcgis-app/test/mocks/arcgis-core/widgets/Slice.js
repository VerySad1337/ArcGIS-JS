class Slice {
  constructor(props = {}) {
    this.view = props.view;
    this.destroy = jest.fn();
  }
}

module.exports = Slice;
module.exports.default = Slice;
