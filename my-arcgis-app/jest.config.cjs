module.exports = {
  coverageReporters: ["lcov", "text"],
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/test/setupTests.js"],
  moduleNameMapper: {
    "\\.(css|less|scss|sass)$": "<rootDir>/test/mocks/styleMock.js",
    "^@arcgis/core/(.*)$": "<rootDir>/test/mocks/arcgis-core/$1",
    "^@arcgis/map-components/components/(.*)$": "<rootDir>/test/mocks/arcgis-map-components/$1.js",
    "config/ArcGISConfiguration(\\.js)?$": "<rootDir>/test/mocks/ArcGISConfiguration.js"
  },
  testMatch: ["<rootDir>/src/**/*.test.{js,jsx}", "<rootDir>/test/**/*.test.{js,jsx}"],
  moduleFileExtensions: ["js", "jsx", "json"],
  collectCoverageFrom: [
    "src/**/*.{js,jsx}",
    "!src/main.jsx",
    "!src/config/ArcGISConfiguration.js"
  ],
  coverageDirectory: "<rootDir>/coverage",
  clearMocks: true
};
