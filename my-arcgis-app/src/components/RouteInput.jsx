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
      placeholder="Start Address / Postal Code"
      value={start}
      onChange={(e) => setStart(e.target.value)}
    />

    <input
      placeholder="End Address / Postal Code"
      value={end}
      onChange={(e) => setEnd(e.target.value)}
    />

    <button onClick={handleSubmit}>
      Calculate Route
    </button>
  </div>
  );
}