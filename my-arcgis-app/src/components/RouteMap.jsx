import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-scene";
import "@arcgis/map-components/components/arcgis-zoom";

export default function RouteMap({
is3D,
webMapId,
webSceneId
}) {
if (!is3D) {
return ( <arcgis-map
     item-id={webMapId}
     class="map-view"
   > <arcgis-zoom slot="top-left"></arcgis-zoom> </arcgis-map>
);
}

return ( <arcgis-scene
   item-id={webSceneId}
   class="scene-view"
 > <arcgis-zoom slot="top-left"></arcgis-zoom> </arcgis-scene>
);
}
