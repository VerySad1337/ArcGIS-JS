import { memo, useCallback, useEffect, useState } from "react";
import PropTypes from "prop-types";
import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-zoom";

// `arcgis-scene` is deliberately NOT imported at module scope the way
// `arcgis-map` is. Registering it statically pulls the whole SceneView/3D
// renderer graph (WebGL techniques, 3D symbol layer factories, elevation and
// I3S handling) into the entry chunk, so every visitor downloads and parses
// it on first load even though the app always starts in 2D (see
// ApplicationShell's `is3D` initial state) and a session may never switch.
// Importing it on demand moves that cost to the first 2D -> 3D switch, where
// the user has explicitly asked for 3D and a short wait is expected.
//
// The promise is cached at module scope rather than per component instance so
// switching back and forth doesn't re-enter the import (it would resolve from
// the module cache anyway, but this also keeps `sceneReady` from flickering
// through a loading state on every subsequent switch).
let sceneComponentPromise = null;
function loadSceneComponent() {
  sceneComponentPromise ??= import("@arcgis/map-components/components/arcgis-scene");
  return sceneComponentPromise;
}

function GISMapView({
  is3D,
  webMapId,
  webSceneId,
  onViewReady
}) {
  // Whether the custom element definition above has finished loading. The
  // <arcgis-scene> element is only rendered once it has: rendering it before
  // definition would leave an un-upgraded element that React has already
  // attached its ready-event handler to, and the upgrade timing of that
  // handler is exactly the kind of thing that surfaces as "the map sometimes
  // never initializes". Waiting is cheap and unambiguous.
  const [sceneReady, setSceneReady] = useState(false);

  useEffect(() => {
    if (!is3D || sceneReady) return;
    let cancelled = false;
    loadSceneComponent().then(() => {
      if (!cancelled) setSceneReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [is3D, sceneReady]);

  const handleViewReady = useCallback(
    (event) => {
      const view = event.target.view;
      if (onViewReady) onViewReady(view);
    },
    [onViewReady]
  );

  if (is3D) {
    return sceneReady ? (
      <arcgis-scene
        item-id={webSceneId}
        class="scene-view"
        onarcgisViewReadyChange={handleViewReady}
      >
        <arcgis-zoom slot="top-left" />
      </arcgis-scene>
    ) : (
      <div className="scene-view map-view-loading" role="status">
        Loading 3D view…
      </div>
    );
  }

  return (
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

// The map element is by far the most expensive node in the tree to touch, and
// none of its props change when unrelated shell state does (a toast, a filter
// draft, a layer-list refresh). Memoizing it means those re-renders stop at
// this boundary instead of reaching the custom element every time.
export default memo(GISMapView);
