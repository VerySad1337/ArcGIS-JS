class WebTileLayer {
  constructor(props = {}) {
    this.urlTemplate = props.urlTemplate;
    this.copyright = props.copyright;
  }
}

module.exports = WebTileLayer;
module.exports.default = WebTileLayer;
