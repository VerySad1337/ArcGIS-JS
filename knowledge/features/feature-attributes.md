---
name: feature-attributes
description: Concise documentation of the Feature Attribute Selection, editing, and column-add system implementation
metadata:
  type: reference
---

# Feature Attribute Selection System

## Purpose
Lets a user click a feature on a selectable layer — Tourist Attractions, MRT Stations, MRT Lines (`FeatureLayer`s), or Drawings (the local `GraphicsLayer`) — and view that feature's attributes in an on-map popup. The panel also supports an **edit mode** for changing attribute values and adding a new attribute column.

## Architecture
- **GISMapEngine (src/gis/GISMapEngine.js)**
  - Owns the ArcGIS `view.on("click", ...)` handle (`this.clickHandle`), created/re-created each time `attachToView` runs so it always targets the live view. The previous handle is explicitly removed first (`this.clickHandle.remove()`) to avoid duplicate handlers accumulating across reattachments.
  - `setOnFeatureSelect(callback)` — registers a UI callback the engine invokes with selection results; keeps the engine free of React state while still notifying the shell.
  - `handleFeatureClick(event)` — runs `view.hitTest(event, { include: selectableLayers })` restricted to `touristAttractionLayer`, `mrtStationLayer`, `mrtLineLayer`, **and `drawLayer`**, then:
    - On a hit (first result whose `graphic.attributes` is truthy): records `this.selectedGraphic` and `this.selectedLayerId` (resolved via `resolveLayerId`), then calls `onFeatureSelect({ layerId, layerTitle, objectIdField, attributes, x, y })` using the hit graphic's `layer.title`, `layer.objectIdField`, `attributes`, and the click's screen coordinates (`event.x`/`event.y`) so the UI can render the popup next to the clicked feature.
    - On a miss: clears `selectedGraphic`/`selectedLayerId` and calls `onFeatureSelect(null)` to clear the panel.
  - `resolveLayerId(layer)` — maps a hit `layer` object back to its string id (`touristAttractions`/`mrtStations`/`mrtLines`/`drawings`).
  - `hostedLayerById(layerId)` — returns the backing `FeatureLayer` for the three hosted layers only; returns `null` for `drawings` (which has no service).
  - `touristAttractionLayer`, `mrtStationLayer`, and `mrtLineLayer` are all constructed with `outFields: ["*"]`; without it, ArcGIS `FeatureLayer`s only carry the ObjectID field client-side, so `hitTest` graphics would expose just the ObjectID.
  - `buildDrawingAttributes(overrides)` — seeds a drawn/uploaded graphic's `attributes` from `this.drawingFields` (the client-side "schema") merged with any overrides; this is why Drawings graphics have attributes to display and edit.
  - `updateSelectedFeatureAttributes(updates)` — persists edits to the currently selected feature:
    - For `drawings`, mutates the graphic's `attributes` in memory directly (no backing service).
    - For a hosted layer, builds an edit `Graphic` keyed by the layer's `objectIdField` and calls `layer.applyEdits({ updateFeatures: [...] })`, throwing on `updateFeatureResults` errors, then mirrors the change onto the local graphic.
  - `addColumnToLayer(layerId, fieldName, fieldType = "esriFieldTypeString", defaultValue = null)` — adds a new attribute field:
    - For `drawings`, appends to `this.drawingFields` (rejecting duplicates) and back-fills the key onto every existing graphic. In-memory only.
    - For a hosted layer, obtains an `IdentityManager` credential (an admin/edit token, not the app's public API key) and POSTs an `addToDefinition` request to the service, then calls `layer.refresh()`.

- **FeatureAttributesPanel (src/components/FeatureAttributesPanel.jsx)**
  - Props: `feature`, `onClose`, `onSaveAttributes`, `onAddColumn`. Renders nothing when `feature` is `null`.
  - Renders as a popup positioned at the click's screen coordinates (`feature.x`/`feature.y`), offset slightly (`OFFSET`); flips to the left/above when it would overflow the window (`overflowsRight`/`overflowsBottom` checks against `window.innerWidth`/`innerHeight`, using `POPUP_WIDTH`/`POPUP_MAX_HEIGHT`).
  - Lists every key/value pair in `feature.attributes` under a header showing `feature.layerTitle`.
  - **Edit mode** (toggled by the footer's *Edit* button): each attribute becomes a text `<input>` bound to a local `draft`, except the `objectIdField` which stays read-only. *Save* calls `onSaveAttributes(draft)`; *Cancel* discards the draft. A per-selection `selectionKey` (`layerId:x:y`) resets edit state when a *different* feature is selected but not when the same feature's attributes are updated in place after a save/add round-trip.
  - **Add Column** form (shown only in edit mode): a column-name input, a default-value input, and an *+ Add Column* button that calls `onAddColumn(name, defaultValue)`.
  - Close button (`✕`) clears selection via `onClose`; selecting a different feature or clicking empty map space also clears/replaces it.

- **ApplicationShell (src/app/ApplicationShell.jsx)**
  - Holds `selectedFeature` state, set via `engineRef.current.setOnFeatureSelect(setSelectedFeature)` inside `handleViewReady` (re-registered on every view/engine attachment, including 2D/3D switches).
  - `handleSaveAttributes(updates)` — calls `engine.updateSelectedFeatureAttributes`, merges the returned attributes back into `selectedFeature`, and shows a toast (success or error message).
  - `handleAddColumn(fieldName, defaultValue)` — calls `engine.addColumnToLayer(selectedFeature.layerId, fieldName, "esriFieldTypeString", defaultValue)`, optimistically adds the key to `selectedFeature.attributes`, and shows a toast.
  - Renders `<FeatureAttributesPanel feature={selectedFeature} onClose={...} onSaveAttributes={handleSaveAttributes} onAddColumn={handleAddColumn} />` inside `map-container`, alongside `FloatingDrawTools`.

## Workflow
1. User clicks the map.
2. `GISMapEngine`'s click handler runs `hitTest`, scoped to the four selectable layers (Tourist Attractions, MRT Stations, MRT Lines, Drawings). Route and stop graphics are excluded.
3. If a feature is hit, its `layerId`, `layer.title`, `objectIdField`, `attributes`, and click coordinates are packaged and handed to the `onFeatureSelect` callback; the engine also caches the graphic (`selectedGraphic`) for later edits.
4. `ApplicationShell` stores the result in `selectedFeature` state, causing `FeatureAttributesPanel` to render.
5. The user may click *Edit* to change values (saved via `updateSelectedFeatureAttributes`) or add a new column (via `addColumnToLayer`).
6. Clicking empty map space (or a non-selectable graphic) clears the panel.

## Dependencies
- **ArcGIS Core SDK**: `MapView`/`SceneView` `hitTest`, `FeatureLayer.applyEdits`, `IdentityManager.getCredential`, and `esriRequest` (used for the `addToDefinition` schema change).
- Reuses the four existing selectable layers created in `attachToView`; introduces no new layers.

## Limitations
- Only the four layers listed in `selectableLayers` are clickable for attributes; `route` and `stops` graphics are intentionally excluded.
- Raw attribute values are rendered/edited as strings; no field aliasing, formatting, or domain/coded-value lookup is performed.
- Only one feature is shown at a time — if multiple selectable features overlap at the click point, only the first `hitTest` result with attributes is used.
- **Drawings edits/columns are in-memory only** — they are not persisted to any service and are lost on reload, and (per the Drawing System docs) are not included in the GeoJSON export.
- **Hosted-layer edits require privileges** — editing attribute values (`applyEdits`) and adding a column (`addToDefinition`) both require an authenticated user with edit/admin rights on the service item, not just the app's public API key. With a free/public license these operations fail (see README notes).
- The click handler is reattached on every `attachToView` call (2D/3D switch); the previous handle is removed first to avoid duplicate handlers.
