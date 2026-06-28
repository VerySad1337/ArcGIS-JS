import { useState } from "react";

import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-scene";
import "@arcgis/map-components/components/arcgis-zoom";

function App() {
  const [is3D, setIs3D] = useState(false);

  // Replace with your IDs
  const webMapId = "e64141e618654205b8e4849c39f23212";
  const webSceneId = "54e3ba44a26243f0867d52bb1cc454fc";

  return (
    <div className="app">
      <button
        className="switch-btn"
        onClick={() => setIs3D(!is3D)}
      >
        {is3D ? "Switch to 2D" : "Switch to 3D"}
      </button>

      {!is3D ? (
        <arcgis-map
          item-id={webMapId}
          class="map-view"
        >
          <arcgis-zoom slot="top-left"></arcgis-zoom>
        </arcgis-map>
      ) : (
        <arcgis-scene
          item-id={webSceneId}
          class="scene-view"
        >
          <arcgis-zoom slot="top-left"></arcgis-zoom>
        </arcgis-scene>
      )}
    </div>
  );
}

export default App;