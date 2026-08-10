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
  - Holds a `GraphicsLayer` named **Drawings** (`this.drawLayer`) — a local, in-memory scratch layer `SketchViewModel` always draws onto first, regardless of the selected draw target (see *Draw Target Routing* below). It has no Layers-card row of its own (2026-08) — see that section for why.
  - Uses **SketchViewModel** (`this.sketchVM`) to create point, polyline, and polygon graphics on the draw layer.
  - Exposes high‑level methods:
    - `startPointDraw / startLineDraw / startPolygonDraw` – initiate SketchViewModel create mode, and record the requested type on `this.activeDrawType`.
    - `cancelDraw` – cancels the in-progress SketchViewModel create session.
    - `setDrawTarget` / `addFeatureToHostedLayer` – which layer a completed sketch is actually persisted to, and the authenticated push itself. See *Draw Target Routing*.
    - `setOnDrawingsChanged` / `setOnDrawStateChange` – register the two outbound UI callbacks described under *Draw State Reporting* below.
  - Manages layer ordering, visibility toggles, heatmap and MRT layers (not directly part of drawing but co‑located).

- **FloatingDrawTools (src/components/FloatingDrawTools.jsx)**
  - Small UI component rendering FAB buttons for the draw tools, plus a "Draw into" target selector folded into the same expand/collapse fan (2026-08 — see *Draw Target Routing*).
  - The draw-tool buttons (and, since 2026-08, the "Draw into" selector) live in a fan-out stack behind a `+` main button (`fab-main`, `aria-expanded`); the fan collapses on outside click (`mousedown` listener) and after any tool runs. Collapsed tools/selector get `tabIndex={-1}` so they stay out of the tab order while hidden. Which tool buttons appear at all is filtered by the selected draw target's geometry type (see below) — the fan can show one button (a single-geometry hosted layer selected) or all three (nothing selected yet, or an unrecognized/not-yet-loaded target).
  - Renders the **draw-status chip** (`.draw-status-chip`) whenever the `activeDrawType` prop is set — a live `<output>` reading "Drawing point…/line…/polygon…" with a *Cancel drawing* button wired to `onCancelDraw`. See *Draw State Reporting* below.
  - Calls callback props supplied by the surrounding **ApplicationShell**.

- **GISMapView (src/components/GISMapView.jsx)**
  - Renders either `<arcgis-map>` (2‑D) or `<arcgis-scene>` (3‑D) based on the `is3D` prop.
  - Emits `arcgisViewReadyChange` which is forwarded to `ApplicationShell`.

- **ApplicationShell (src/app/ApplicationShell.jsx)**
  - Instantiates a single `GISMapEngine` via a `ref` (`engineRef`).
  - Passes engine methods to `FloatingDrawTools` and handles the view ready event to `engineRef.current.attachToView(view)`.
  - Updates UI state (`layers`, `toast`) based on engine callbacks.

## Workflow
1. **Map Initialization** – When the map view becomes ready (`handleViewReady`), `engine.attachToView(view)` creates base layers (route, stop, tourist attractions, MRT, draw) and attaches a `SketchViewModel` bound to the draw layer.
2. **Picking a draw target** – The user opens the FAB fan and selects a target in `FloatingDrawTools`' "Draw into" dropdown (tucked into the fan itself, not shown while the fan is closed — 2026-08), which calls `ApplicationShell.setDrawTarget` → `engine.setDrawTarget(layerId)`, validated via `hostedLayerById`. The dropdown starts with nothing chosen (`drawTargetLayerId === ""`, rendered as a "Select a layer…" placeholder option) — see *Default Draw Target Selection* below for when/how it auto-picks a real target instead.
3. **User Drawing** – Clicking a FAB button (only the one matching the selected target's geometry type is shown, unless nothing is selected yet) triggers `engine.start*Draw()`, which calls `SketchViewModel.create()` for the chosen geometry type. The user sketches on the map; the resulting `Graphic` is automatically added to `drawLayer` — see *Draw Target Routing* for what happens next.
4. **Layer Management** – `ApplicationShell` can toggle visibility, reorder, and query layer states via `engine.getLayers()`, `engine.toggleLayer(id)`, and `engine.reorderLayers()`.
5. **Layer Styling** – For graphics that remain on `drawLayer` (i.e. drawn with `"Drawings"` as the target, or left there after a failed push to a hosted target), `LayerControlPanel` exposed, behind a per-layer chevron toggle, one color/border control block per distinct symbol type present. **This is no longer reachable through the Layers card** (2026-08 — `drawings` has no card row), though `engine.getLayers()`'s internal (unreturned) computation and `engine.setLayerStyle("drawings", ...)` still work if invoked directly.
6. **Post-draw refresh** – Because a `SketchViewModel` "create" only finishes asynchronously (after the user completes the sketch), `GISMapEngine` invokes an `onDrawingsChanged` callback (registered via `setOnDrawingsChanged`) once the graphic completes. `ApplicationShell` wires this to `refreshLayers()`.

## Draw State Reporting

Picking a draw tool arms the map but produces no immediate visual change — `SketchViewModel.create()` returns straight away and nothing happens until the user clicks on the map. Without a cue, the FAB fan closing is the only feedback, leaving the user unsure whether the tool took effect. The draw-state channel closes that gap:

- `GISMapEngine.startPointDraw`/`startLineDraw`/`startPolygonDraw` set `this.activeDrawType` (`"point"`/`"polyline"`/`"polygon"`) before calling `sketchVM.create(...)`.
- The single `sketchVM.on("create", ...)` handler installed in `attachToView` drives the callback off the sketch's own state machine:
  - `"start"` → `onDrawStateChange?.(this.activeDrawType)`
  - `"complete"` → seeds `event.graphic.attributes` via `buildDrawingAttributes()`, then branches on the active draw target (see *Draw Target Routing*), then clears `activeDrawType` and fires `onDrawStateChange?.(null)`
  - `"cancel"` → clears `activeDrawType`, then `onDrawStateChange?.(null)`
- `ApplicationShell` registers `setOnDrawStateChange(setActiveDrawType)` in `handleViewReady` and passes the resulting `activeDrawType` down to `FloatingDrawTools`, which renders the draw-status chip and its Cancel button (`onCancelDraw` → `engine.cancelDraw()`).

The same `activeDrawType` shell state is what `toggleViewMode` checks before a 2D/3D switch, so the in-progress sketch is cancelled with a toast rather than silently dropped (see the section below). Note the shell's `activeDrawType` is driven by the engine's `"start"` event, not by the button click — so the chip appears once the sketch is genuinely live, not merely requested.

## Dependencies
- **ArcGIS Core SDK** (`@arcgis/core`):
  - `Graphic`, `GraphicsLayer`, `FeatureLayer` for rendering.
  - `SketchViewModel` for interactive drawing.
- **Configuration** (`src/config/ArcGISConfiguration.js`):
  - API key (scoped, not blanket — see `knowledge/index.md`'s Portal Sign-In regression note), feature‑service URLs (MRT layers) – required at engine construction.
- **React** for UI components (`FloatingDrawTools`, `GISMapView`, `ApplicationShell`).

## Attribute Editing & Columns
- Drawn graphics are given an `attributes` object at creation (`GISMapEngine.buildDrawingAttributes`), seeded from `this.drawingFields` (a client-side "schema" for the drawings layer).
- `drawLayer` is included in `handleFeatureClick`'s selectable layers, so clicking a drawn graphic left on `drawLayer` opens `FeatureAttributesPanel` like any other feature.
- `GISMapEngine.updateSelectedFeatureAttributes(updates)` mutates the selected graphic's `attributes` directly (no backing service to persist to) when the selected layer is `"drawings"`.
- `GISMapEngine.addColumnToLayer("drawings", name, type, defaultValue)` appends to `this.drawingFields` and back-fills the new key onto every existing graphic in `drawLayer`. This is in-memory only — it is not a schema on any ArcGIS service and does not survive a reload.

## SketchViewModel Lifecycle Across 2D/3D Switches
`attachToView` destroys the previous `SketchViewModel` (`cancel()` then `destroy()`) before constructing the new one bound to the incoming view. Previously the old instance was simply overwritten, leaving it alive and bound to a view that React was about to unmount; a sketch left mid-creation (line/polygon, before the final vertex) was never committed to `drawLayer`, since SketchViewModel only adds its graphic on the "complete" state. `ApplicationShell.toggleViewMode` also calls `engine.cancelDraw()` (surfacing a toast) before switching `is3D` if `activeDrawType` is set, so an in-progress sketch is deliberately cancelled instead of being silently lost mid-switch. Completed drawings (already added to `drawLayer`) are unaffected by this and continue to persist via the existing capture/re-add logic in `attachToView`.

## Permanent Fix: Completed Drawings Vanishing on 2D/3D Switch (detachFromView)
The SketchViewModel fix above only protects an in-*progress* sketch. Completed drawings (already committed to `drawLayer`) were still vulnerable to a separate, more severe bug: switching `is3D` causes React to unmount the outgoing `<arcgis-map>`/`<arcgis-scene>` custom element, and that element destroys its own ArcGIS `Map` on unmount. `Map#destroy()` cascades to `destroy()` on every layer still attached to it — including `drawLayer`, which is otherwise a persistent, engine-owned `GraphicsLayer` meant to survive view swaps. Once destroyed, a layer is permanently unusable and its graphics are gone for the rest of the session; this is not a transient rendering glitch, it is data loss. `attachToView`'s own `map.removeAll()` runs too late to prevent this, because it only executes once the *incoming* view reports ready — and the outgoing element's unmount (and thus its `Map#destroy()`) is not ordered to wait for that.

Fix: `GISMapEngine.detachFromView()` calls `this.currentMap?.removeAll()` (detach only, not destroy) and is invoked from `ApplicationShell.toggleViewMode` synchronously, before the `setIs3D(next)` call that triggers the unmount. This pulls all engine-owned layers off the doomed map before React ever tears it down, so they survive independently of whether (or how quickly) the new view becomes ready. See `knowledge/architecture.md`'s "2D/3D Synchronization" section for the full root-cause writeup.

## Default Draw Target Selection (2026-08)

`ApplicationShell`'s `drawTargetLayerId` state starts empty (`""`), not `"drawings"`. A `useEffect` keyed on `[layers, drawTargetLayerId]` runs only while nothing has been explicitly chosen yet (`if (drawTargetLayerId) return;`): it filters `layers` (from `engine.getLayers()`) down to `canBeDrawTarget` entries, and — when one or more exist — auto-selects the **topmost** one via the same `setDrawTarget` path a manual dropdown pick uses (`engine.setDrawTarget(layerId)` then mirrored into state). "Topmost" is the last entry in that filtered list, not the first: `getLayers()` returns `layerOrder` in its stored order, and per the Layer Styling System section of `knowledge/index.md`, a higher `layerOrder` index draws later (on top) — so the first canBeDrawTarget match in the array is the bottommost editable layer and the last match is the one actually drawn on top of the map. If no layer is `canBeDrawTarget` (no editable hosted/portal feature layer, or none the current identity holds edit credentials for — see `isDrawTarget` in `GISMapEngine.getLayers()`), the selector stays empty and `FloatingDrawTools` renders a "Select a layer…" placeholder option instead of silently defaulting to `"Drawings"`.

Because the effect bails out the instant `drawTargetLayerId` is truthy, it never overrides a user's own choice. `GISMapEngine.activeDrawTargetLayerId`'s own class-field default is unchanged (`"drawings"`), so a sketch completed in the brief window before `layers` first loads (and thus before this effect can run) still safely lands on the local scratch layer rather than erroring against an unresolved target.

**`"Drawings"` is not a selectable draw target (2026-08).** `ApplicationShell.drawTargetOptions` is built purely from `layers.filter(l => l.canBeDrawTarget)` — the hardcoded `{ id: "drawings", ... }` entry that used to head the list is gone, so a user can no longer explicitly route a sketch to the local scratch layer via the dropdown. When no layer is `canBeDrawTarget`, `drawTargetOptions` is empty and `FloatingDrawTools` hides the "Draw into" bar entirely (its `drawTargetOptions.length > 0` guard), rather than falling back to showing "Drawings" as the only choice.

## Draw Target Routing — now a permanent fixture (2026-08)

A completed sketch is no longer always local-only. `GISMapEngine.activeDrawTargetLayerId` (default `"drawings"`, set via `setDrawTarget`) is where a completed sketch is persisted to; `FloatingDrawTools`' "Draw into" selector — folded into the FAB fan's open/closed state (2026-08), shown alongside the draw-tool buttons only once the fan is opened — lets the user pick a hosted/portal `FeatureLayer` target when one exists. Since `SketchViewModel` can only ever draw onto the `GraphicsLayer` it was constructed with, a completed graphic always lands on `drawLayer` first regardless of target; when the target isn't `"drawings"`, the `"complete"` handler then pushes it to the target layer via `addFeatureToHostedLayer` (an authenticated `applyEdits({ addFeatures })` call) and only removes the local copy on success — a failed push leaves the graphic on `drawLayer`, styled/filtered like any other drawing, so nothing is lost. `"drawings"` itself is reached only as this default/fallback, never as an explicit UI choice (see the "not a selectable draw target" note above). See `knowledge/index.md`'s Hosted Feature Layer Creation section for the full design, including how a brand-new hosted layer eligible as a draw target gets created in the first place.

**Geometry-type filtering of the draw tools (2026-08).** Each `drawTargetOptions` entry (`ApplicationShell`, derived from `layers.filter(l => l.canBeDrawTarget)`) carries the target's own `geometryType` (`"point"`/`"polyline"`/`"polygon"`, via `GISMapEngine.normalizeDrawGeometryType(layer.geometryType)` — collapses `multipoint` to `"point"`, anything else to `null`). `FloatingDrawTools` looks up the currently-selected option and, when its `geometryType` is non-null, shows only the one matching draw-tool button (a hosted/portal feature layer only ever accepts its own single geometry type — drawing a polygon into a point layer would always fail); when nothing is selected, or the selection doesn't resolve to a known option, `geometryType` falls back to `null` and all three tools show — the same "no restriction" behavior `"Drawings"` used to get explicitly, now reached implicitly since it's no longer a real dropdown entry.

**`"Drawings"` is excluded from the Layers card, same treatment as route/stops/searchResult/buffer (2026-08).** It remains a full `layerOrder`/`buildLayerMap` member internally and a valid `setDrawTarget("drawings")` target (callable directly on the engine) — only its Layers-card *row*, and now its "Draw into" dropdown *entry*, are gone; drawing is always expected to target a real feature class through the UI, with the local scratch layer surviving purely as GISMapEngine's own internal fallback. `GISMapEngine.getFilterableLayers()` (Filter & Aggregate System) was updated to keep offering `"drawings"` independently of `getLayers()`'s now-narrower returned list, since that's a different subsystem with its own inclusion rule.

**Removed (2026-08): Save GeoJSON / Upload GeoJSON.** The per-drawing GeoJSON export/import feature (`GISMapEngine.saveDrawings`/`uploadGeoJSON`/`getDrawnFeatures`/`hasDrawings`/`toGeoJSONGeometry`, `uploadedLayers`, and their `FloatingDrawTools`/`ApplicationShell` wiring) has been deleted entirely, not just hidden — removed in favor of drawing directly into a real hosted/portal feature layer via the "Draw into" target above, which persists to an actual ArcGIS service rather than a downloadable file a user had to re-import by hand. `GISMapEngine.saveProjectState`/`loadProjectState` (whole-session Save/Load Project — see `knowledge/index.md`'s Project Persistence section) is unaffected and remains the way to snapshot/restore an entire session including `drawLayer`'s graphics with attributes.

## Limitations
- **Geometry Types** – Only point, polyline, and polygon are supported via SketchViewModel.
- **Attribute Persistence Is Session-Only for `"Drawings"`** – graphics left on `drawLayer` (drawn before any editable feature class existed to auto-select as a target, or stranded there after a failed hosted-layer push) have their attributes lost on reload unless captured via `GISMapEngine.saveProjectState`/`loadProjectState` (see `knowledge/index.md`'s Project Persistence section) — the full-fidelity, whole-session alternative. A graphic successfully pushed to a hosted/portal target, by contrast, is genuinely persisted server-side like any other feature in that service.
- **Single Draw Layer** – All graphics not yet routed to a hosted target (or that failed to route) share one `GraphicsLayer`; there is no per‑session or per‑feature isolation.
- **No Undo/Redo** – SketchViewModel's built‑in editing tools are not exposed; users cannot delete individual graphics after creation.

## Known Risks
- **Performance Degradation** – Adding many graphics to a single `GraphicsLayer` can slow rendering, especially on older browsers or low‑end devices.
- **Security of API Key** – The ArcGIS API key is injected via `import.meta.env.VITE_ARCGIS_API_KEY` and may be exposed in client bundles; ensure it is restricted to required scopes (see the scoped-`apiKeys` regression note in `knowledge/index.md`'s Portal Sign-In section).

*This documentation focuses on the concrete implementation; UI/UX details (icon layout, styling) are handled in the component JSX and are outside the scope of the drawing system core.*
