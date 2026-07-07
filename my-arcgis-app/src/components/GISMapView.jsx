import PropTypes from "prop-types";
import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-scene";
import "@arcgis/map-components/components/arcgis-zoom";

export default function GISMapView({
  is3D,
  webMapId,
  webSceneId,
  onViewReady
}) {
  const handleViewReady = (event) => {
    const view = event.target.view;
    if (onViewReady) onViewReady(view);
  };

  return is3D ? (
    <arcgis-scene
      item-id={webSceneId}
      class="scene-view"
      onarcgisViewReadyChange={handleViewReady}
    >
      <arcgis-zoom slot="top-left" />
    </arcgis-scene>
  ) : (
    <arcgis-map
      item-id={webMapId}
      class="map-view"
      onarcgisViewReadyChange={handleViewReady}
    >
      <arcgis-zoom slot="top-left" />
    </arcgis-map>
  );
}

GISMapView.propTypes = {
  is3D: PropTypes.bool,
  webMapId: PropTypes.string,
  webSceneId: PropTypes.string,
  onViewReady: PropTypes.func
};