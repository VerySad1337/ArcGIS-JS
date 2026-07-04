# Knowledge Index

This file provides a high-level overview of the major subsystems in the ArcGIS JavaScript application.

## Drawing System

**Purpose:** Enables users to create point, line, and polygon graphics on the map.

**Key Files:**
- `src/gis/GISMapEngine.js` – Core drawing logic (`startPointDraw`, `startLineDraw`, `startPolygonDraw`, `getDrawnFeatures`, etc.).
- `src/components/FloatingDrawTools.jsx` – UI for invoking draw actions and handling file uploads.
- `src/components/GISMapView.jsx` – Hosts the map view that receives drawn graphics.

## Upload System

**Purpose:** Imports GeoJSON files and adds their features to the drawing layer.

**Key Files:**
- `src/gis/GISMapEngine.js` – `uploadGeoJSON` method (parses GeoJSON, creates `Graphic` objects, and adds them to `drawLayer`).
- `src/components/FloatingDrawTools.jsx` – File input handling that calls `uploadGeoJSON`.
- `src/app/ApplicationShell.jsx` – Wrapper `uploadGeoJSON` function that forwards files to the engine.

## Routing System

**Purpose:** Calculates and renders routes between two addresses.

**Key Files:**
- `src/app/ApplicationShell.jsx` – `handleRoute` orchestrates geocoding and routing service calls, then invokes `engineRef.current.drawRoute` and `drawStops`.
- `src/services/RoutingService.js` – Performs route computation.
- `src/services/GeocodingService.js` – Resolves address strings to coordinates.

## Heatmap System

**Purpose:** Displays a heatmap layer representing point density.

**Key Files:**
- `src/gis/GISMapEngine.js`
  - `enableHeatmap`
  - `disableHeatmap`
  - `updateHeatmapIntensity`
  - Heatmap renderer configuration (`type: "heatmap"`, `colorStops`, `radius`, `maxPixelIntensity`)
- `src/hooks/useHeatmapAnalysis.js` – Hook exposing heatmap state for UI components.
- `src/app/ApplicationShell.jsx` – UI controls that forward heatmap actions to the engine.

## MRT Layer System

**Purpose:** Visualizes MRT stations and lines as separate feature layers.

**Key Files:**
- `src/config/ArcGISConfiguration.js` – MRT feature service URLs (`MRT_STATION_FEATURE_LAYER_URL`, `MRT_LINE_FEATURE_LAYER_URL`).
- `src/gis/GISMapEngine.js`
  - MRT station and line layer creation
  - Custom renderers
  - Visibility controls (`mrtStationVisible`, `mrtLineVisible`)

## 2D / 3D View System

**Purpose:** Switches between 2D map and 3D scene views.

**Key Files:**
- `src/components/GISMapView.jsx` – Renders `<arcgis-map>` for 2D mode or `<arcgis-scene>` for 3D mode based on the `is3D` prop.
- `src/app/ApplicationShell.jsx`
  - `is3D` state management
  - View mode controls (`setIs3D`)
  - Uses `WEBMAP_ID` and `WEBSCENE_ID` from `src/config/ArcGISConfiguration.js`