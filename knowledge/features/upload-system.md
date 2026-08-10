---
name: upload-system
description: The GeoJSON upload feature this file used to document has been removed (2026-08)
metadata:
  type: reference
---

# Upload System — Removed (2026-08)

This feature no longer exists in the codebase. `GISMapEngine.uploadGeoJSON` (and its supporting `getDrawnFeatures`/`hasDrawings`/`toGeoJSONGeometry`/`uploadedLayers`, and the paired `saveDrawings` export feature) were deleted, along with `FloatingDrawTools`' Upload/Save GeoJSON FAB buttons and `ApplicationShell`'s wrapper functions.

**Why:** drawing is now always expected to target a real hosted/portal feature layer via `FloatingDrawTools`' "Draw into" selector (see `knowledge/features/drawing-system.md`'s "Draw Target Routing" section), which persists features to an actual ArcGIS service through an authenticated `applyEdits` call. A file-based GeoJSON import/export round-trip to the local, in-memory `drawings` scratch layer became redundant with that — and `drawings` itself no longer has a Layers-card row to manage uploaded content through.

**What replaced it:** see `knowledge/features/drawing-system.md`'s "Draw Target Routing" section, and `knowledge/index.md`'s "Hosted Feature Layer Creation" section for how a new hosted layer eligible as a draw target gets created in the first place.

**Whole-session save/load is unaffected.** `GISMapEngine.saveProjectState`/`loadProjectState` (see `knowledge/index.md`'s Project Persistence section) is a separate feature — a full session snapshot/restore (layer order/visibility/styling/filters, drawings with attributes, route/stops, camera position) — and was not touched by this removal.
