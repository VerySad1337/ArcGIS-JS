import RouteInput from "./RouteInput";

export default function RoutingControlPanel({
is3D,
setIs3D,
routeOn,
toggleRoute,
heatOn,
toggleHeatmap,
heatIntensity,
updateIntensity,
onRoute
}) {
return (
<>
<div
style={{
position: "absolute",
top: 10,
left: 10,
zIndex: 1000,
background: "white",
padding: 8,
display: "flex",
gap: 10
}}
>
<button onClick={() => setIs3D(!is3D)}>
{is3D ? "2D" : "3D"}
</button>

    <button onClick={toggleRoute}>
      {routeOn ? "Hide Route" : "Show Route"}
    </button>

    <button onClick={toggleHeatmap}>
      {heatOn ? "Hide Heatmap" : "Show Heatmap"}
    </button>

    <input
      type="range"
      min="1"
      max="100"
      value={heatIntensity}
      onChange={(e) =>
        updateIntensity(Number(e.target.value))
      }
    />

    <span>{heatIntensity}</span>
  </div>

  <RouteInput onRoute={onRoute} />
</>

);
}