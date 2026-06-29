import RouteInput from "./RouteInput";

export default function RouteSearchPanel({
  onRoute
}) {
  return (
    <div className="panel-card">
      <div className="panel-title">
        Route Search
      </div>

      <RouteInput onRoute={onRoute} />
    </div>
  );
}