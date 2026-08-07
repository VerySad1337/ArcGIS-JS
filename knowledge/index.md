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
- `src/services/GeocodingService.js` – Resolves address strings to coordinates. `geocodeAddress` first normalizes the query via `normalizePostalCodeQuery`: a bare 6-digit input (e.g. `460022`) is prefixed to `S460022`, matching how Singaporeans conventionally write postal codes; an already-`S`-prefixed code or any other query (full address, etc.) passes through unchanged. It then tries the ArcGIS World Geocoding Service first (`geocodeWithEsri`, via `addressToLocations`), biased to Singapore with `countryCode: "SGP"` and a `location` centered on `103.8198, 1.3521` — without this bias, a bare Singapore postal code or short local address has no locale context and the worldwide geocoder can return zero candidates. If Esri finds nothing, it falls back to Nominatim (OpenStreetMap, `geocodeWithNominatim`, `countrycodes=sg`) — chosen specifically because it needs no API key/token at all, unlike OneMap (SLA's Singapore-specific geocoder), which as of 2025-10-01 requires a registered account and bearer-token auth this client-only app has nowhere safe to hold. If both fail, the original Esri error is thrown (not the fallback's), since Esri is the primary geocoder and its failure is the more diagnostic one.

**UI:** `RoutingControlPanel.jsx` renders a collapsed-by-default "ROUTE SEARCH" panel-card (same `panel-title-toggle` chevron pattern as `PortalLayerPanel`) containing the route search form and a "Hide/Show Route" button (`toggleRoute`, which also hides/shows the start/end stop markers via `engine.toggleRoute`). The 2D/3D segmented control (`aria-pressed` on each option) no longer lives inside `RoutingControlPanel` — it is `ViewModeToggle.jsx`, rendered unconditionally at the very top of `ApplicationShell`'s sidebar (above `GlobalSearchPanel`), since switching views is a frequent action independent of routing. `drawStops` gives the start marker a circle style and the end marker a square style (in addition to green/red) so they're distinguishable without relying on color alone.

Heatmap enable/disable and intensity live solely in `LayerControlPanel`'s "Heatmap" row (eye icon + slider, shown only while visible) — there is no separate heatmap control in `RoutingControlPanel`. `ApplicationShell.toggleLayer(id)` special-cases `id === "heat"`: instead of the generic `engine.toggleLayer(id)` (a bare visibility flip used by every other layer), it calls the same `toggleHeatmap()` that used to back a since-removed RoutingControlPanel button, which goes through `engine.enableHeatmap`/`disableHeatmap`. This matters because those methods also clone/apply the intensity renderer and keep the engine's `heatVisible` field in sync — a bare `layer.visible = x` flip (what the generic path does) would leave `heatVisible` stale and reset heatmap visibility incorrectly on the next 2D/3D reattachment (see `knowledge/architecture.md`'s 2D/3D Synchronization section).

## Heatmap System

**Purpose:** Displays a heatmap layer representing point density.

**Key Files:**
- `src/gis/GISMapEngine.js`
  - `enableHeatmap`
  - `disableHeatmap`
  - `updateHeatmapIntensity`
  - Heatmap renderer configuration (`type: "heatmap"`, `colorStops`, `radius`, `maxPixelIntensity`)
- `src/app/ApplicationShell.jsx` – `heatOn`/`heatIntensity` state and the `toggleHeatmap`/`updateIntensity` handlers that forward heatmap actions to the engine. This is the only live heatmap state in the app.

**Not in use:** `src/hooks/useHeatmapAnalysis.js` exports a `useHeatmapAnalysis` hook exposing `heatmapEnabled`/`toggleHeatmap`, but **no application code imports it** — only its own test file does. The shell hand-rolls the equivalent state inline. It is dead code, kept here as a documented fact rather than a recommended entry point; see Dead Code below.

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
- `src/components/LayerControlPanel.jsx` – Layer panel UI. Renders the layer list, visibility toggle, zoom-to-layer, remove (portal layers only), reordering, heat intensity slider, and — for stylable and/or filterable layers — a per-layer chevron toggle (collapsed by default) that reveals up to three independently-collapsible sub-sections, each its own small chevron button: **Symbology** (only for stylable layers — one style-control block per `styleGroups` entry: a color `<input type="color">` and a border-width `<input type="number">` always, plus a border-color `<input type="color">` when that group's `symbolType` is `simple-fill`; each control calls `onStyleChange(id, { ...change, symbolType })`), **Filter**, and **Aggregate** (the latter two only for filterable layers — see the Filter & Aggregate System section below). All three default collapsed so opening a layer's row doesn't dump every control block on the user at once. Reordering has three equivalent input paths — drag-and-drop, per-row Move up/Move down buttons, and `ArrowUp`/`ArrowDown` on the focused drag handle — all converging on `onReorder(from, to)`; the shell mirrors each move into an `aria-live` announcement (see `knowledge/features/ui-feedback.md`). When more than one layer is present, a `.layer-order-note` line above the list tells the user the bottom-most row draws on top of the map — this matches `GISMapEngine.reorderLayers`, which calls `map.reorder(layer, i)` using each id's index in `layerOrder`; a higher index in that collection draws later (on top), so the first row in the panel (`layerOrder[0]`) is actually the bottommost layer on the map and the last row is the topmost.
- `src/gis/GISMapEngine.js`
  - `setLayerStyle(id, { color, borderWidth, outlineColor, symbolType })` – clones the target symbol(s), applies color/border-width/outline-color, and reassigns, following the same clone-then-reassign pattern as `updateHeatmapIntensity`. For the FeatureLayer-backed layers (`touristAttractions`/`mrtStations`/`mrtLines`) the mutated renderer is also written back onto a persisted engine field (`touristAttractionRenderer`/`mrtStationRenderer`/`mrtLineRenderer`) so styling survives an `attachToView` rebuild (2D/3D switch) instead of resetting to construction defaults.
  - `getLayers()` – returns a `styleGroups` array (via `symbolToStyleGroup`) per stylable layer instead of flat `color`/`borderWidth` fields.
- `src/app/ApplicationShell.jsx` – `updateLayerStyle` wrapper that calls `engine.setLayerStyle` and refreshes layer state.

**Zoom to layer:** Every row in `LayerControlPanel` has a "Zoom to <layer>" button (magnifier icon) that calls `onZoomToLayer(layer.id)` → `ApplicationShell.zoomToLayer` → `engine.zoomToLayer(id, showToast)`, then `refreshLayers()` once the engine call settles. `GISMapEngine.zoomToLayer` resolves the id to the same layer instance `toggleLayer`/`reorderLayers` use.

Two things a naive `view.goTo(layer)` gets wrong, both fixed here:
- **A bare `Layer` is not a valid `goTo` target.** The ArcGIS SDK's `GoToTarget2D`/`GoToTarget3D` union (`views/types.d.ts`) only accepts `Geometry | Geometry[] | Graphic | Graphic[] | Viewpoint | number[]` — never a `Layer` instance. Passing one silently rejects. So `zoomToLayer` targets `layer.graphics.toArray()` for the `GraphicsLayer`-backed layers (`route`, `stops`, `drawings`, `searchResult` — checked non-empty first, else an error toast "Nothing to zoom to on this layer yet.") and `layer.fullExtent` (after `load()`, since it's only populated once loading completes) for the `FeatureLayer`-backed layers (`touristAttractions`, `heat`, `mrtStations`, `mrtLines`, and every portal-added layer). The branch is taken on the presence of `layer.graphics`, not on a hardcoded id list, which is why portal layers — whose ids are only known at runtime — get correct behavior without being enumerated anywhere. `uploadGeoJSON`'s pan-to-upload step had the same bug (`goTo(this.drawLayer)`) and was fixed the same way (`goTo(graphics)`).
- **A hidden layer looks like the button did nothing.** If the target layer is currently toggled hidden, `zoomToLayer` reveals it first (setting both `layer.visible` and the matching engine visibility field — `routeVisible`/`touristAttractionVisible`/`heatVisible`/`mrtStationVisible`/`mrtLineVisible`/`searchVisible`, or `portalLayerMeta.visible` for a portal layer — so the reveal survives a 2D/3D reattachment), and `ApplicationShell`'s trailing `refreshLayers()` call updates the panel's eye icon to match.

Both fixes are load-bearing together: a hidden-but-hittable layer still needs a *valid* `goTo` target once revealed, or it still wouldn't zoom. The mocked `FeatureLayer`/`SketchViewModel` test doubles under `test/mocks/arcgis-core/` were extended (`fullExtent`, `load`, `cancel`, `destroy`) to keep exercising the real method calls instead of masking them.

**Stylable layers:** `route`, `touristAttractions`, `mrtStations`, `mrtLines`, `drawings` — each has one coherent symbol to restyle. `touristAttractions` was given an explicit `simple-marker` renderer at layer construction (previously relied on the FeatureLayer service default, which had nothing defined to restyle) so it can be styled the same way as `mrtStations`/`mrtLines`.

**Deliberately excluded:**
- `stops` – start/end markers are intentionally green/red; a shared layer color would erase that distinction.
- `heat` – already has a dedicated intensity control; its color comes from `colorStops`, not a single swatch.
- `searchResult` – transient, single-marker, engine-owned styling; it is replaced on every address search.

**Portal layers are conditionally stylable.** A portal-added `FeatureLayer`'s renderer is service-supplied and can be any shape (unique-value, class-breaks, dictionary, ...), most of which have no single symbol to expose a color/border control for. When the loaded renderer's `type` is `"simple"` (one renderer, one symbol — the same shape `touristAttractions`/`mrtStations`/`mrtLines` already use), `getLayers()` exposes it as a one-entry `styleGroups` array via `symbolToStyleGroup`, exactly like the fixed hosted layers; any other renderer type yields an empty `styleGroups` and the row falls back to just its remove control. `setLayerStyle`'s `default` case handles this generically off `this.portalLayers.get(id)` rather than a hardcoded id, since portal layer ids are only known at runtime.
- **Renderer availability timing.** `layer.renderer` is not populated synchronously on a freshly constructed `FeatureLayer` — it arrives once the service's metadata loads. `addPortalLayer` therefore `await`s `layer.load()` before returning, so the very first `getLayers()` call after it resolves (the shell's `refreshLayers()`, called immediately after `addPortalLayer` in `ApplicationShell.jsx`) already sees a populated renderer instead of requiring some unrelated later action to trigger a refresh.
- **Persistence across 2D/3D reattachment.** Like `touristAttractionRenderer`/`mrtStationRenderer`/`mrtLineRenderer`, a portal layer's styled renderer does not survive on the `FeatureLayer` instance itself, since portal `FeatureLayer`s are fully reconstructed on every `attachToView` call (see Portal Layer System below). `portalLayerMeta.get(id).renderer` is the persisted source of truth: `setLayerStyle` writes the cloned/mutated renderer there in addition to the live layer, and `attachToView`'s portal-layer reconstruction reapplies it once the freshly built layer's own `load()` resolves (needed because assigning a renderer before the layer has loaded its own schema/geometry type is unreliable).

Layers with no style groups still render a row (with the chevron hidden via `visibility: hidden`, preserving the row's column alignment).

**Style groups:** `getLayers()` exposes styling as a `styleGroups` array per layer rather than a single flat `color`/`borderWidth`, built by `symbolToStyleGroup(symbol, label)`. `route`, `touristAttractions`, `mrtStations`, and `mrtLines` each yield exactly one group (they own a single renderer/graphic symbol). `drawings` is the exception: since `drawLayer` holds heterogeneous graphic types (see Drawing System) with no restriction on what coexists, `getLayers()` scans `drawLayer.graphics` for every distinct symbol type present (`simple-marker`/`simple-line`/`simple-fill`) and returns one style group per type, so points/lines/polygons drawn together each get independent color/border controls instead of the whole layer being styled off one arbitrarily-chosen graphic. `setLayerStyle(id, { color, borderWidth, outlineColor, symbolType })` mirrors this: for `drawings`, passing `symbolType` scopes the update to only graphics of that geometry type. `outlineColor` (a border color distinct from fill color) only applies to `simple-fill` (polygon) groups.

**UI gating:** `LayerControlPanel.jsx` hides all style controls behind a per-layer chevron toggle (collapsed by default) and renders one control block per `styleGroups` entry; polygon groups (`symbolType === "simple-fill"`) get Fill Color + Border Color + Border Width, point/line groups get Color + Border Width.

**Drawings refresh:** because drawing a new graphic is asynchronous (`SketchViewModel` "create" completes after the user finishes sketching), the engine calls `onDrawingsChanged` (registered via `setOnDrawingsChanged`) when a graphic completes, which `ApplicationShell` wires to `refreshLayers()` — without this, the panel's `layers` state would keep serving the pre-drawing snapshot and never show style controls for a just-drawn graphic.

## Layer Grouping System

**Purpose:** Lets a user create named groups in the layer list and assign any layer (built-in or portal-added) to one, so a related set of layers can be organized, collapsed, and — since the group is enforced as contiguous in the real map draw order — moved together conceptually, without introducing a second layer-ownership concept in the engine.

**Key Files:**
- `src/components/LayerControlPanel.jsx` — the entire feature lives here as component-local state; there are no engine or `ApplicationShell` changes, unlike every other layer-affecting feature in this document. This is deliberate: a group is a *sidebar organization* concept layered on top of `layerOrder`, not a new kind of layer the engine needs to know about.
  - `groups` (`{ id, name }[]`) and `groupByLayerId` (Map of layer id -> group id) are the two pieces of state; both are plain `useState`, so — like `expandedIds`/`openSectionsById` above — groups and their membership are **session-only** and reset on reload. There is no persistence layer (no localStorage), so a saved group can never reference a layer id that no longer exists (e.g. a removed portal layer).
  - A "+ New group name" form (`layer-group-form`) at the top of the panel body creates a group (`addGroup`); once at least one group exists, every layer row grows a `.layer-group-picker` — its own full-width line below the row's `<fieldset>` (a `<select aria-label="Group <name>">` offering "Ungrouped" plus every existing group name, calling `assignLayerGroup(layer, index, groupId)` on change), not one more item competing inside the row's own single line. It has to live on its own line: the row already carries five icon-sized controls (eye, drag, zoom, up/down, chevron), and a `<select>` defaults to a content-based `min-width` (not 0) that a bare `flex-shrink: 1` can't override — so wedging it into that line left it refusing to shrink while `.layer-name` (which does have `min-width: 0`) absorbed the entire deficit and got crushed to a few characters. This shipped once and was fixed once already; see `knowledge/features/responsive-layout.md`'s note on this class of bug if touching this row's layout again.
  - **Grouping moves the layer in the real draw order; ungrouping never does.** Assigning a layer into a group with existing members computes that group's current last member's position and calls the existing `onReorder(from, to)` prop (the same one drag-and-drop and the up/down buttons use) to place the layer immediately after it — so a group's members end up contiguous in `layerOrder` and draw together on the map, without any new engine method. The exact target index accounts for the array-shift `reorderLayers`'s `splice`-based move produces (`indexAfterRemoval` helper). The *first* layer assigned to a brand-new group has no existing members to move next to, so it simply anchors the group at its current position — no reorder call. Removing a layer from its group (`Ungrouped`) only updates `groupByLayerId`; the layer's position in `layerOrder` is left exactly where it was.
  - **Rendering doesn't assume the contiguity it creates is permanent.** A group renders as one collapsible block (`layer-group` / `layer-group-header` / `layer-group-body`) at the position of its first-seen member in a single pass over the real, ordered `layers` list; any later member encountered in that same pass is absorbed into the already-placed block rather than rendered again at its own position. This means an unrelated drag-and-drop that drops a different layer in the middle of a group (bypassing `assignLayerGroup`, since drag/up-down move by raw index with no group awareness) doesn't visually fragment the group in the sidebar, even though the map's real draw order would now have that stray layer sandwiched between the group's members. A brand-new group with zero members is appended at the end of the render list (it isn't reachable via the single-pass walk, since no layer references it yet) so it stays visible and assignable/deletable rather than disappearing until its first member joins.
  - `deleteGroup(groupId)` removes the group and clears `groupByLayerId` for every member — the layers themselves are untouched and simply become ungrouped in place (no reorder).
  - Groups apply uniformly to every layer, including `route`/`stops`/`heat`/`searchResult`, which are excluded from styling and filtering (see above) but have no such restriction here — grouping is purely organizational and orthogonal to a layer's schema or renderer.
  - **A group can change sequence as a unit, the same way an individual layer can.** `buildBlocks()` is the single function both rendering and reordering use to derive the ordered list of "blocks" (a lone ungrouped layer is a one-member block; a group is an N-member block) — reusing it guarantees the up/down buttons operate on exactly what's on screen. The group header's Move up/down buttons (disabled at the ends of the block list, mirroring a layer row's own up/down buttons) call `moveGroup(groupId, direction)`, which finds the group's block index, identifies whichever adjacent block it's swapping with (a lone layer or another group), and calls `swapAdjacentBlocks`/`moveBlockAfter` — pure array-simulation helpers (no engine or React state) that compute the minimal sequence of single-item `[from, to]` moves reproducing the swap, replayed as ordinary `onReorder(from, to)` calls. Because `engine.reorderLayers` mutates `this.layerOrder` synchronously on each call (independent of when React re-renders `LayerControlPanel`'s `layers` prop), a chain of several `onReorder` calls issued back-to-back in one click handler still lands correctly against the engine's real, already-updated order rather than stale props.
  - **Mass visibility control.** Each group header also gets an eye button (disabled when the group is empty) that toggles every member together: `toggleGroupVisibility(members)` treats the group as "visible" if *any* member currently is, and clicking flips to the opposite for the whole group — hide all if any are showing, show all if none are. It only calls the existing bare `onToggle(id)` for members whose current `visible` doesn't already match the target state, so a mixed group doesn't double-toggle a layer that's already correct. This is additive, not exclusive: every member's own per-row eye button keeps working exactly as before, so a user can still show/hide one layer within an otherwise-hidden (or shown) group independently.
  - **Drag-and-drop, in addition to the up/down buttons.** The group header has its own `.drag-handle` (`dragBlockIndex` state, separate from `dragIndex` — the state individual layer rows' own drag-and-drop already uses — so the two can't be confused mid-drag; each drag start clears the other). A drop target can be any other block, not just an adjacent one, so this can't reuse `moveGroup`'s adjacent-only swap; `moveBlockToBlock(sourceBlockIndex, targetBlockIndex)` instead moves the whole source block to sit directly against the target block — after it if the target is further down the list (`moveBlockAfter`), before it if further up (`moveBlockBefore`, a mirror-image helper that processes the block's ids in reverse so they land in the same relative order without needing a "what precedes the very first block" special case). A layer row only participates as a drop target for a *dragged group* when it's a top-level block (rendered directly under `LAYERS`, not nested inside another group's open body) — a member row's own `onDrop` deliberately no-ops for a group drag rather than picking a meaningless "index within a group" target, and lets the native `drop` event bubble to the enclosing `.layer-group`'s own handler, so dropping anywhere on another group's card (header or a member row) still moves the dragged group there.
  - **A CSS class collision made the Move up/down buttons invisible on desktop when this was first shipped.** `.layer-reorder-btns` is `opacity: 0` by default, revealed only by `.layer-row:hover`/`:focus-within` (a deliberate hover-recessed pattern for individual layer rows' controls — see Layer Styling System above). The group header reuses the same class for its own Move up/down buttons but is never a descendant of a `.layer-row`, so without an explicit `.layer-group-header .layer-reorder-btns { opacity: 1; }` override, those buttons rendered permanently invisible — present in the DOM and technically clickable, but with no way for a user to discover or see them. Every component test in `LayerControlPanel.test.jsx` mocks CSS out entirely (`jest.config.cjs`'s `moduleNameMapper`), which is normally correct but meant none of them could catch this; one dedicated test loads the real `gis-theme.css` via a `<style>` tag and asserts on `getComputedStyle(...).opacity` specifically to guard against this class of bug recurring.

**Deliberately excluded:** no group renaming after creation, no nested/sub-groups, no persistence across reload. All three were left out to keep the feature to the sidebar-organization problem it solves; none are precluded by the design if a future need arises.

## Filter & Aggregate System

**Purpose:** Lets a user narrow (filter) and summarize (aggregate) any layer with a real attribute schema — the three fixed hosted layers, the local drawings layer, and any portal-added layers — through one shared vocabulary, computed together so aggregate statistics reflect whatever a layer's active filter currently leaves visible.

**Key Files:**
- `src/gis/LayerFilterExpression.js` — pure, ArcGIS-free logic shared by both evaluation paths: `buildWhereClause(fields, filter)` produces a validated SQL `where` string for a hosted `FeatureLayer`'s `definitionExpression`/`queryFeatures`; `matchesAttributes(attributes, fields, filter)` evaluates the identical filter definition in JS, for the local `drawings` layer, which has no backing service to push a `where` clause to. Kept side by side specifically so the two mechanisms cannot drift into meaning different things for the same filter. Also exports `normalizeFieldType` (collapses the many `esriFieldType*` names to `string`/`number`/`date`/`other`), `operatorsForKind`, `FILTER_OPERATORS`, `FILTER_LOGIC` (`AND`/`OR`), `usableConditions` (drops a half-filled condition row rather than erroring on it), and `describeFilter` (human-readable summary for badges/toasts).
- `src/gis/GISMapEngine.js` — `layerFilters` (Map of id -> filter definition) is the actual source of truth for "is this layer filtered right now"; a hosted layer's `definitionExpression` and the drawings layer's per-graphic `visible` flag are just the two different mechanisms used to *apply* whatever is stored there, both re-derived from the map, never the other way around.
  - `filterableLayerIds()` / `getFilterableLayers()` — every id offered in the UI: `touristAttractions`, `mrtStations`, `mrtLines`, `drawings`, and any portal-added layers. `route`/`stops`/`heat`/`searchResult` are excluded for the same reasons they're excluded from the Layer Styling System above (one unattributed line, two fixed markers, no schema of its own, and a transient single marker respectively).
  - `getLayerFieldSchema(id)` — hosted layers: loads the `FeatureLayer` and normalizes `layer.fields`. Drawings: `drawingsFieldSchema()` merges the explicit client-side `drawingFields` "columns" (see Layer Styling System / Feature Attribute Selection) with property names sampled off the graphics actually present, so upload-derived properties that were never formally added as a column still show up as filterable fields.
  - `setLayerFilter(id, filter)` — validates (throws with a specific message on a bad field/operator/value, same throw-and-let-the-shell-toast convention as `updateSelectedFeatureAttributes`/`addColumnToLayer`/`addPortalLayer`) and applies. A filter with no usable conditions is treated as "clear this layer" rather than an error, so removing the last condition row naturally clears filtering. `clearLayerFilter(id)` removes it outright.
  - `applyFilterToLayer(id, fields, where)` — the one place that knows *how* to apply a filter per layer kind: `layer.definitionExpression = where` for hosted layers, or `graphic.visible = matchesAttributes(...)` per graphic for drawings.
  - **Persistence across 2D/3D reattachment.** The three fixed hosted `FeatureLayer`s (and portal layers) are fully reconstructed on every `attachToView` call (see `knowledge/architecture.md`'s "Renderer continuity for rebuilt FeatureLayers"), so a `definitionExpression` set before a reattachment would otherwise silently reset. `reapplyPersistedFilters()`, called at the end of `attachToView`, re-derives and reassigns it for every id in `layerFilters`. It is fire-and-forget (each layer's fields must load first, and `attachToView` itself stays synchronous, consistent with its existing `goTo`-continuation pattern); a filter that no longer validates against a reloaded schema is dropped rather than left throwing on every future reattachment. The drawings layer needs no such step — `graphic.visible` lives on the graphic objects themselves, which already persist across reattachment the same way drawn geometry does.
  - **New/uploaded graphics respect an already-active drawings filter.** `applyDrawingsFilterToGraphic(graphic, fields?)` is called from the `sketchVM` "create" `complete` handler and from `uploadGeoJSON`, so a feature created after a filter is already active starts correctly hidden/shown instead of always rendering until an unrelated refresh touches it.
  - `getLayerAggregate(id, { field, statistics })` — feature count plus, when a numeric `field` and any of `sum`/`avg`/`min`/`max` are given, those statistics — computed over whatever the layer's currently active filter leaves visible (`count` is always included). Hosted layers: `layer.queryFeatureCount({ where })` plus one `layer.queryFeatures({ where, outStatistics, returnGeometry: false })` call when statistics are requested. Drawings: filters `drawLayer.graphics` client-side with the same `matchesAttributes` predicate and reduces in JS.
  - `runAnalysis(ids, options)` — runs `getLayerAggregate` over the given layer ids and combines them into a grand total. Historically driven from a multi-layer picker (see "Superseded" below); `LayerControlPanel` now always calls it with a single-element `ids` array (one layer at a time) and reads `result.total` for that layer's own count/stats, so the grand-total combination logic is exercised but never actually blends more than one layer's numbers in the current UI.
  - `getLayers()` includes `filterable: true` and `filterDescription` (from `getLayerFilterDescription(id)`, or `null` when inactive) for every filterable layer's entry, so `LayerControlPanel` can show current filter state without separate plumbing.
- `src/components/LayerControlPanel.jsx` — Filter and Aggregate are two of three independently-collapsible sub-sections (`Symbology`/`Filter`/`Aggregate`, each its own small chevron-toggle button) revealed inside a filterable and/or stylable layer's row once that row's own chevron is expanded (see Layer Styling System above for the row-level chevron and `styleGroups`). Opening a row lazily loads that layer's field schema once. The Filter section is a single condition-row builder (field → operator → value, AND/OR combination, Apply/Clear) scoped to that one layer. The Aggregate section is a numeric-field input (datalist suggestions from that layer's own numeric fields) plus sum/avg/min/max checkboxes, calling `onRunAggregate` (`ApplicationShell.runAnalysis`) with a single-layer id array and rendering just that layer's count/stats inline — there is deliberately no cross-layer combined total in this UI (see "Superseded" below).
- `src/app/ApplicationShell.jsx` — `getLayerFields`/`applyLayerFilter`/`clearLayerFilter`/`runAnalysis` wrappers around the engine calls, following the same refresh-layers-and-toast pattern as `updateLayerStyle`/`addPortalLayer`; passed into `LayerControlPanel` as `onGetLayerFields`/`onApplyFilter`/`onClearFilter`/`onRunAggregate`.

**Superseded:** Filter and Aggregate were originally a separate `AnalysisPanel.jsx` sidebar card (collapsed-by-default, rendered below `LayerControlPanel`) with a Filter/Aggregate/Both mode toggle and a multi-layer checklist whose Aggregate mode combined several selected layers into one grand-total row. It was removed and its functionality folded into `LayerControlPanel`'s per-row sections (above) so filter/aggregate controls sit with the layer they act on instead of in a separate card with its own layer-selection UI. The multi-layer combined-total view was deliberately dropped in that move, not preserved elsewhere.

**Security note:** the ArcGIS REST query language has no parameterized-query facility (the same constraint `searchHostedLayer`'s existing `where`-clause construction documents). `buildWhereClause` therefore constrains every value that reaches the clause rather than merely escaping it: field names must match a field on the target layer's own schema *and* a conservative identifier pattern, operators are looked up in a fixed table (the caller's raw token is never interpolated, only the table's own SQL fragment is), numeric values must pass `Number.isFinite`, date values must parse to a real date, and string values are single-quote-escaped and quoted. Anything that fails throws instead of producing a clause.

## Portal Layer System

**Purpose:** Lets the user search an ArcGIS portal (ArcGIS Online, or an Enterprise portal via `esriConfig.portalUrl`) for Feature Service items and add one as a live map layer, using the same toggle/reorder/zoom/remove plumbing as the built-in layers.

**Key Files:**
- `src/services/PortalService.js` – `searchPortalLayers(query, { num })`, a stateless service (same architectural role as `RoutingService`/`GeocodingService`) that wraps the ArcGIS JS API's `Portal`/`PortalQueryParams` classes. Queries are restricted to `type:"Feature Service"` and results with no `url` are filtered out, since those are the only items `GISMapEngine.addPortalLayer` can turn into a `FeatureLayer`.
- `src/gis/GISMapEngine.js`
  - `portalLayers` (Map of id -> live `FeatureLayer`) / `portalLayerMeta` (Map of id -> `{ title, url, visible }`) – the dynamic counterpart to the fixed `layerOrder` set. A portal-added layer's id is `portal_<portalItemId>`.
  - `addPortalLayer(item)` – **async.** Probes the item's service for accessibility (see below), then creates a `FeatureLayer` from the `PortalService` search result, registers it under a `portal_<id>` key, appends that id to `layerOrder`, and adds it to the live map if attached. Adding the same portal item twice returns the existing id instead of duplicating the layer. Rejects if the item has no `url`, or if its service isn't reachable by the current identity.
  - `canAccessPortalService(url)` – the probe. Issues one `esriRequest` with `authMode: "no-prompt"` and treats an `error` in the response body as inaccessible.

**A publicly listed item is not a publicly accessible service.** Portal search returns items by their *item* sharing level, which says nothing about the service behind them. Two common cases both appear in an ordinary `access: "public"` result set:
- **Esri subscription content** (e.g. `esri_dm`'s Living Atlas boundary layers) answers an anonymous request with error **499 "Token Required for subscription content"**. The app's API key does cover this content.
- **Another user's restricted item** answers with **403 even with the app's API key attached** — nothing the app can do without a login as someone with access.

Left unguarded, the `FeatureLayer` load hits that 499/403 and `IdentityManager` answers it by opening its own sign-in modal, so picking the wrong search result makes the whole app appear to demand a login. `canAccessPortalService` probes with `authMode: "no-prompt"` — which fails the request rather than prompting — so the failure stays the app's to report as a toast, and the layer is simply not registered. This is the Portal-layer instance of the rule in `knowledge/features/feature-attributes.md`'s "Never Force a Sign-In".

Note ArcGIS REST reports authorization failures as **HTTP 200 with an error body**, so a resolved promise is not on its own proof of access — the probe checks `response.data.error`, not just that the request settled.
  - `removePortalLayer(id)` – removes the layer from the map and from `portalLayers`/`portalLayerMeta`/`layerOrder`. A no-op for any id the engine didn't add itself (i.e. one of the built-in layers).
  - `buildLayerMap()` – single id-to-layer resolution helper (spreads `portalLayers` in alongside the fixed layers) now shared by `attachToView`, `toggleLayer`, `zoomToLayer`, and `reorderLayers`, replacing four previously-duplicated object literals.
  - `getLayers()` – appends one `{ id, name, visible, removable: true }` entry per portal layer so `LayerControlPanel` can render them like any other row, but with a remove control the built-in layers don't get.
- `src/components/PortalLayerPanel.jsx` – collapsed-by-default search UI (search box + result list with an "Add" button per result), rendered in `ApplicationShell`'s sidebar above `LayerControlPanel`.
- `src/components/LayerControlPanel.jsx` – renders a remove (✕) button per row when `layer.removable` is true, calling `onRemove(layer.id)`.
- `src/app/ApplicationShell.jsx` – `searchPortal` (calls `PortalService.searchPortalLayers`, toasts and returns `[]` on failure), `addPortalLayer` (calls `engine.addPortalLayer`, refreshes layers, toasts success/failure), `removePortalLayer` (calls `engine.removePortalLayer`, refreshes layers).

**Persistence across 2D/3D reattachment:** Like `touristAttractionLayer`/`mrtStationLayer`/`mrtLineLayer`, portal `FeatureLayer` instances are NOT reused across an `attachToView` call — `portalLayerMeta` (title/url/visible) is their real source of truth, and `attachToView` rebuilds `this.portalLayers` from it on every call, consistent with `knowledge/architecture.md`'s "Renderer continuity for rebuilt FeatureLayers" reasoning (a fresh `FeatureLayer` instance is cheap and avoids relying on an instance surviving the outgoing map's destroy cascade).

**Querying (click-to-select and Global Search):** Portal layers ARE wired into `handleFeatureClick`'s selectable-layers list and the Global Search hosted-layer targets (see Global Search System below), using the same generic, schema-agnostic approach `searchHostedLayer` already used for the three built-in hosted layers (introspecting `layer.fields` rather than assuming a fixed schema):
- `handleFeatureClick`'s `selectableLayers` spreads `this.portalLayers.values()` in alongside the built-in hosted/draw layers, so `hitTest` can hit a portal-layer graphic.
- `resolveLayerId(layer)` falls back to scanning `this.portalLayers` (by instance identity) to recover a layer's `portal_<id>` key when it isn't one of the four hardcoded layers.
- `hostedLayerById(layerId)` falls back to `this.portalLayers.get(layerId)`, so both `updateSelectedFeatureAttributes` and `addColumnToLayer` also resolve a selected portal feature's layer correctly — the app doesn't special-case selection vs. editing lookups. Editing a portal layer's feature is still fully gated the same way editing any hosted layer is: `canEditSelectedFeature` in `ApplicationShell.jsx` requires a signed-in user (for anything other than `drawings`), and `updateSelectedFeatureAttributes`/`addColumnToLayer` additionally check the layer's live `capabilities.operations.supportsUpdate` / a found `IdentityManager` credential before attempting a write — so an anonymous or read-only portal layer degrades to a read-only error toast, exactly like the built-in hosted layers, rather than a forced sign-in.
- `searchFeatures`'s `hostedTargets` array appends one entry per live entry in `this.portalLayers`, titled from `portalLayerMeta.get(id).title` (falling back to `layer.title`).

Attribute-editing controls (`Save` / `+ Add Column`) were previously excluded from the design out of caution about unknown schemas, but neither actually assumes a fixed schema — `searchHostedLayer`'s field introspection and `addColumnToLayer`'s user-supplied field name both work against an arbitrary `FeatureLayer`. Nothing about portal layers is excluded from the query/select/edit path anymore; they are excluded only from `getLayers()`'s `styleGroups` styling (see `knowledge/index.md`'s Layer Styling System, "Deliberately excluded" — a service-supplied renderer of unknown shape has no single symbol to expose a color/border control for).

### Portal Sign-In (OAuth)

**Purpose:** Optional ArcGIS OAuth 2.0 sign-in so portal search (above) reflects an authenticated user's own organization/private/group-shared content instead of only public items. Entirely inactive (every function is a no-op / not rendered) unless explicitly configured — the app's pre-existing anonymous-only behavior is the default.

**Key Files:**
- `src/services/AuthService.js` – `isOAuthConfigured()`, `checkSignInStatus()`, `signIn()`, `signOut()`. Wraps `@arcgis/core/identity/{IdentityManager,OAuthInfo}` and `@arcgis/core/portal/Portal`. `OAuthInfo`/`IdentityManager.registerOAuthInfos` are set up once (lazily, on first use) and reused for the rest of the session. Sign-in opens a **popup** (`OAuthInfo({ popup: true })`) rather than redirecting the whole SPA away and back, so in-progress app state (drawings, route, open panels) survives sign-in. `signIn()`/`checkSignInStatus()` both resolve to a plain `{ username, fullName, orgId, thumbnailUrl }` profile (or `null`) by loading a fresh `Portal` against the configured portal URL and reading `portal.user` once `IdentityManager` has a credential.
- `src/config/ArcGISConfiguration.js` – `OAUTH_APP_ID` (from `VITE_ARCGIS_OAUTH_CLIENT_ID`) and `PORTAL_URL` (from `VITE_ARCGIS_PORTAL_URL`, defaulting to `https://www.arcgis.com`). Setting `VITE_ARCGIS_PORTAL_URL` also sets `esriConfig.portalUrl`, so an Enterprise deployment can target its own portal without a code change.
- `src/services/PortalService.js` – its cached `Portal` explicitly targets `PORTAL_URL` (rather than the SDK's no-args default) so it stays aimed at `AuthService`'s sign-in target: once `IdentityManager` holds a credential for that URL, this `Portal`'s `queryItems` requests pick it up automatically (the SDK attaches matching credentials at request time).

  **`authMode` is set explicitly, and `PortalService` now imports from `AuthService`.** This is a deliberate change from the original design, where the two modules were connected only indirectly through `IdentityManager`'s credential store. Searching public portal content must work with no account, and leaving `authMode` to the SDK default hands the SDK the decision of what to do about a missing credential — its answer is to open a sign-in dialog. So the Portal is built with `authMode: "anonymous"` when `AuthService.hasPortalCredential()` is false (it is then *forbidden* from prompting) and `"auto"` when true (use the credential, so results include org/private/group-shared items).

  Because `authMode` is fixed at construction, the instance is **rebuilt whenever that signed-in state changes** rather than being a true once-per-session singleton. Without this, a `Portal` built while anonymous would stay anonymous for the rest of the session and signing in would never widen the search results — a latent bug in the original singleton.
- `src/components/PortalLayerPanel.jsx` – renders a "Signed in as `<fullName>` — Sign out" / "Sign in" row above the search form, but only when `oauthConfigured` is true; renders nothing extra when it's false, so an app with no OAuth client ID configured shows exactly the UI it had before this feature existed.
- `src/app/ApplicationShell.jsx` – on mount, calls `AuthService.checkSignInStatus()` (skipped entirely if `isOAuthConfigured()` is false) to restore a session that survived a page reload, since `IdentityManager` persists credentials in the browser. `handleSignIn`/`handleSignOut` wrap `AuthService.signIn`/`signOut`, updating `signedInUser` state and toasting success/failure.

**Configuration (`.env`, both optional):**
- `VITE_ARCGIS_OAUTH_CLIENT_ID` – the OAuth 2.0 application's Client ID, registered under the target ArcGIS organization (ArcGIS Online: Developer dashboard > OAuth 2.0 > New Application; Enterprise: an Application item registered in Portal). That OAuth application's registered redirect URIs must include this app's deployed URL(s), or the popup sign-in flow will be rejected by the portal - this is configured on the ArcGIS side, not in this codebase.
- `VITE_ARCGIS_PORTAL_URL` – an Enterprise portal's sharing root (e.g. `https://your-enterprise-domain/portal`). Leave unset to use ArcGIS Online.

**Deliberately excluded:** No redirect-based (non-popup) sign-in page/route exists — popup mode was chosen specifically so a full-page OAuth redirect never has to preserve/restore the rest of `ApplicationShell`'s state. There is also no UI to type a custom portal URL at runtime; switching portals is a `.env`/redeploy-time decision, consistent with `ArcGISConfiguration.js`'s existing role as the single point of change for endpoint configuration (see `knowledge/architecture.md`'s "Centralized configuration boundary").

**How to trigger the sign-in flow:**

1. **Register an OAuth 2.0 application** under the target ArcGIS organization to get a Client ID:
   - ArcGIS Online: [developers.arcgis.com](https://developers.arcgis.com/) (signed in with the org account) → **OAuth 2.0 Application** → create one (or reuse an existing one).
   - Enterprise: Portal → Content → **New Item** → **Application** → **OAuth 2.0 Application**.
2. On that application's settings, add a **Redirect URI** matching wherever this app runs (e.g. `http://localhost:5173` for local Vite dev, or the deployed URL in staging/prod). The popup sign-in below is rejected by ArcGIS if the calling origin isn't registered here.
3. Copy the **Client ID** and set it in `my-arcgis-app/.env` (the `.env` inside the Vite project root — Vite does not read one in a parent directory):
   ```
   VITE_ARCGIS_OAUTH_CLIENT_ID=your-client-id-here
   ```
   Optionally also set `VITE_ARCGIS_PORTAL_URL` if targeting an Enterprise portal instead of ArcGIS Online.
4. **Restart the dev server** (`npm run dev`) — Vite only reads `.env` at startup, so an already-running server won't pick up the change.
5. In the app's sidebar, expand **"ADD LAYER FROM PORTAL"** (click its title if collapsed). With a Client ID configured, a row now appears above the search box: *"Sign in to search your organization's shared content"* with a **Sign in** button.
6. Click **Sign in** — a popup opens to the ArcGIS org's login page. After authenticating there, the popup closes automatically and the row updates to *"Signed in as `<name>`"* with a **Sign out** button.
7. From then on (until sign-out, or the browser session's stored credential expires), portal searches in that panel include the signed-in user's org/private/group-shared items, not just public ones. A page reload does not require signing in again — `checkSignInStatus()` restores the session automatically on mount (see `ApplicationShell.jsx` above).

With no Client ID configured (the default), step 5 never shows anything beyond the search box - this flow is entirely opt-in.

## Global Search System

**Purpose:** Lets the user search by typing text into one search box in the sidebar, matching either map feature attributes or a street address, then jump the view to whichever result they pick.

**Key Files:**
- `src/gis/GISMapEngine.js`
  - `searchFeatures(query)` – queries `touristAttractionLayer`/`mrtStationLayer`/`mrtLineLayer`, every live portal-added layer (via `searchHostedLayer`, same field-introspection approach — see Portal Layer System below), and the local `drawLayer` (via `searchDrawings`), returning up to 10 matches per layer.
  - `zoomToSearchResult(result)` – `view.goTo(result.geometry)`, then reuses the `onFeatureSelect` callback (the same one `handleFeatureClick` uses) so picking a search result opens `FeatureAttributesPanel` exactly like clicking the feature on the map would.
  - `zoomToPoint(longitude, latitude)` – `view.goTo` for an address match, plus drops a diamond marker `Graphic` on a dedicated `searchLayer` (part of `layerOrder`, id `searchResult`) so the geocoded point is visibly confirmed on the map, not just centered under the camera. `searchGraphic`/`searchLayer` follow the same persist-on-the-engine, restore-in-`attachToView` pattern as `routeGraphic`/`routeLayer`, so the marker survives a 2D/3D reattachment. Each call replaces the previous marker rather than accumulating one per search. An address match has no backing layer graphic/schema, so (unlike a feature result) it never opens `FeatureAttributesPanel`.
- `src/components/GlobalSearchPanel.jsx` – search box + results dropdown UI, rendered near the top of the sidebar (below the always-visible `ViewModeToggle`, above `LayerControlPanel`). Owns its own `searching`/`searched`/`open` state and a `requestIdRef` guard that discards an in-flight response once a newer search has started, so pressing Enter twice can't leave the older result set rendered. Each result row shows a human-readable layer label (`LAYER_LABELS`, keyed by `layerId` and falling back to `type` for address matches).
- `src/app/ApplicationShell.jsx` – `handleSearch` fans a query out to `engine.searchFeatures` and `GeocodingService.geocodeAddress` in parallel and merges the results; `handleSelectSearchResult` dispatches to `zoomToSearchResult` or `zoomToPoint` based on the result's `type`.

**Feature matching:** `searchHostedLayer` reads each `FeatureLayer`'s own schema (`layer.fields`) to find its string-typed fields, since the app has no hardcoded knowledge of e.g. Tourist Attractions' name field, and builds a `where` clause ORing a case-insensitive `LIKE '%text%'` across all of them. `searchDrawings` does the equivalent client-side over `drawLayer.graphics[].attributes`, since that layer has no backing service to query. Search text is escaped (`'` doubled) before being interpolated into the `where` clause — `queryFeatures` has no parameterized-query option, so this is the closest available equivalent to a parameterized query for the ArcGIS REST query language.

**Address matching:** Reuses `GeocodingService.geocodeAddress` exactly as the Routing System does (see below), consistent with the architecture's rule that stateless services are called from `ApplicationShell`, not from `GISMapEngine`.

**Result selection:** Both selection paths (search result vs. map click) converge on the same `onFeatureSelect` callback, so `FeatureAttributesPanel` doesn't need to know which triggered it. Since a search result has no originating pointer event, `zoomToSearchResult` derives the panel's screen position with `view.toScreen(result.geometry)` after the `goTo` animation completes, instead of the click coordinates `handleFeatureClick` uses.

## Feature Attribute Selection System

**Purpose:** Displays a feature's attributes in an on-map panel when the user clicks a feature on a selectable feature layer, and allows editing attribute values or adding a new attribute column.

**Key Files:**
- `src/gis/GISMapEngine.js` – `setOnFeatureSelect`, `handleFeatureClick` (view click handling, `hitTest` against Tourist Attractions/MRT Stations/MRT Lines/Drawings layers), `resolveLayerId`, `hostedLayerById`, `buildDrawingAttributes`, `updateSelectedFeatureAttributes`, `addColumnToLayer`.
- `src/services/AuthService.js` – `hasPortalCredential()`, the non-prompting credential check that privileged paths gate on.

**Anonymous-first:** viewing attributes never requires an account, and neither `Save` nor `+ Add Column` may trigger a sign-in. Both previously did — `getCredential` prompts unconditionally, and a 403 from `applyEdits` makes `IdentityManager` open the same modal. Editing controls are now gated on `canEdit` and the engine pre-checks with `findCredential`/`capabilities.operations.supportsUpdate`. See `knowledge/features/feature-attributes.md`'s "Never Force a Sign-In".
- `src/components/FeatureAttributesPanel.jsx` – UI panel rendering the selected feature's layer title and attributes, with an edit mode (value inputs, Save/Cancel) and an "Add Column" form. On selecting a feature (keyed by `layerId:x:y`, not object identity, so an in-place attribute update after Save doesn't refire this), focus moves to the panel's Close button and an `Escape` keydown listener calls `onClose`.
- `src/app/ApplicationShell.jsx` – `selectedFeature` state, wiring the engine's selection callback to the panel, `handleSaveAttributes`/`handleAddColumn` wrappers around the engine's edit APIs.

## Responsive Layout System

**Purpose:** Keeps the app shell usable on narrow (mobile) viewports by turning the desktop sidebar into a collapsible overlay drawer and rescaling floating UI so it doesn't overflow the screen.

**Key Files:**
- `src/app/ApplicationShell.jsx` – `sidebarOpen` state, `.sidebar-toggle` button, `.side-panel-backdrop`. When `sidebarOpen` becomes true, focus moves into `.side-panel` (`tabIndex={-1}` + ref) and an `Escape` keydown listener closes the drawer and returns focus to `.sidebar-toggle`.
- `src/styles/gis-theme.css` – all rules scoped under `@media (max-width: 768px)` (sidebar drawer, FAB rescale, popup/toast max-width clamps, plus enlarged `.layer-reorder-btn`/`.layer-eye-btn`/`.layer-chevron-btn`/`.drag-handle` touch targets). A top-level `@media (prefers-reduced-motion: reduce)` block (not scoped to mobile) disables transitions/animations app-wide for users who request it.

See `knowledge/features/responsive-layout.md` for details.

## UI Feedback & Accessibility System

**Purpose:** Cross-cutting affordances that report asynchronous outcomes and failures to the user, and keep every control operable by keyboard and screen reader. Owned by no single subsystem, which is why it is documented separately.

**Key Files:**
- `src/app/ApplicationShell.jsx` – `toast` state and `showToast(message, type = "error")` (the app's only message channel; errors persist until dismissed, non-errors auto-dismiss after `TOAST_DURATION_MS` = 4000ms), `hasInteracted` (first-run hint), `isRouting` (route busy state), `reorderAnnouncement` (`aria-live` region for layer reorders).
- `src/components/Icon.jsx` – the shared inline-SVG icon set used by every icon-bearing control, replacing the emoji/unicode glyphs that rendered inconsistently across platforms.
- `src/components/FloatingDrawTools.jsx` – the `.draw-status-chip` "Drawing…" indicator + Cancel button, driven by the engine's `setOnDrawStateChange` callback.
- `src/components/LayerControlPanel.jsx` – keyboard-operable layer reordering (Move up/down buttons + `ArrowUp`/`ArrowDown` on the drag handle) alongside drag-and-drop, and the pre-load empty state.
- `src/components/GlobalSearchPanel.jsx` – per-panel `searching` state and stale-response guard.

See `knowledge/features/ui-feedback.md` for details, including the full message-by-trigger table.

## Dead Code

Present in the tree and covered by their own tests, but **imported by no application code**:
- `src/hooks/useHeatmapAnalysis.js` – superseded by `ApplicationShell`'s inline `heatOn`/`heatIntensity` state.
- `src/hooks/useRoutingEngine.js` – superseded by `ApplicationShell.handleRoute`.
- `src/layers/heatmapLayer.js` (`createHeatmapLayer`) – superseded by the heatmap `FeatureLayer` constructed inline in `GISMapEngine.attachToView`.

These inflate the reported test coverage without exercising any shipped path. This mirrors the earlier removal of `HeatmapControlPanel`/`ViewControlPanel`/`RouteSearchPanel`/`SidePanel` (see Testing System below); these three were not caught in that pass. Either delete them or wire them in — do not treat them as the entry point for new heatmap/routing work.

Unused runtime dependencies in `my-arcgis-app/package.json`: `shpjs` (shapefile parsing) and `file-saver` — no `src/` file imports either; `saveDrawings` hand-rolls its download with `URL.createObjectURL` + an anchor click. The repo-root `package.json` separately declares `@hello-pangea/dnd`, `file-saver`, and `shpjs`, none of which the app imports either (`LayerControlPanel` uses native HTML5 drag events, not a DnD library).

## Testing System

**Purpose:** Unit/component test coverage for the app, run via Jest.

**Key Files:**
- `my-arcgis-app/jest.config.cjs` – Jest configuration (jsdom environment for component tests).
- `my-arcgis-app/babel.config.cjs` – Babel transform config so Jest can process JSX/ESM (Vite normally handles this at dev/build time; Jest needs its own transform pipeline).
- `my-arcgis-app/src/**/*.test.{js,jsx}` – one test file per component/service/hook (`ApplicationShell`, `FeatureAttributesPanel`, `FloatingDrawTools`, `GISMapView`, `LayerControlPanel`, `PortalLayerPanel`, `RouteInput`, `RoutingControlPanel`, `ViewModeToggle`, `GISMapEngine`, `useHeatmapAnalysis`, `useRoutingEngine`, `heatmapLayer`, `GeocodingService`, `RoutingService`, `PortalService`, `AuthService`). `HeatmapControlPanel`, `ViewControlPanel`, `RouteSearchPanel`, `SidePanel`, and `AnalysisPanel` were removed as dead/superseded code — the first four duplicated logic already hand-rolled inline in `RoutingControlPanel`/`ApplicationShell` and were never imported by any app code; `AnalysisPanel` was superseded by `LayerControlPanel`'s per-row Filter/Aggregate sections (see the Filter & Aggregate System section above) — they duplicated logic already hand-rolled inline in `RoutingControlPanel`/`ApplicationShell` and were never imported by any app code.
- `my-arcgis-app/test/mocks/arcgis-core/widgets/Sketch/SketchViewModel.js` – jsdom-safe stub of the real `SketchViewModel`; now includes `cancel`/`destroy` jest mocks (in addition to `create`/`on`/`emit`) since `GISMapEngine.attachToView` calls both on the outgoing instance before creating a new one.
- `my-arcgis-app/sonar-project.properties` – SonarQube scanner config; consumes Jest's `test:coverage` output for static analysis/coverage reporting.

**Scripts (`my-arcgis-app/package.json`):**
- `npm test` – run the suite once.
- `npm run test:watch` – watch mode.
- `npm run test:coverage` – run with coverage (input to `npm run sonar`).

**Known gaps:**
- The Docker build (see `knowledge/deployment.md`) does not run this suite before producing an image.
- `GlobalSearchPanel.jsx` and `Icon.jsx` have no test file, unlike every other component. `GlobalSearchPanel` is the notable one: its stale-response guard (`requestIdRef`) is exactly the kind of ordering logic a unit test should pin down.
- Three of the covered modules (`useHeatmapAnalysis`, `useRoutingEngine`, `heatmapLayer`) are dead code (see Dead Code above), so their coverage does not reflect any shipped behavior.

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

**Drawing persistence across the switch:** the `<arcgis-map>`/`<arcgis-scene>` custom element that React unmounts on an `is3D` flip destroys its own ArcGIS `Map` on unmount, which cascades to destroy every layer still attached to it — including the engine's persistent `drawLayer`, permanently wiping drawings, not just hiding them. `ApplicationShell.toggleViewMode` now calls `engine.detachFromView()` (which does a non-destructive `map.removeAll()`) synchronously before flipping `is3D`, pulling the engine's layers off the outgoing map before it gets torn down. See `knowledge/architecture.md`'s "2D/3D Synchronization" section and `knowledge/features/drawing-system.md`'s "Permanent Fix: Completed Drawings Vanishing on 2D/3D Switch" section.