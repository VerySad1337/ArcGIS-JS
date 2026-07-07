# Architecture Overview

This document describes the architecture of the ArcGIS JavaScript application as derived from the files referenced in `knowledge/index.md`. It is architecture-focused only; it does not describe implementation details, method bodies, or code-level walkthroughs.

Source files consulted (all referenced by the index and available):

- `src/gis/GISMapEngine.js`
- `src/components/FloatingDrawTools.jsx`
- `src/components/GISMapView.jsx`
- `src/app/ApplicationShell.jsx`
- `src/services/RoutingService.js`
- `src/services/GeocodingService.js`
- `src/hooks/useHeatmapAnalysis.js`
- `src/config/ArcGISConfiguration.js`
- `src/components/LayerControlPanel.jsx`
- `src/components/FeatureAttributesPanel.jsx`

No referenced files were missing.

---

## System Overview

The application is organized around a single orchestrating component, `ApplicationShell`, which owns top-level UI state and holds the sole instance of `GISMapEngine`. `GISMapEngine` is the central architectural authority for map state: it owns all map layers, graphics, and the drawing tool (`SketchViewModel`), and exposes methods that the shell and UI components call into.

The system separates concerns along three lines:

- **Presentation** — `GISMapView`, `FloatingDrawTools`, and related panel components render UI and forward user actions upward or into the engine.
- **Orchestration** — `ApplicationShell` wires UI state (view mode, route state, heatmap state, layer list) to engine calls and re-renders derived state after engine mutations.
- **Domain / Map Engine** — `GISMapEngine` encapsulates all ArcGIS map, layer, and graphics logic in one class, acting as the boundary between the React component tree and the ArcGIS JS API.

Supporting services (`RoutingService`, `GeocodingService`) are stateless modules that wrap ArcGIS REST APIs and are consumed directly by `ApplicationShell`, not by the engine. Configuration (`ArcGISConfiguration.js`) centralizes all external endpoint URLs and portal item IDs used across the engine, shell, and services.

---

## GISMapEngine Architecture

`GISMapEngine` is a plain (non-React) class instantiated once per application session via a `useRef` in `ApplicationShell`, ensuring a stable identity across re-renders. Its responsibilities:

- **Map/view binding** — `attachToView` binds the engine to a live ArcGIS `MapView`/`SceneView`, constructing and registering all layers against the view's map.
- **Layer ownership** — the engine holds direct references to every layer in the application (route, stops, tourist attractions, heatmap, MRT stations, MRT lines, drawings) as instance fields, rather than delegating layer state to React or to the view.
- **State retention across view swaps** — graphic state (route graphic, stop graphics, drawn features) is retained on the engine instance itself, independent of the view, so it can be restored when the engine reattaches to a new view.
- **Drawing tool integration** — a single `SketchViewModel` is created per `attachToView` call, bound to the engine's dedicated drawing layer (`drawLayer`).
- **Upload integration** — GeoJSON upload logic reads into the same `drawLayer` used by interactive sketching, unifying manual drawings and uploaded features under one graphics layer.

The engine is the only part of the system that imports ArcGIS layer and graphic classes directly (`Graphic`, `GraphicsLayer`, `FeatureLayer`, `SketchViewModel`), as well as the identity/request primitives used for hosted-layer schema edits (`IdentityManager`, `esriRequest`). This makes it the architectural seam between the UI layer and the ArcGIS JS API surface.

---

## Layer Management

The engine manages a fixed, named set of layers, tracked through a `layerOrder` array of layer identifiers:

- `route`
- `stops`
- `touristAttractions`
- `heat`
- `mrtStations`
- `mrtLines`
- `drawings`

Architectural characteristics of layer management:

- **Ordering as data** — layer draw order is represented explicitly as an array of IDs rather than being implicit in creation order. Reordering operations mutate this array and then re-apply order against the live map.
- **ID-to-layer indirection** — layer visibility, reordering, and enumeration all resolve through an ID-to-layer lookup map constructed at call time, decoupling the public layer identifiers from the underlying engine fields.
- **Layer types** — `route` and `stops` are `GraphicsLayer` instances populated by the engine directly; `touristAttractions`, `heat`, `mrtStations`, and `mrtLines` are `FeatureLayer` instances backed by external feature service URLs from `ArcGISConfiguration.js`; `drawings` is a `GraphicsLayer` shared between sketching and uploads.
- **Visibility state** — each layer's visibility is tracked both on the engine (`routeVisible`, `heatVisible`, `touristAttractionVisible`, `mrtStationVisible`, `mrtLineVisible`) and reflected onto the corresponding ArcGIS layer's `visible` property.
- **Renderer configuration** — Tourist Attractions, MRT, and heatmap layers carry renderer configuration (a simple `simple-marker` renderer for Tourist Attractions, simple renderers for MRT stations/lines, a heatmap renderer with color stops and intensity bounds) defined at layer construction time inside the engine.
- **UI exposure** — `getLayers()` projects internal layer state into a plain list consumed by `ApplicationShell` and layer control UI (`LayerControlPanel.jsx`), keeping the ArcGIS layer objects themselves out of the component tree.
- **Runtime styling** — `setLayerStyle(id, { color, borderWidth, outlineColor, symbolType })` lets the layer panel mutate a layer's color/outline-width after construction, for layers with at least one coherent symbol to restyle (`route`, `touristAttractions`, `mrtStations`, `mrtLines`, `drawings`). It clones the existing renderer/graphic symbol and reassigns it — the same clone-then-reassign pattern `updateHeatmapIntensity` already uses for the heatmap renderer — rather than introducing a second renderer-mutation mechanism. `getLayers()` surfaces each stylable layer's symbols as a `styleGroups` array (via `symbolToStyleGroup`) so the panel can initialize its inputs; `drawings` can yield multiple groups (one per distinct point/line/polygon symbol type actually present in the shared `drawLayer`), while the single-renderer layers always yield exactly one. Layers without a well-defined symbol (`stops`, `heat`) return an empty `styleGroups` and are not stylable from the panel. `outlineColor` only applies to `simple-fill` (polygon) groups, and `symbolType` scopes a `drawings` update to graphics of just that geometry type.

---

## Drawing Lifecycle

The drawing system is built around a single dedicated `drawLayer` (`GraphicsLayer`, titled "Drawings") and a single `SketchViewModel` bound to it.

Lifecycle stages:

1. **Initialization** — on `attachToView`, the engine captures any drawings already present on `drawLayer` before the map is reset (`map.removeAll()`), then recreates the `SketchViewModel` against the (persistent) `drawLayer` and the new view.
2. **Persistence across reattachment** — existing drawings are read off `drawLayer` prior to view teardown and re-added after the layer is reconstituted, so drawings survive view/map reinitialization (e.g., 2D/3D switches).
3. **Interactive creation** — `FloatingDrawTools` invokes shell-level handlers (`drawPoint`, `drawLine`, `drawPolygon`) which call into the engine's draw-start methods, which in turn drive the `SketchViewModel` to create point, polyline, or polygon geometry.
4. **Upload-based creation** — `FloatingDrawTools` also exposes a file input for GeoJSON upload; selected files are passed up through `ApplicationShell` to the engine's upload handling, which adds resulting graphics into the same `drawLayer` used for interactive drawing, and repositions the view over the drawings layer.
5. **Export** — drawn and uploaded features (along with route/stop graphics) can be collected and exported as a GeoJSON file download, sourced from the same feature-collection logic that reads all engine-tracked graphics.
6. **Elevation/ground alignment** — the drawings layer is explicitly configured with ground-relative elevation info as part of the attach flow, applying to both interactively drawn and uploaded features.

Drawings, once created, are represented as ArcGIS `Graphic` objects tracked only inside the engine; `ApplicationShell` and UI components do not hold direct references to drawn geometry.

---

## Feature Attribute Selection

Attribute selection and editing is another engine-owned concern that surfaces through the shell into a dedicated panel.

- **Engine-owned click handling** — the engine registers a single `view.on("click")` handle (`clickHandle`) per `attachToView`, removing any prior handle first so handlers do not accumulate across 2D/3D reattachments. This keeps view-event ownership inside the engine, consistent with its role as the ArcGIS API seam.
- **Selection via hitTest, scoped by layer** — `handleFeatureClick` runs `hitTest` restricted to the four selectable layers (`touristAttractions`, `mrtStations`, `mrtLines`, and the shared `drawings` layer); `route` and `stops` graphics are deliberately outside the selectable set. The engine resolves the hit layer back to a string id (`resolveLayerId`) and caches the selected graphic and its layer id on the engine instance.
- **Callback-based UI notification** — rather than holding React state, the engine invokes an `onFeatureSelect` callback (registered by the shell via `setOnFeatureSelect`) with a plain descriptor (`layerId`, `layerTitle`, `objectIdField`, `attributes`, screen `x`/`y`). This mirrors the `onDrawingsChanged` callback pattern and keeps the engine free of the component tree.
- **Two-tier edit model** — attribute edits and new columns are applied differently by layer backing: for the local `drawings` layer they mutate in-memory graphic attributes / a client-side field list (`drawingFields`); for the hosted `FeatureLayer`s they go through service operations (`applyEdits` for value edits, an `addToDefinition` REST call authenticated via `IdentityManager` for new columns). The engine centralizes this branching (`updateSelectedFeatureAttributes`, `addColumnToLayer`, `hostedLayerById`); the shell only forwards user intent and shows toasts.
- **Presentation isolation** — `FeatureAttributesPanel` is a self-contained popup positioned from the click coordinates; it owns only local edit/draft UI state and communicates outward through `onSaveAttributes`/`onAddColumn`/`onClose` props, keeping ArcGIS concerns out of the component.

---

## 2D/3D Synchronization

View-mode switching is owned by `ApplicationShell` via an `is3D` boolean state value, sourced from `ArcGISConfiguration.js`'s `WEBMAP_ID` (2D) and `WEBSCENE_ID` (3D) identifiers.

- **View selection** — `GISMapView` renders either an `<arcgis-map>` (2D) or `<arcgis-scene>` (3D) custom element based on the `is3D` prop, each bound to its respective portal item ID.
- **Single ready callback** — both the map and scene elements report readiness through the same `onViewReady` callback path, which resolves to the underlying ArcGIS `view` object regardless of 2D/3D mode.
- **Engine reattachment** — each time a view becomes ready (including on 2D/3D mode switches, which unmount one custom element and mount the other), `ApplicationShell` calls `engineRef.current.attachToView(view)` again, causing the engine to rebuild all layers and the sketch tool against the new view.
- **State continuity mechanism** — because layer visibility flags, route/stop graphics, and drawn features are retained as fields on the persistent `GISMapEngine` instance (not on the view or map), synchronization between 2D and 3D is achieved by re-deriving map/layer/graphic state from the engine on every reattachment rather than by transferring state directly between the two ArcGIS view types.
- **Camera/extent continuity** — `attachToView` captures the outgoing view's `extent` (read off `this.currentView` before it is overwritten with the incoming view) and, once the new view's layers are attached, calls `view.goTo(previousExtent)`. Without this, each `<arcgis-map>`/`<arcgis-scene>` mount would default to its portal item's baked-in initial extent, making a 2D/3D switch appear to discard the user's current pan/zoom position (and anything they had drawn there, since it would fall outside the new default view). `goTo` accepts an `Extent` for both `MapView` and `SceneView`, so one code path covers both switch directions; the first-ever `attachToView` call (initial page load) has no previous view, so `previousExtent` is `undefined` and the `goTo` is skipped. Covered by two dedicated unit tests in `GISMapEngine.test.js` (see `knowledge/index.md`'s Testing System section).
- **Renderer continuity for rebuilt FeatureLayers** — `touristAttractionLayer`, `mrtStationLayer`, and `mrtLineLayer` are `FeatureLayer` instances, so (unlike the persisted `routeGraphic`/`drawLayer` graphics) they are fully reconstructed on every `attachToView` call. Their renderers are therefore not retained by surviving on the layer object itself; instead `touristAttractionRenderer`/`mrtStationRenderer`/`mrtLineRenderer` fields on the engine are the actual source of truth for their styling. `attachToView` seeds each new `FeatureLayer` from the corresponding field, and `setLayerStyle` writes the cloned/mutated renderer back to that same field (in addition to the live layer's `renderer`), so runtime style changes survive a 2D/3D switch instead of resetting to the hardcoded construction defaults.

---

## Component Relationship Diagram

```
ArcGISConfiguration.js
   (portal IDs, service URLs)
        |
        |  imported by
        v
+--------------------------+        +----------------------------+
|      ApplicationShell    |<------>|   RoutingControlPanel /    |
|  (owns is3D, routeOn,    |        |   LayerControlPanel /      |
|   heatOn, layers, toast) |        |   (UI state consumers)     |
+--------------------------+        +----------------------------+
   |        |        |     
   |        |        | renders
   |        |        v
   |        |   +----------------+
   |        |   |  GISMapView    |
   |        |   |  (arcgis-map / |
   |        |   |   arcgis-scene)|
   |        |   +----------------+
   |        |        |
   |        |        | onViewReady(view)
   |        |        v
   |        |   attachToView(view)
   |        v
   |   +---------------------------+
   |   |      GISMapEngine         |
   |   |  - layer ownership        |
   |   |  - drawLayer + SketchVM   |
   |   |  - route/stop graphics    |
   |   |  - upload handling        |
   |   +---------------------------+
   |        ^
   |        | drawPoint/drawLine/drawPolygon,
   |        | saveGeoJSON, uploadGeoJSON
   |        |
   |   +----------------------+
   +-->|  FloatingDrawTools   |
       |  (draw + upload UI)  |
       +----------------------+

RoutingService.js  <-- solveRoute() --  ApplicationShell.handleRoute
GeocodingService.js <-- geocodeAddress() -- ApplicationShell.handleRoute
   (results passed into engine.drawRoute / engine.drawStops)

useHeatmapAnalysis.js
   (standalone hook exposing heatmapEnabled/toggleHeatmap;
    not wired into ApplicationShell's heatmap state in the
    reviewed files)
```

---

## Key Architectural Decisions

- **Single mutable engine instance as source of truth.** All map/layer/graphic state lives on one `GISMapEngine` instance held via `useRef`, rather than in React state, so that ArcGIS objects persist independently of component re-renders.
- **Reattachment-based synchronization instead of direct view-to-view transfer.** Switching between 2D and 3D is handled by tearing down and rebuilding layers against whichever view becomes ready, with continuity supplied by engine-held state rather than by ArcGIS-level state transfer between map and scene views.
- **Unified drawings layer for manual and uploaded geometry.** Interactive sketch output and uploaded GeoJSON features are both bound to the same `drawLayer`, making it the single structure that must be preserved for both drawing persistence and upload persistence.
- **ID-based indirection for layer operations.** Layer visibility, ordering, and enumeration operate over string identifiers and lookup maps rather than direct object references, decoupling the public layer-control surface from the engine's internal field names.
- **Centralized configuration boundary.** All external service URLs and portal item IDs are defined once in `ArcGISConfiguration.js` and consumed by the engine, routing/geocoding services, and the shell, establishing a single point of change for endpoint configuration.
- **Services as stateless functions, not engine members.** `RoutingService` and `GeocodingService` are invoked directly from `ApplicationShell` rather than from `GISMapEngine`; the engine only receives already-resolved geometry (via `drawRoute`/`drawStops`), keeping routing/geocoding concerns outside the map-engine boundary.
- **Presentation components remain ArcGIS-agnostic where possible.** `FloatingDrawTools` and `GISMapView` operate on callback props and portal IDs rather than importing ArcGIS domain classes directly, concentrating ArcGIS API usage in the engine and view-hosting component.

---

*Generated from files referenced in `knowledge/index.md` only. No unreferenced files were read or analyzed.*
