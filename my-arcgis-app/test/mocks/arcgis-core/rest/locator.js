const addressToLocations = jest.fn().mockResolvedValue([]);
const locationToAddress = jest.fn().mockResolvedValue({ address: "", attributes: {} });

module.exports = { addressToLocations, locationToAddress };
