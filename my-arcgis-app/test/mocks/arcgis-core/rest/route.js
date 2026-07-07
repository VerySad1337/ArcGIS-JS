const solve = jest.fn().mockResolvedValue({
  routeResults: [{ route: { geometry: { type: "polyline", paths: [[]] } } }]
});

module.exports = { solve };
