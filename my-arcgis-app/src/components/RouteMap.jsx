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
const viewRef = useRef(null);

const handleViewReady = (event) => {
const view = event.target.view;

viewRef.current = view;

if (!view.map.layers.includes(graphicsLayerRef.current)) {
  view.map.add(graphicsLayerRef.current);
}

console.log("Graphics layer added");

};

useEffect(() => {
if (!routeGeometry) return;

graphicsLayerRef.current.removeAll();

const routeGraphic = new Graphic({
  geometry: routeGeometry,
  symbol: {
    type: "simple-line",
    color: [255, 0, 0, 1],
    width: 10,
    cap: "round",
    join: "round"
  }
});

graphicsLayerRef.current.add(routeGraphic);

console.log("Route graphic added");
console.log(
  "Graphics count:",
  graphicsLayerRef.current.graphics.length
);

if (viewRef.current) {
  viewRef.current.goTo(routeGeometry);
}

}, [routeGeometry]);

if (!is3D) {
return (
<arcgis-map item-id={webMapId} class="map-view" onarcgisViewReadyChange={handleViewReady} >
<arcgis-zoom slot="top-left"></arcgis-zoom>
</arcgis-map>
);
}

return (
<arcgis-scene item-id={webSceneId} class="scene-view" onarcgisViewReadyChange={handleViewReady} >
<arcgis-zoom slot="top-left"></arcgis-zoom>
</arcgis-scene>
);
}