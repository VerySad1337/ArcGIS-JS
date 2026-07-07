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

## Layer Styling System

**Purpose:** Lets the user change a layer's color and border (outline) thickness directly from the layer panel.

**Key Files:**
- `src/components/LayerControlPanel.jsx` – Layer panel UI. Renders the layer list, visibility toggle, drag-to-reorder, heat intensity slider, and — for stylable layers — a per-layer chevron toggle (collapsed by default) that reveals one style-control block per `styleGroups` entry: a color `<input type="color">` and a border-width `<input type="number">` always, plus a border-color `<input type="color">` when that group's `symbolType` is `simple-fill`. Each control calls `onStyleChange(id, { ...change, symbolType })`.
- `src/gis/GISMapEngine.js`
  - `setLayerStyle(id, { color, borderWidth, outlineColor, symbolType })` – clones the target symbol(s), applies color/border-width/outline-color, and reassigns, following the same clone-then-reassign pattern as `updateHeatmapIntensity`. For the FeatureLayer-backed layers (`touristAttractions`/`mrtStations`/`mrtLines`) the mutated renderer is also written back onto a persisted engine field (`touristAttractionRenderer`/`mrtStationRenderer`/`mrtLineRenderer`) so styling survives an `attachToView` rebuild (2D/3D switch) instead of resetting to construction defaults.
  - `getLayers()` – returns a `styleGroups` array (via `symbolToStyleGroup`) per stylable layer instead of flat `color`/`borderWidth` fields.
- `src/app/ApplicationShell.jsx` – `updateLayerStyle` wrapper that calls `engine.setLayerStyle` and refreshes layer state.

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
- `src/components/FeatureAttributesPanel.jsx` – UI panel rendering the selected feature's layer title and attributes, with an edit mode (value inputs, Save/Cancel) and an "Add Column" form.
- `src/app/ApplicationShell.jsx` – `selectedFeature` state, wiring the engine's selection callback to the panel, `handleSaveAttributes`/`handleAddColumn` wrappers around the engine's edit APIs.

## Responsive Layout System

**Purpose:** Keeps the app shell usable on narrow (mobile) viewports by turning the desktop sidebar into a collapsible overlay drawer and rescaling floating UI so it doesn't overflow the screen.

**Key Files:**
- `src/app/ApplicationShell.jsx` – `sidebarOpen` state, `.sidebar-toggle` button, `.side-panel-backdrop`.
- `src/styles/gis-theme.css` – all rules scoped under `@media (max-width: 768px)` (sidebar drawer, FAB rescale, popup/toast max-width clamps).

See `knowledge/features/responsive-layout.md` for details.

## Testing System

**Purpose:** Unit/component test coverage for the app, run via Jest.

**Key Files:**
- `my-arcgis-app/jest.config.cjs` – Jest configuration (jsdom environment for component tests).
- `my-arcgis-app/babel.config.cjs` – Babel transform config so Jest can process JSX/ESM (Vite normally handles this at dev/build time; Jest needs its own transform pipeline).
- `my-arcgis-app/src/**/*.test.{js,jsx}` – one test file per component/service/hook (`ApplicationShell`, `FeatureAttributesPanel`, `FloatingDrawTools`, `GISMapView`, `HeatmapControlPanel`, `LayerControlPanel`, `RouteInput`, `RouteSearchPanel`, `RoutingControlPanel`, `SidePanel`, `ViewControlPanel`, `GISMapEngine`, `useHeatmapAnalysis`, `useRoutingEngine`, `heatmapLayer`, `GeocodingService`, `RoutingService`).
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