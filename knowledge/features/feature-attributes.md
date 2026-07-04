---
name: feature-attributes
description: Concise documentation of the Feature Attribute Selection system implementation
metadata:
  type: reference
---

# Feature Attribute Selection System

## Purpose
Lets a user click a feature on a selectable `FeatureLayer` (Tourist Attractions, MRT Stations, MRT Lines) and view that feature's attributes in an on-map panel.

## Architecture
- **GISMapEngine (src/gis/GISMapEngine.js)**
  - Owns the ArcGIS `view.on("click", ...)` handle (`this.clickHandle`), created/re-created each time `attachToView` runs so it always targets the live view.
  - `setOnFeatureSelect(callback)` — registers a UI callback the engine invokes with selection results; keeps the engine free of React state while still notifying the shell.
  - `handleFeatureClick(event)` — runs `view.hitTest(event, { include: selectableLayers })` restricted to `touristAttractionLayer`, `mrtStationLayer`, and `mrtLineLayer`, then:
    - On a hit: calls `onFeatureSelect({ layerTitle, attributes, x, y })` using the hit graphic's `layer.title`, `attributes`, and the click's screen coordinates (`event.x`/`event.y`) so the UI can render the popup next to the clicked feature.
    - On a miss: calls `onFeatureSelect(null)` to clear the panel.
  - `touristAttractionLayer`, `mrtStationLayer`, and `mrtLineLayer` are all constructed with `outFields: ["*"]`; without it, ArcGIS `FeatureLayer`s only carry the ObjectID field client-side, so `hitTest` graphics used to expose just `OBJECTID_1`.

- **FeatureAttributesPanel (src/components/FeatureAttributesPanel.jsx)**
  - Presentation-only component; renders nothing when `feature` is `null`.
  - Renders as a popup positioned at the click's screen coordinates (`feature.x`/`feature.y`), offset slightly so it doesn't sit directly under the cursor; flips to the left/above when it would overflow the window (`overflowsRight`/`overflowsBottom` checks against `window.innerWidth`/`innerHeight`).
  - Lists every key/value pair in `feature.attributes` under a header showing `feature.layerTitle`.
  - Close button (`✕`) clears selection via the `onClose` prop; selecting a different feature or clicking empty map space also clears/replaces it (via the engine's `onFeatureSelect` callback).

- **ApplicationShell (src/app/ApplicationShell.jsx)**
  - Holds `selectedFeature` state, set via `engineRef.current.setOnFeatureSelect(setSelectedFeature)` inside `handleViewReady` (so the callback is (re)registered on every view/engine attachment, including 2D/3D switches).
  - Renders `<FeatureAttributesPanel feature={selectedFeature} onClose={...} />` inside `map-container`, alongside `FloatingDrawTools`.

## Workflow
1. User clicks the map.
2. `GISMapEngine`'s click handler runs `hitTest`, scoped to the three selectable feature layers (drawings, route, and stop graphics are excluded).
3. If a feature is hit, its `layer.title` and `attributes` are packaged and handed to the `onFeatureSelect` callback.
4. `ApplicationShell` stores the result in `selectedFeature` state, causing `FeatureAttributesPanel` to render with the feature's attributes.
5. Clicking empty map space (or a non-selectable graphic) clears the panel.

## Dependencies
- **ArcGIS Core SDK**: `MapView`/`SceneView` `hitTest` API (via the view instance owned by `GISMapEngine`).
- Reuses the three existing `FeatureLayer` instances created in `attachToView`; introduces no new layers.

## Limitations
- Only the three feature layers explicitly listed in `selectableLayers` are clickable for attributes; `drawings`, `route`, and `stops` graphics are intentionally excluded.
- Raw attribute values are rendered as-is (via `String(value)`); no field aliasing, formatting, or domain/coded-value lookup is performed.
- Only one feature is shown at a time — if multiple selectable features overlap at the click point, only the first `hitTest` result with attributes is used.
- The click handler is reattached on every `attachToView` call (2D/3D switch); the previous handle is explicitly removed first (`this.clickHandle.remove()`) to avoid duplicate handlers accumulating across reattachments.
