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

**UI:** `RoutingControlPanel.jsx` renders a "VIEW MODE" 2D/3D segmented control (`aria-pressed` on each option, replacing the previous single "Switch to 2D/3D" button), the route search form, and a "Hide/Show Route" button (`toggleRoute`, which also hides/shows the start/end stop markers via `engine.toggleRoute`). `drawStops` gives the start marker a circle style and the end marker a square style (in addition to green/red) so they're distinguishable without relying on color alone.

Heatmap enable/disable and intensity live solely in `LayerControlPanel`'s "Heatmap" row (eye icon + slider, shown only while visible) — there is no separate heatmap control in `RoutingControlPanel`. `ApplicationShell.toggleLayer(id)` special-cases `id === "heat"`: instead of the generic `engine.toggleLayer(id)` (a bare visibility flip used by every other layer), it calls the same `toggleHeatmap()` that used to back a since-removed RoutingControlPanel button, which goes through `engine.enableHeatmap`/`disableHeatmap`. This matters because those methods also clone/apply the intensity renderer and keep the engine's `heatVisible` field in sync — a bare `layer.visible = x` flip (what the generic path does) would leave `heatVisible` stale and reset heatmap visibility incorrectly on the next 2D/3D reattachment (see `knowledge/architecture.md`'s 2D/3D Synchronization section).

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

## Layer Styling System

**Purpose:** Lets the user change a layer's color and border (outline) thickness directly from the layer panel.

**Key Files:**
- `src/components/LayerControlPanel.jsx` – Layer panel UI. Renders the layer list, visibility toggle, drag-to-reorder, heat intensity slider, and — for stylable layers — a per-layer chevron toggle (collapsed by default) that reveals one style-control block per `styleGroups` entry: a color `<input type="color">` and a border-width `<input type="number">` always, plus a border-color `<input type="color">` when that group's `symbolType` is `simple-fill`. Each control calls `onStyleChange(id, { ...change, symbolType })`.
- `src/gis/GISMapEngine.js`
  - `setLayerStyle(id, { color, borderWidth, outlineColor, symbolType })` – clones the target symbol(s), applies color/border-width/outline-color, and reassigns, following the same clone-then-reassign pattern as `updateHeatmapIntensity`. For the FeatureLayer-backed layers (`touristAttractions`/`mrtStations`/`mrtLines`) the mutated renderer is also written back onto a persisted engine field (`touristAttractionRenderer`/`mrtStationRenderer`/`mrtLineRenderer`) so styling survives an `attachToView` rebuild (2D/3D switch) instead of resetting to construction defaults.
  - `getLayers()` – returns a `styleGroups` array (via `symbolToStyleGroup`) per stylable layer instead of flat `color`/`borderWidth` fields.
- `src/app/ApplicationShell.jsx` – `updateLayerStyle` wrapper that calls `engine.setLayerStyle` and refreshes layer state.

**Zoom to layer:** Every row in `LayerControlPanel` has a "Zoom to <layer>" button (magnifier icon) that calls `onZoomToLayer(layer.id)` → `ApplicationShell.zoomToLayer` → `engine.zoomToLayer(id, showToast)`, then `refreshLayers()` once the engine call settles. `GISMapEngine.zoomToLayer` resolves the id to the same layer instance `toggleLayer`/`reorderLayers` use.

Two things a naive `view.goTo(layer)` gets wrong, both fixed here:
- **A bare `Layer` is not a valid `goTo` target.** The ArcGIS SDK's `GoToTarget2D`/`GoToTarget3D` union (`views/types.d.ts`) only accepts `Geometry | Geometry[] | Graphic | Graphic[] | Viewpoint | number[]` — never a `Layer` instance. Passing one silently rejects. So `zoomToLayer` targets `layer.graphics.toArray()` for the `GraphicsLayer`-backed layers (`route`, `stops`, `drawings` — checked non-empty first, else an error toast "Nothing to zoom to on this layer yet.") and `layer.fullExtent` (after `load()`, since it's only populated once loading completes) for the `FeatureLayer`-backed layers (`touristAttractions`, `heat`, `mrtStations`, `mrtLines`). `uploadGeoJSON`'s pan-to-upload step had the same bug (`goTo(this.drawLayer)`) and was fixed the same way (`goTo(graphics)`).
- **A hidden layer looks like the button did nothing.** If the target layer is currently toggled hidden, `zoomToLayer` reveals it first (setting both `layer.visible` and the matching engine visibility field, e.g. `mrtStationVisible`, so the reveal survives a 2D/3D reattachment), and `ApplicationShell`'s trailing `refreshLayers()` call updates the panel's eye icon to match.

Both fixes are load-bearing together: a hidden-but-hittable layer still needs a *valid* `goTo` target once revealed, or it still wouldn't zoom. The mocked `FeatureLayer`/`SketchViewModel` test doubles under `test/mocks/arcgis-core/` were extended (`fullExtent`, `load`, `cancel`, `destroy`) to keep exercising the real method calls instead of masking them.

**Stylable layers:** `route`, `touristAttractions`, `mrtStations`, `mrtLines`, `drawings` — each has one coherent symbol to restyle. `touristAttractions` was given an explicit `simple-marker` renderer at layer construction (previously relied on the FeatureLayer service default, which had nothing defined to restyle) so it can be styled the same way as `mrtStations`/`mrtLines`.

**Deliberately excluded:**
- `stops` – start/end markers are intentionally green/red; a shared layer color would erase that distinction.
- `heat` – already has a dedicated intensity control; its color comes from `colorStops`, not a single swatch.

**Style groups:** `getLayers()` exposes styling as a `styleGroups` array per layer rather than a single flat `color`/`borderWidth`, built by `symbolToStyleGroup(symbol, label)`. `route`, `touristAttractions`, `mrtStations`, and `mrtLines` each yield exactly one group (they own a single renderer/graphic symbol). `drawings` is the exception: since `drawLayer` holds heterogeneous graphic types (see Drawing System) with no restriction on what coexists, `getLayers()` scans `drawLayer.graphics` for every distinct symbol type present (`simple-marker`/`simple-line`/`simple-fill`) and returns one style group per type, so points/lines/polygons drawn together each get independent color/border controls instead of the whole layer being styled off one arbitrarily-chosen graphic. `setLayerStyle(id, { color, borderWidth, outlineColor, symbolType })` mirrors this: for `drawings`, passing `symbolType` scopes the update to only graphics of that geometry type. `outlineColor` (a border color distinct from fill color) only applies to `simple-fill` (polygon) groups.

**UI gating:** `LayerControlPanel.jsx` hides all style controls behind a per-layer chevron toggle (collapsed by default) and renders one control block per `styleGroups` entry; polygon groups (`symbolType === "simple-fill"`) get Fill Color + Border Color + Border Width, point/line groups get Color + Border Width.

**Drawings refresh:** because drawing a new graphic is asynchronous (`SketchViewModel` "create" completes after the user finishes sketching), the engine calls `onDrawingsChanged` (registered via `setOnDrawingsChanged`) when a graphic completes, which `ApplicationShell` wires to `refreshLayers()` — without this, the panel's `layers` state would keep serving the pre-drawing snapshot and never show style controls for a just-drawn graphic.

## Feature Attribute Selection System

**Purpose:** Displays a feature's attributes in an on-map panel when the user clicks a feature on a selectable feature layer, and allows editing attribute values or adding a new attribute column.

**Key Files:**
- `src/gis/GISMapEngine.js` – `setOnFeatureSelect`, `handleFeatureClick` (view click handling, `hitTest` against Tourist Attractions/MRT Stations/MRT Lines/Drawings layers), `resolveLayerId`, `hostedLayerById`, `buildDrawingAttributes`, `updateSelectedFeatureAttributes`, `addColumnToLayer`.
- `src/components/FeatureAttributesPanel.jsx` – UI panel rendering the selected feature's layer title and attributes, with an edit mode (value inputs, Save/Cancel) and an "Add Column" form. On selecting a feature (keyed by `layerId:x:y`, not object identity, so an in-place attribute update after Save doesn't refire this), focus moves to the panel's Close button and an `Escape` keydown listener calls `onClose`.
- `src/app/ApplicationShell.jsx` – `selectedFeature` state, wiring the engine's selection callback to the panel, `handleSaveAttributes`/`handleAddColumn` wrappers around the engine's edit APIs.

## Responsive Layout System

**Purpose:** Keeps the app shell usable on narrow (mobile) viewports by turning the desktop sidebar into a collapsible overlay drawer and rescaling floating UI so it doesn't overflow the screen.

**Key Files:**
- `src/app/ApplicationShell.jsx` – `sidebarOpen` state, `.sidebar-toggle` button, `.side-panel-backdrop`. When `sidebarOpen` becomes true, focus moves into `.side-panel` (`tabIndex={-1}` + ref) and an `Escape` keydown listener closes the drawer and returns focus to `.sidebar-toggle`.
- `src/styles/gis-theme.css` – all rules scoped under `@media (max-width: 768px)` (sidebar drawer, FAB rescale, popup/toast max-width clamps, plus enlarged `.layer-reorder-btn`/`.layer-eye-btn`/`.layer-chevron-btn`/`.drag-handle` touch targets). A top-level `@media (prefers-reduced-motion: reduce)` block (not scoped to mobile) disables transitions/animations app-wide for users who request it.

See `knowledge/features/responsive-layout.md` for details.

## Testing System

**Purpose:** Unit/component test coverage for the app, run via Jest.

**Key Files:**
- `my-arcgis-app/jest.config.cjs` – Jest configuration (jsdom environment for component tests).
- `my-arcgis-app/babel.config.cjs` – Babel transform config so Jest can process JSX/ESM (Vite normally handles this at dev/build time; Jest needs its own transform pipeline).
- `my-arcgis-app/src/**/*.test.{js,jsx}` – one test file per component/service/hook (`ApplicationShell`, `FeatureAttributesPanel`, `FloatingDrawTools`, `GISMapView`, `LayerControlPanel`, `RouteInput`, `RoutingControlPanel`, `GISMapEngine`, `useHeatmapAnalysis`, `useRoutingEngine`, `heatmapLayer`, `GeocodingService`, `RoutingService`). `HeatmapControlPanel`, `ViewControlPanel`, `RouteSearchPanel`, and `SidePanel` were removed as dead code — they duplicated logic already hand-rolled inline in `RoutingControlPanel`/`ApplicationShell` and were never imported by any app code.
- `my-arcgis-app/test/mocks/arcgis-core/widgets/Sketch/SketchViewModel.js` – jsdom-safe stub of the real `SketchViewModel`; now includes `cancel`/`destroy` jest mocks (in addition to `create`/`on`/`emit`) since `GISMapEngine.attachToView` calls both on the outgoing instance before creating a new one.
- `my-arcgis-app/sonar-project.properties` – SonarQube scanner config; consumes Jest's `test:coverage` output for static analysis/coverage reporting.

**Scripts (`my-arcgis-app/package.json`):**
- `npm test` – run the suite once.
- `npm run test:watch` – watch mode.
- `npm run test:coverage` – run with coverage (input to `npm run sonar`).

**Known gaps:**
- The Docker build (see `knowledge/deployment.md`) does not run this suite before producing an image.

**Covered:** `GISMapEngine.test.js` has two dedicated tests for the camera/extent continuity behavior in `attachToView` (see 2D/3D View System below, and `knowledge/architecture.md`'s "2D/3D Synchronization" section): `"carries the outgoing view's extent over to the incoming view on reattachment"` (asserts `view2.goTo` is called with `view1`'s `extent` on reattachment) and `"skips goTo on the very first attachToView call, since there is no previous view"` (asserts no `goTo` call when there is no prior view).

## Deployment

**Purpose:** Docker build/run process for producing a production image.

See `knowledge/deployment.md` for details.

## 2D / 3D View System

**Purpose:** Switches between 2D map and 3D scene views.

**Key Files:**
- `src/components/GISMapView.jsx` – Renders `<arcgis-map>` for 2D mode or `<arcgis-scene>` for 3D mode based on the `is3D` prop.
- `src/app/ApplicationShell.jsx`
  - `is3D` state management
  - View mode controls (`setIs3D`)
  - Uses `WEBMAP_ID` and `WEBSCENE_ID` from `src/config/ArcGISConfiguration.js`

**Camera/extent continuity:** `GISMapEngine.attachToView` captures the outgoing view's `extent` before rebuilding, and calls `view.goTo(previousExtent)` once the new view's layers are attached, so a 2D/3D switch keeps the user's current pan/zoom position instead of resetting to the portal item's default extent. See `knowledge/architecture.md`'s "2D/3D Synchronization" section for detail.