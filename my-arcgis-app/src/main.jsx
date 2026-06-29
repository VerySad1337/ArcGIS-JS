import React from "react";
import ReactDOM from "react-dom/client";
import ApplicationShell from "./app/ApplicationShell";
import "./styles/gis-theme.css"; // IMPORTANT (your futuristic UI)

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ApplicationShell />
  </React.StrictMode>
);