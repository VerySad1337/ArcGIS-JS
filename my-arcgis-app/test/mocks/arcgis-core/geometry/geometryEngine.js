// Minimal stand-in: returns a fake polygon geometry derived from the input,
// which is all GISMapEngine.bufferSelectedFeature needs to build a Graphic.
const geodesicBuffer = jest.fn((geometry, distance) => ({
  type: "polygon",
  rings: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]],
  spatialReference: geometry?.spatialReference,
  __bufferDistance: distance
}));

module.exports = { geodesicBuffer };
