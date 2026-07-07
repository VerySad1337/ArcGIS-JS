class Point {
  constructor(props = {}) {
    this.longitude = props.longitude;
    this.latitude = props.latitude;
    this.type = "point";
  }
}

module.exports = Point;
module.exports.default = Point;
