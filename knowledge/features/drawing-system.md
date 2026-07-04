---
name: drawing-system
description: Concise documentation of the ArcGIS JS Drawing System implementation
metadata:
  type: reference
---

# Drawing System

## Architecture
- **GISMapEngine (src/gis/GISMapEngine.js)**
  - Central class managing map interactions.
  - Holds a `GraphicsLayer` named **Drawings** (`this.drawLayer`).
  - Uses **SketchViewModel** (`this.sketchVM`) to create point, polyline, and polygon graphics on the draw layer.
  - Exposes high‑level methods:
    - `startPointDraw / startLineDraw / startPolygonDraw` – initiate SketchViewModel create mode.
    - `getDrawnFeatures` – collects graphics from the draw layer plus route/start/end graphics.
    - `saveDrawings` – serialises collected graphics to a GeoJSON `FeatureCollection` and triggers a browser download.
    - `uploadGeoJSON` – parses a GeoJSON file, creates corresponding `Graphic` objects, adds them to the draw layer, and pans the view to the new layer.
  - Manages layer ordering, visibility toggles, heatmap and MRT layers (not directly part of drawing but co‑located).

- **FloatingDrawTools (src/components/FloatingDrawTools.jsx)**
  - Small UI component rendering FAB buttons for:
    - Point, line, polygon draw actions.
    - Export (GeoJSON) and import (file input) of drawings.
  - Calls callback props supplied by the surrounding **ApplicationShell**.

- **GISMapView (src/components/GISMapView.jsx)**
  - Renders either `<arcgis-map>` (2‑D) or `<arcgis-scene>` (3‑D) based on the `is3D` prop.
  - Emits `arcgisViewReadyChange` which is forwarded to `ApplicationShell`.

- **ApplicationShell (src/app/ApplicationShell.jsx)**
  - Instantiates a single `GISMapEngine` via a `ref` (`engineRef`).
  - Passes engine methods to `FloatingDrawTools` and handles the view ready event to `engineRef.current.attachToView(view)`.
  - Updates UI state (`layers`, `toast`) based on engine callbacks.

## Workflow
1. **Map Initialization** – When the map view becomes ready (`handleViewReady`), `engine.attachToView(view)` creates base layers (route, stop, tourist attractions, MRT, heat, draw) and attaches a `SketchViewModel` bound to the draw layer.
2. **User Drawing** – Clicking a FAB button triggers `engine.start*Draw()`, which calls `SketchViewModel.create()` for the chosen geometry type. The user sketches on the map; the resulting `Graphic` is automatically added to `drawLayer`.
3. **Export** – `FloatingDrawTools`’s *GeoJSON* button calls `engine.saveDrawings(msg)`. The method:
   - Calls `getDrawnFeatures()` to collect graphics.
   - Converts each graphic’s geometry to a simple GeoJSON geometry (`toGeoJSONGeometry`).
   - Packs them into a `FeatureCollection` and triggers a download via an anchor element.
4. **Import** – Selecting a file triggers `handleFileUpload` → `engine.uploadGeoJSON(file)`:
   - Parses the file, maps each GeoJSON feature to an ArcGIS `Graphic` with appropriate symbol.
   - Adds all graphics to the draw layer (`addMany`).
   - Stores a reference in `uploadedLayers` and pans the view to the new graphics.
5. **Layer Management** – `ApplicationShell` can toggle visibility, reorder, and query layer states via `engine.getLayers()`, `engine.toggleLayer(id)`, and `engine.reorderLayers()`.
6. **Layer Styling** – `LayerControlPanel` exposes a color picker and border-thickness input for the Drawings layer (see `knowledge/index.md`'s Layer Styling System). `engine.setLayerStyle("drawings", { color, borderWidth })` iterates every graphic in `drawLayer` and restyles it according to its own symbol type (`simple-marker` for points, `simple-line` for polylines, `simple-fill` for polygons), since the layer holds mixed geometry types rather than one shared renderer. This only affects existing graphics — it does not change the default symbol `SketchViewModel` applies to newly drawn or uploaded features.

## Dependencies
- **ArcGIS Core SDK** (`@arcgis/core`):
  - `Graphic`, `GraphicsLayer`, `FeatureLayer` for rendering.
  - `SketchViewModel` for interactive drawing.
- **Configuration** (`src/config/ArcGISConfiguration.js`):
  - API key, feature‑service URLs (heatmap, MRT layers) – required at engine construction.
- **React** for UI components (`FloatingDrawTools`, `GISMapView`, `ApplicationShell`).
- **Browser APIs**: `URL.createObjectURL`, `<a>` download, `<input type="file">`.

## Attribute Editing & Columns
- Drawn/uploaded graphics are given an `attributes` object at creation (`GISMapEngine.buildDrawingAttributes`), seeded from `this.drawingFields` (a client-side "schema" for the drawings layer) and, for uploads, merged with the source GeoJSON feature's `properties`.
- `drawLayer` is included in `handleFeatureClick`'s selectable layers, so clicking a drawn/uploaded graphic opens `FeatureAttributesPanel` like any other feature.
- `GISMapEngine.updateSelectedFeatureAttributes(updates)` mutates the selected graphic's `attributes` directly (no backing service to persist to).
- `GISMapEngine.addColumnToLayer("drawings", name, type, defaultValue)` appends to `this.drawingFields` and back-fills the new key onto every existing graphic in `drawLayer`. This is in-memory only — it is not a schema on any ArcGIS service and does not survive a reload.

## Limitations
- **Geometry Types** – Only point, polyline, and polygon are supported via SketchViewModel.
- **Spatial Reference** – Upload conversion forces Web Mercator (wkid 3857); other spatial references are not handled.
- **Attribute Persistence Is Session-Only** – `saveDrawings` (GeoJSON export) still writes empty `properties` objects; attribute values entered via the edit panel are not included in the export, and `drawingFields`/graphic attributes are lost on reload.
- **Single Draw Layer** – All user drawings share one `GraphicsLayer`; there is no per‑session or per‑feature isolation.
- **No Undo/Redo** – SketchViewModel’s built‑in editing tools are not exposed; users cannot delete individual graphics after creation (except by clearing the layer via the upload guard).
- **Upload Guard** – New uploads are blocked if any graphics already exist in the draw layer, requiring the user to save first.

## Known Risks
- **Performance Degradation** – Adding many graphics to a single `GraphicsLayer` can slow rendering, especially on older browsers or low‑end devices.
- **Unsanitised GeoJSON** – `uploadGeoJSON` trusts the parsed file structure; malformed or malicious geometry could cause runtime errors or crash the map view.
- **Data Loss** – The upload guard silently aborts if the draw layer is not empty; users may lose unsaved work if they forget to export before uploading.
- **Browser Memory** – `saveDrawings` creates an object URL for the entire GeoJSON payload; large collections could exceed memory limits.
- **Security of API Key** – The ArcGIS API key is injected via `import.meta.env.VITE_ARCGIS_API_KEY` and may be exposed in client bundles; ensure it is restricted to required scopes.

*This documentation focuses on the concrete implementation; UI/UX details (icon layout, styling) are handled in the component JSX and are outside the scope of the drawing system core.*
