import { useState } from "react";

export default function RouteInput({ onRoute }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const handleSubmit = () => {
    onRoute(start, end);
  };

  return (
  <div className="route-panel">
    <input
      placeholder="Start (lon,lat)"
      value={start}
      onChange={(e) => setStart(e.target.value)}
    />

    <input
      placeholder="End (lon,lat)"
      value={end}
      onChange={(e) => setEnd(e.target.value)}
    />

    <button onClick={handleSubmit}>
      Calculate Route
    </button>
  </div>
  );
}