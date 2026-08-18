module.exports = {
  WEBMAP_ID: "e64141e618654205b8e4849c39f23212",
  WEBSCENE_ID: "54e3ba44a26243f0867d52bb1cc454fc",
  ROUTE_SERVICE_URL: "https://route.arcgis.com/arcgis/rest/services/World/Route/NAServer/Route_World",
  TOURIST_ATTRACTIONS_FEATURE_LAYER_URL: "https://services2.arcgis.com/j80Jz20at6Bi0thr/arcgis/rest/services/Tourist_Attractions/FeatureServer",
  MRT_STATION_FEATURE_LAYER_URL: "https://services2.arcgis.com/j80Jz20at6Bi0thr/arcgis/rest/services/Rail_Stations/FeatureServer",
  MRT_LINE_FEATURE_LAYER_URL: "https://services2.arcgis.com/j80Jz20at6Bi0thr/arcgis/rest/services/Rail_Lines/FeatureServer",
  GEOCODER_URL: "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer",
  PORTAL_URL: "https://www.arcgis.com",
  OAUTH_APP_ID: null,
  BUILDINGS_SCENE_LAYER_URL: "https://basemaps3d.arcgis.com/arcgis/rest/services/OpenStreetMap3DBuildings/SceneServer",
  BASEMAP_OPTIONS: [
    { id: "default", label: "Default" },
    { id: "satellite", label: "Imagery" },
    { id: "onemap", label: "OneMap (Singapore)" }
  ],
  IMAGERY_BASEMAP_IDS: ["satellite"],
  ONEMAP_TILE_URL_TEMPLATE: "https://www.onemap.gov.sg/maps/tiles/Default/{level}/{col}/{row}.png",
  ONEMAP_ATTRIBUTION: "Map data © OneMap, Singapore Land Authority",
  CHAT_ENABLED: true
};
