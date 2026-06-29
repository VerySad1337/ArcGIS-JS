import { useState } from "react";

export default function RouteInput({ onRoute }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const handleSubmit = () => {
    if (!start || !end) return;
    onRoute(start, end);
  };

  return (
    <div className="route-panel">

      <input
        placeholder="Start location"
        value={start}
        onChange={(e) => setStart(e.target.value)}
      />

      <input
        placeholder="End location"
        value={end}
        onChange={(e) => setEnd(e.target.value)}
      />

      <button
        className="gis-button"
        onClick={handleSubmit}
      >
        Calculate Route
      </button>

    </div>
  );
}