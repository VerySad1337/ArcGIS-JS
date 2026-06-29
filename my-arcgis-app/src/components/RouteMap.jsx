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
  routeGeometry,
  onViewReady
}) {
  const graphicsLayerRef = useRef(new GraphicsLayer());
  const viewRef = useRef(null);

  const handleViewReady = (event) => {
    const view = event.target.view;
    viewRef.current = view;

    view.map.add(graphicsLayerRef.current);

    if (onViewReady) onViewReady(view);
  };

  useEffect(() => {
    if (!routeGeometry) return;

    graphicsLayerRef.current.removeAll();

    graphicsLayerRef.current.add(
      new Graphic({
        geometry: routeGeometry,
        symbol: {
          type: "simple-line",
          color: [255, 0, 0],
          width: 6
        }
      })
    );
  }, [routeGeometry]);

  return !is3D ? (
    <arcgis-map
      item-id={webMapId}
      class="map-view"
      onarcgisViewReadyChange={handleViewReady}
    >
      <arcgis-zoom slot="top-left" />
    </arcgis-map>
  ) : (
    <arcgis-scene
      item-id={webSceneId}
      class="scene-view"
      onarcgisViewReadyChange={handleViewReady}
    >
      <arcgis-zoom slot="top-left" />
    </arcgis-scene>
  );
}