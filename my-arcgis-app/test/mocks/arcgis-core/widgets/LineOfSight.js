class LineOfSight {
  constructor(props = {}) {
    this.view = props.view;
    this.destroy = jest.fn();
  }
}

module.exports = LineOfSight;
module.exports.default = LineOfSight;
