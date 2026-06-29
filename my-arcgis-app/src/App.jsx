import { useState } from "react";
import RouteInput from "./components/RouteInput";
import RouteMap from "./components/RouteMap";
import { solveRoute } from "./services/routeService";

function App() {
const [is3D, setIs3D] = useState(false);
const [routeGeometry, setRouteGeometry] = useState(null);

const webMapId = "e64141e618654205b8e4849c39f23212";
const webSceneId = "54e3ba44a26243f0867d52bb1cc454fc";

const handleRoute = async (startStr, endStr) => {
try {
const [sx, sy] = startStr.split(",").map(Number);
const [ex, ey] = endStr.split(",").map(Number);

  const start = {
    type: "point",
    longitude: sx,
    latitude: sy
  };

  const end = {
    type: "point",
    longitude: ex,
    latitude: ey
  };

  console.log("Start:", start);
  console.log("End:", end);

  const route = await solveRoute(start, end);

  console.log("Route returned:", route);
  console.log("Route type:", route?.type);

  setRouteGeometry(route);
} catch (error) {
  console.error("Route Error:", error);
}

};

return (
<div className="app">
<button
className="switch-btn"
onClick={() => setIs3D(!is3D)}
>
{is3D ? "Switch to 2D" : "Switch to 3D"}
</button>

  <RouteInput onRoute={handleRoute} />

  <RouteMap
    is3D={is3D}
    webMapId={webMapId}
    webSceneId={webSceneId}
    routeGeometry={routeGeometry}
  />
</div>

);
}

export default App;