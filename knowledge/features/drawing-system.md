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
6. **Layer Styling** – `LayerControlPanel` exposes, behind a per-layer chevron toggle, one color/border control block per distinct symbol type present in `drawLayer` (see `knowledge/index.md`'s Layer Styling System). `engine.getLayers()` scans `drawLayer.graphics` and returns one `styleGroups` entry per symbol type found (`simple-marker`/`simple-line`/`simple-fill`), so points, lines, and polygons drawn together each get independent controls instead of the whole layer being styled off one arbitrarily-chosen graphic. `engine.setLayerStyle("drawings", { color, borderWidth, outlineColor, symbolType })` only restyles the graphics whose `symbol.type` matches the given `symbolType`. This only affects existing graphics — it does not change the default symbol `SketchViewModel` applies to newly drawn or uploaded features.
7. **Post-draw refresh** – Because a `SketchViewModel` "create" only finishes asynchronously (after the user completes the sketch), `GISMapEngine` invokes an `onDrawingsChanged` callback (registered via `setOnDrawingsChanged`) once the graphic completes. `ApplicationShell` wires this to `refreshLayers()`, so a newly drawn graphic's style group appears in the panel immediately rather than waiting for an unrelated action (toggle/reorder) to trigger the next refresh.

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

## SketchViewModel Lifecycle Across 2D/3D Switches
`attachToView` destroys the previous `SketchViewModel` (`cancel()` then `destroy()`) before constructing the new one bound to the incoming view. Previously the old instance was simply overwritten, leaving it alive and bound to a view that React was about to unmount; a sketch left mid-creation (line/polygon, before the final vertex) was never committed to `drawLayer`, since SketchViewModel only adds its graphic on the "complete" state. `ApplicationShell.toggleViewMode` also calls `engine.cancelDraw()` (surfacing a toast) before switching `is3D` if `activeDrawType` is set, so an in-progress sketch is deliberately cancelled instead of being silently lost mid-switch. Completed drawings (already added to `drawLayer`) are unaffected by this and continue to persist via the existing capture/re-add logic in `attachToView`.

## Permanent Fix: Completed Drawings Vanishing on 2D/3D Switch (detachFromView)
The SketchViewModel fix above only protects an in-*progress* sketch. Completed drawings (already committed to `drawLayer`) were still vulnerable to a separate, more severe bug: switching `is3D` causes React to unmount the outgoing `<arcgis-map>`/`<arcgis-scene>` custom element, and that element destroys its own ArcGIS `Map` on unmount. `Map#destroy()` cascades to `destroy()` on every layer still attached to it — including `drawLayer`, which is otherwise a persistent, engine-owned `GraphicsLayer` meant to survive view swaps. Once destroyed, a layer is permanently unusable and its graphics are gone for the rest of the session; this is not a transient rendering glitch, it is data loss. `attachToView`'s own `map.removeAll()` runs too late to prevent this, because it only executes once the *incoming* view reports ready — and the outgoing element's unmount (and thus its `Map#destroy()`) is not ordered to wait for that.

Fix: `GISMapEngine.detachFromView()` calls `this.currentMap?.removeAll()` (detach only, not destroy) and is invoked from `ApplicationShell.toggleViewMode` synchronously, before the `setIs3D(next)` call that triggers the unmount. This pulls all engine-owned layers off the doomed map before React ever tears it down, so they survive independently of whether (or how quickly) the new view becomes ready. See `knowledge/architecture.md`'s "2D/3D Synchronization" section for the full root-cause writeup.

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
