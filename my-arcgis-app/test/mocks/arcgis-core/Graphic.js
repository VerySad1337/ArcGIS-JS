const { makeSymbol } = require("./_autocast");

class Graphic {
  constructor(props = {}) {
    this.geometry = props.geometry ?? null;
    this.attributes = props.attributes ?? {};
    this.symbol = makeSymbol(props.symbol);
    this.layer = null;
    this.visible = props.visible ?? true;
  }
}

module.exports = Graphic;
module.exports.default = Graphic;
