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
    - For a hosted layer, **first checks `layer.capabilities.operations.supportsUpdate`** and throws `"<title>" is read-only for the current user.` when it is explicitly `false`. Otherwise builds an edit `Graphic` keyed by the layer's `objectIdField` and calls `layer.applyEdits({ updateFeatures: [...] })`, throwing on `updateFeatureResults` errors, then mirrors the change onto the local graphic.
  - `addColumnToLayer(layerId, fieldName, fieldType = "esriFieldTypeString", defaultValue = null)` — adds a new attribute field:
    - For `drawings`, appends to `this.drawingFields` (rejecting duplicates) and back-fills the key onto every existing graphic. In-memory only.
    - For a hosted layer, **first looks for an existing credential with the non-prompting `IdentityManager.findCredential`** (checking the service URL, then `${PORTAL_URL}/sharing`) and throws `Sign in with an account that owns this layer to add a column.` when there is none. Only once one is known to exist does it call `getCredential` and POST an `addToDefinition` request to the service, then `layer.refresh()`.

## Never Force a Sign-In

**The app must be fully usable anonymously; sign-in is additive, never a prerequisite.** Two code paths violated this and were fixed:

- `IdentityManager.getCredential(url)` *acquires* a credential, which means **opening the SDK's own sign-in modal** when none exists. `addColumnToLayer` called it unconditionally, so clicking "+ Add Column" always hijacked the page with a login dialog — even though `esriConfig.apiKey` is set, because an API key is not a credential in `IdentityManager`'s registry and is never consulted by `getCredential`.
- `applyEdits` against a service the current identity can't write to returns **403, and `IdentityManager` answers a 403 by opening that same modal**. The three hosted services are published `"capabilities":"Query"` — read-only both anonymously *and* with the app's API key — so every attribute Save did this.

Because cancelling the modal stores nothing, the next attempt prompted again, making it look like the app repeatedly demanded a login.

The rule this establishes:

> Use `findCredential` (a non-prompting lookup returning `undefined`) to decide **whether to offer** a privileged action. Use `getCredential` only **after** you know a credential exists. Never let a permission failure reach the SDK as an unhandled 403.

The rule is not specific to attribute editing — it applies anywhere the app touches a resource whose accessibility it hasn't established. The other current instance is `GISMapEngine.addPortalLayer`, where a publicly *listed* portal item can point at a subscription-only or restricted *service*; it probes with `esriRequest({ authMode: "no-prompt" })` before constructing the `FeatureLayer`, for exactly the same reason. See `knowledge/index.md`'s Portal Layer System.

`AuthService.hasPortalCredential()` is the shared non-prompting check. The portal URL is checked as a fallback because an ArcGIS Online sign-in registers a credential for the *portal*, which federates to hosted services, rather than one per service URL — looking only at the service URL would wrongly block a genuinely signed-in user.

- **FeatureAttributesPanel** takes a `canEdit` prop (default `true`). When false it renders no Edit button and no Add Column form, showing `Read-only — sign in with an account that can edit this layer.` instead. Attribute values remain fully readable. This gates the *affordance*, not just the attempt, so the user is never offered a control whose rejection would be a login modal.
- **ApplicationShell** computes `canEditSelectedFeature = selectedFeature?.layerId === "drawings" || Boolean(signedInUser)`. Drawings are in-memory and always editable, signed in or not. Hosted layers show editing controls only once a real session exists — which, with `VITE_ARCGIS_OAUTH_CLIENT_ID` unset (the default), is never.

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
- **Hosted-layer edits require privileges** — editing attribute values (`applyEdits`) and adding a column (`addToDefinition`) both require an authenticated user with edit/admin rights on the service item, not just the app's public API key. As currently deployed the three hosted services are published `Query`-only, so these operations are unavailable to every identity the app has; the UI reflects that by hiding the controls rather than failing when used (see *Never Force a Sign-In*).
- **Editing is unreachable until OAuth is configured.** `canEditSelectedFeature` keys off `signedInUser`, which stays `null` while `VITE_ARCGIS_OAUTH_CLIENT_ID` is unset — the default. Enabling hosted-layer editing therefore takes two independent steps: configure the OAuth client ID (so a user *can* sign in), **and** enable editing on the service items in ArcGIS Online (so the signed-in owner is actually permitted). Neither alone is sufficient.
- **`capabilities` is read once, at layer load.** `attachToView` constructs the `FeatureLayer`s anonymously, so `supportsUpdate` reflects the identity at load time. Signing in mid-session does not re-load them, so a fresh sign-in may still report read-only until the next 2D/3D switch rebuilds the layers. Reloading the page is the reliable path.
- **A credential existing does not mean it is sufficient.** `findCredential` only proves *someone* is signed in, not that they own the layer. A signed-in user without edit rights still gets a service-side error — surfaced as a toast, not a modal.
- The click handler is reattached on every `attachToView` call (2D/3D switch); the previous handle is removed first to avoid duplicate handlers.
