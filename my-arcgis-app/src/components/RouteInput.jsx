import { useState } from "react";
import PropTypes from "prop-types";

export default function RouteInput({ onRoute }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [touched, setTouched] = useState(false);

  const startMissing = touched && !start;
  const endMissing = touched && !end;

  const handleSubmit = () => {
    setTouched(true);
    if (!start || !end) return;
    onRoute(start, end);
  };

  return (
    <div className="route-panel">
      <input
        placeholder="Start location"
        value={start}
        className={startMissing ? "invalid" : undefined}
        aria-invalid={startMissing}
        onChange={(e) => setStart(e.target.value)}
      />

      <input
        placeholder="End location"
        value={end}
        className={endMissing ? "invalid" : undefined}
        aria-invalid={endMissing}
        onChange={(e) => setEnd(e.target.value)}
      />

      {(startMissing || endMissing) && (
        <p className="route-panel-error" role="alert">
          Enter both a start and an end location to calculate a route.
        </p>
      )}

      <button className="gis-button" onClick={handleSubmit}>
        Calculate Route
      </button>
    </div>
  );
}

RouteInput.propTypes = {
  onRoute: PropTypes.func.isRequired
};