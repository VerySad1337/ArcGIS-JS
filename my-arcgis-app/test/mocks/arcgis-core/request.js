const esriRequest = jest.fn().mockResolvedValue({ data: {} });

module.exports = esriRequest;
module.exports.default = esriRequest;
