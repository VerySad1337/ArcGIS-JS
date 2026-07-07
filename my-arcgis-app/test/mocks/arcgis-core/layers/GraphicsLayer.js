class GraphicsCollection {
  constructor(items = []) {
    this.items = [...items];
  }
  get length() {
    return this.items.length;
  }
  toArray() {
    return [...this.items];
  }
  forEach(fn) {
    this.items.forEach(fn);
  }
  add(item) {
    this.items.push(item);
  }
  addMany(items) {
    this.items.push(...items);
  }
  removeAll() {
    this.items = [];
  }
  [Symbol.iterator]() {
    return this.items[Symbol.iterator]();
  }
}

class GraphicsLayer {
  constructor(props = {}) {
    this.title = props.title;
    this.visible = props.visible ?? true;
    this.elevationInfo = props.elevationInfo;
    this.graphics = new GraphicsCollection(props.graphics || []);
  }
  add(graphic) {
    graphic.layer = this;
    this.graphics.add(graphic);
  }
  addMany(graphics) {
    graphics.forEach((g) => {
      g.layer = this;
    });
    this.graphics.addMany(graphics);
  }
  removeAll() {
    this.graphics.removeAll();
  }
}

module.exports = GraphicsLayer;
module.exports.default = GraphicsLayer;
module.exports.GraphicsCollection = GraphicsCollection;
