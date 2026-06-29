import { useEffect, useRef } from "react";

import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-scene";
import "@arcgis/map-components/components/arcgis-zoom";

import Graphic from "@arcgis/core/Graphic";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";

export default function RouteMap({
  is3D,
  webMapId,
  webSceneId,
  routeGeometry
}) {
  const graphicsLayerRef = useRef(new GraphicsLayer());

  const handleViewReady = async (event) => {
    const view = event.target.view;

    if (!view.map.layers.includes(graphicsLayerRef.current)) {
      view.map.add(graphicsLayerRef.current);
    }
  };

  useEffect(() => {
    if (!routeGeometry) return;

    graphicsLayerRef.current.removeAll();

    const routeGraphic = new Graphic({
      geometry: routeGeometry,
      symbol: {
        type: "simple-line",
        color: [0, 0, 255],
        width: 4
      }
    });

    graphicsLayerRef.current.add(routeGraphic);
  }, [routeGeometry]);

  if (!is3D) {
    return (
      <arcgis-map
        item-id={webMapId}
        class="map-view"
        onarcgisViewReadyChange={handleViewReady}
      >
        <arcgis-zoom slot="top-left"></arcgis-zoom>
      </arcgis-map>
    );
  }

  return (
    <arcgis-scene
      item-id={webSceneId}
      class="scene-view"
      onarcgisViewReadyChange={handleViewReady}
    >
      <arcgis-zoom slot="top-left"></arcgis-zoom>
    </arcgis-scene>
  );
}