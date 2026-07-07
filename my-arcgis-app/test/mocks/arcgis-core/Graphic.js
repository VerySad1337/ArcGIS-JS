const { makeSymbol } = require("./_autocast");

class Graphic {
  constructor(props = {}) {
    this.geometry = props.geometry ?? null;
    this.attributes = props.attributes ?? {};
    this.symbol = makeSymbol(props.symbol);
    this.layer = null;
  }
}

module.exports = Graphic;
module.exports.default = Graphic;
