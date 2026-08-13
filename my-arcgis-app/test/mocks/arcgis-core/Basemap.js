class Basemap {
  constructor(props = {}) {
    this.title = props.title;
    this.baseLayers = props.baseLayers || [];
  }
}

module.exports = Basemap;
module.exports.default = Basemap;
