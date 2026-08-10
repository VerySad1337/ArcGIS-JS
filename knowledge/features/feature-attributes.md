---
name: feature-attributes
description: Concise documentation of the Feature Attribute Selection, editing, and column add/delete system implementation
metadata:
  type: reference
---

# Feature Attribute Selection System

## Purpose
Lets a user click a feature on a selectable layer — Tourist Attractions, MRT Stations, MRT Lines (`FeatureLayer`s), or Drawings (the local `GraphicsLayer`) — and view that feature's attributes in an on-map popup. The panel also supports an **edit mode** for changing attribute values, adding a new attribute column, and deleting an existing one.

## Architecture
- **GISMapEngine (src/gis/GISMapEngine.js)**
  - Owns the ArcGIS `view.on("click", ...)` handle (`this.clickHandle`), created/re-created each time `attachToView` runs so it always targets the live view. The previous handle is explicitly removed first (`this.clickHandle.remove()`) to avoid duplicate handlers accumulating across reattachments.
  - `setOnFeatureSelect(callback)` — registers a UI callback the engine invokes with selection results; keeps the engine free of React state while still notifying the shell.
  - `handleFeatureClick(event)` — runs `view.hitTest(event, { include: selectableLayers })` restricted to `touristAttractionLayer`, `mrtStationLayer`, `mrtLineLayer`, `drawLayer`, **and every `portalLayers` member** (so a portal-added or app-created hosted layer is clickable for attributes too — that is the only kind of layer this app can realistically edit, since the three configured hosted services are `Query`-only), then:
    - On a hit (first result whose `graphic.attributes` is truthy): records `this.selectedGraphic` and `this.selectedLayerId` (resolved via `resolveLayerId`), then calls `onFeatureSelect({ layerId, layerTitle, objectIdField, attributes, x, y })` using the hit graphic's `layer.title`, `layer.objectIdField`, `attributes`, and the click's screen coordinates (`event.x`/`event.y`) so the UI can render the popup next to the clicked feature.
    - On a miss: clears `selectedGraphic`/`selectedLayerId` and calls `onFeatureSelect(null)` to clear the panel.
  - `resolveLayerId(layer)` — maps a hit `layer` object back to its string id (`touristAttractions`/`mrtStations`/`mrtLines`/`drawings`, or the synthetic portal id its `portalLayers` entry is keyed by).
  - `hostedLayerById(layerId)` — returns the backing `FeatureLayer` for the three fixed hosted layers **or any `portalLayers` member**; returns `null` for `drawings` (which has no service).
  - `touristAttractionLayer`, `mrtStationLayer`, and `mrtLineLayer` are all constructed with `outFields: ["*"]`; without it, ArcGIS `FeatureLayer`s only carry the ObjectID field client-side, so `hitTest` graphics would expose just the ObjectID.
  - `buildDrawingAttributes(overrides)` — seeds a drawn/uploaded graphic's `attributes` from `this.drawingFields` (the client-side "schema") merged with any overrides; this is why Drawings graphics have attributes to display and edit.
  - `updateSelectedFeatureAttributes(updates)` — persists edits to the currently selected feature:
    - For `drawings`, mutates the graphic's `attributes` in memory directly (no backing service).
    - For a hosted layer, **first checks `layer.capabilities.operations.supportsUpdate`** and throws `"<title>" is read-only for the current user.` when it is explicitly `false`. Otherwise builds an edit `Graphic` keyed by the layer's `objectIdField` and calls `layer.applyEdits({ updateFeatures: [...] })`, throwing on `updateFeatureResults` errors, then mirrors the change onto the local graphic.
  - `requireLayerCredential(layer, action)` — the shared `findCredential` → throw → `getCredential` gate both schema operations below run through (see *Never Force a Sign-In*). `action` is interpolated into the thrown message (`Sign in with an account that owns this layer to add a column.` / `… to delete a column.`).
  - `addColumnToLayer(layerId, fieldName, fieldType = "esriFieldTypeString", defaultValue = null)` — adds a new attribute field:
    - For `drawings`, appends to `this.drawingFields` (rejecting duplicates) and back-fills the key onto every existing graphic. In-memory only.
    - For a hosted layer: rejects a name that isn't a valid database column identifier (`/^[A-Za-z_][A-Za-z0-9_]*$/`) and one the layer's `fields` already carries (case-insensitively), gates on `requireLayerCredential`, then POSTs `addToDefinition` with a `{"fields":[…]}` body to `adminLayerUrl(layer)` and calls `layer.refresh()`. Empty-string `defaultValue` is normalized to `null` (the panel's default-value input is optional and starts blank, which means "no default", not "default to the empty string"), and an `esriFieldTypeString` field is given `length: 255`.
  - `deleteColumnFromLayer(layerId, fieldName)` — the inverse, same two shapes:
    - For `drawings`, splices the `drawingFields` entry (if any) and deletes the key off every graphic. A key present on the graphics but not in `drawingFields` is still deleted — uploaded GeoJSON properties are real attributes that were never formally added as a column (see `drawingsFieldSchema`) — so only a name found in *neither* place throws `Column "<name>" does not exist.`
    - For a hosted layer, refuses `layer.objectIdField`/`layer.globalIdField` (they identify each row and are what `applyEdits` keys every update off; ArcGIS rejects deleting them anyway, so refusing here avoids offering a control whose only outcome is an error), gates on `requireLayerCredential`, then POSTs `deleteFromDefinition` with a `{"fields":[{"name":…}]}` body to `adminLayerUrl(layer)`. Before `layer.refresh()` it also deletes the key off `this.selectedGraphic.attributes` when that graphic belongs to the same layer — `refresh()` requeries the service, but the graphic cached from the last `hitTest` keeps whatever attributes it was selected with, so re-opening the panel on the same feature would otherwise still list the dropped column.

### `adminLayerUrl(layer)` — why the schema calls kept failing (2026-08)

Both schema operations are routed through one module-level helper, because getting this URL wrong is what "+ Add Column" failed on, three separate ways, each with an ArcGIS Online error that pointed nowhere near its cause:

- **The admin catalog, not the public one.** `addToDefinition`/`deleteFromDefinition` are only routed under `…/rest/admin/services/…`; the public `…/rest/services/…` path a `FeatureLayer` is constructed from has no such route on ArcGIS Online. Posted there, AGOL's router falls through to a generic handler and answers `400 "Cannot perform query. Invalid query parameters."` — neither a 404 nor a permissions error. (Only ArcGIS Enterprise documents a public per-layer variant.) The helper does the same `/rest/services/` → `/rest/admin/services/` substitution `createHostedFeatureLayer` already needed.
- **Layer level, not service level.** Fields live on a *layer*, so the URL ends in `/<layerId>` and the body is `{"fields":[…]}`. The service-level sibling one segment up, with a `{"layers":[…]}` body, is for adding a whole new layer to a service — that's `createHostedFeatureLayer`'s call, not this one. A per-layer URL carrying a service-level body (or the reverse) is answered with a real but unhelpful `"Unable to add feature service definition."`
- **`layer.url` is not a reliable place to read the index from.** `touristAttractions`/`mrtStations`/`mrtLines` are configured from a bare service root, so their `.url` has no trailing index; a portal-added or app-created layer is constructed from `<service>/0` (see `createHostedFeatureLayer`) and can keep it. The helper strips a trailing `/\d+$` unconditionally and re-appends the index from `layer.layerId`, so both shapes normalize to the same result.
- **`layerId`'s *type* matters.** Parsed off a URL it arrives as the string `"0"`, and ArcGIS Online does not coerce it before its own layer lookup — it crashes internally with a raw .NET `"Object reference not set to an instance of an object"` (a null-reference crash, not a validation message) instead of reporting anything usable. Hence `Number(layer.layerId ?? 0)`.

Two more sources of the same opaque `"Unable to add feature service definition."`, fixed alongside: a string field with **no declared `length`** (the underlying table needs a width to create the column with — 255 is AGOL's own default for a text field), and a **field name that isn't a valid column identifier** (rejected from inside the definition merge, so it surfaced identically to every other malformed request; `addColumnToLayer` now checks it up front and says so).

`serviceErrorMessage(error, fallback)` is the shared error reader for both calls: ArcGIS Online sometimes answers a failed definition change with an **empty** `message` and the real explanation only in `details`, so `message || fallback` threw away the one useful string in the response. Details are joined and used before falling back to a generic message.

**Not verified against a live writable service.** The app's three configured hosted services are published `Query`-only (see *Limitations*), so this path is covered by unit tests against the mocked `esriRequest` and by the ArcGIS REST admin API's documented contract, not by an end-to-end call.

## Never Force a Sign-In

**The app must be fully usable anonymously; sign-in is additive, never a prerequisite.** Two code paths violated this and were fixed:

- `IdentityManager.getCredential(url)` *acquires* a credential, which means **opening the SDK's own sign-in modal** when none exists. `addColumnToLayer` called it unconditionally, so clicking "+ Add Column" always hijacked the page with a login dialog — even though `esriConfig.apiKey` is set, because an API key is not a credential in `IdentityManager`'s registry and is never consulted by `getCredential`.
- `applyEdits` against a service the current identity can't write to returns **403, and `IdentityManager` answers a 403 by opening that same modal**. The three hosted services are published `"capabilities":"Query"` — read-only both anonymously *and* with the app's API key — so every attribute Save did this.

Because cancelling the modal stores nothing, the next attempt prompted again, making it look like the app repeatedly demanded a login.

The rule this establishes:

> Use `findCredential` (a non-prompting lookup returning `undefined`) to decide **whether to offer** a privileged action. Use `getCredential` only **after** you know a credential exists. Never let a permission failure reach the SDK as an unhandled 403.

The rule is not specific to attribute editing — it applies anywhere the app touches a resource whose accessibility it hasn't established. The other current instances are `GISMapEngine.addPortalLayer`, where a publicly *listed* portal item can point at a subscription-only or restricted *service*; it probes with `esriRequest({ authMode: "no-prompt" })` before constructing the `FeatureLayer`, for exactly the same reason (see `knowledge/index.md`'s Portal Layer System); and `createHostedFeatureLayer`/`addFeatureToHostedLayer`, which gate their `createService`/`addToDefinition`/`applyEdits` admin calls with the identical `findCredential` → throw → `getCredential` sequence (see `knowledge/index.md`'s Hosted Feature Layer Creation section).

`AuthService.hasPortalCredential()` is the shared non-prompting check. The portal URL is checked as a fallback because an ArcGIS Online sign-in registers a credential for the *portal*, which federates to hosted services, rather than one per service URL — looking only at the service URL would wrongly block a genuinely signed-in user.

- **FeatureAttributesPanel** takes a `canEdit` prop (default `true`). When false it renders no Edit button and therefore no Add Column form and no per-column delete controls (all three live inside edit mode), showing `Read-only — sign in with an account that can edit this layer.` instead. Attribute values remain fully readable. This gates the *affordance*, not just the attempt, so the user is never offered a control whose rejection would be a login modal.
- **ApplicationShell** computes `canEditSelectedFeature = selectedFeature?.layerId === "drawings" || Boolean(signedInUser)`. Drawings are in-memory and always editable, signed in or not. Hosted layers show editing controls only once a real session exists — which, with `VITE_ARCGIS_OAUTH_CLIENT_ID` unset (the default), is never.

- **FeatureAttributesPanel (src/components/FeatureAttributesPanel.jsx)**
  - Props: `feature`, `onClose`, `onSaveAttributes`, `onAddColumn`, `onDeleteColumn`, `canEdit`. Renders nothing when `feature` is `null`.
  - Renders as a popup positioned at the click's screen coordinates (`feature.x`/`feature.y`), offset slightly (`OFFSET`); flips to the left/above when it would overflow the window (`overflowsRight`/`overflowsBottom` checks against `window.innerWidth`/`innerHeight`, using `POPUP_WIDTH`/`POPUP_MAX_HEIGHT`).
  - Lists every key/value pair in `feature.attributes` under a header showing `feature.layerTitle`.
  - **Edit mode** (toggled by the footer's *Edit* button): each attribute becomes a text `<input>` bound to a local `draft`, except the `objectIdField` which stays read-only. *Save* calls `onSaveAttributes(draft)`; *Cancel* discards the draft. A per-selection `selectionKey` (`layerId:x:y`) resets edit state when a *different* feature is selected but not when the same feature's attributes are updated in place after a save/add round-trip.
  - **Add Column** form (shown only in edit mode): a column-name input, a default-value input, and an *+ Add Column* button that calls `onAddColumn(name, defaultValue)`. The button is `disabled` (with an "Enter a column name first" tooltip) whenever the name field is blank — a blank name was always silently ignored, but with nothing disabled the button looked identically clickable either way, which read as broken rather than inert.
  - **Delete Column** (shown only in edit mode, and only when an `onDeleteColumn` prop is supplied): each editable row — i.e. every row except `objectIdField` — gets a `✕` button labelled *Delete column `<name>`*. It does **not** delete on first click: it arms a `pendingDelete` confirmation that replaces that row in place (`Delete "<name>"?` plus *Delete* / *Keep*), since dropping a column destroys that value on every feature in the layer and, for a hosted layer, isn't undoable from here. The dismiss button is *Keep*, not *Cancel*, deliberately: the footer's own *Cancel* exits edit mode entirely, and two adjacent buttons both named Cancel doing different things is a trap in a popup this narrow. Confirming calls `onDeleteColumn(key)` and also drops the key from the local `draft`, so a subsequent *Save* can't re-send the just-deleted attribute. `pendingDelete` is cleared on selection change and on *Cancel*.
  - Close button (`✕`) clears selection via `onClose`; selecting a different feature or clicking empty map space also clears/replaces it.

- **ApplicationShell (src/app/ApplicationShell.jsx)**
  - Holds `selectedFeature` state, set via `engineRef.current.setOnFeatureSelect(setSelectedFeature)` inside `handleViewReady` (re-registered on every view/engine attachment, including 2D/3D switches).
  - `handleSaveAttributes(updates)` — calls `engine.updateSelectedFeatureAttributes`, merges the returned attributes back into `selectedFeature`, and shows a toast (success or error message).
  - `handleAddColumn(fieldName, defaultValue)` — calls `engine.addColumnToLayer(selectedFeature.layerId, fieldName, "esriFieldTypeString", defaultValue)`, optimistically adds the key to `selectedFeature.attributes`, and shows a toast.
  - `handleDeleteColumn(fieldName)` — mirrors it: calls `engine.deleteColumnFromLayer(selectedFeature.layerId, fieldName)`, drops the key from `selectedFeature.attributes` so the popup reflects it without waiting for another `hitTest`, and shows a toast.
  - Renders `<FeatureAttributesPanel feature={selectedFeature} onClose={...} onSaveAttributes={handleSaveAttributes} onAddColumn={handleAddColumn} onDeleteColumn={handleDeleteColumn} canEdit={canEditSelectedFeature} />` inside `map-container`, alongside `FloatingDrawTools`.

## Workflow
1. User clicks the map.
2. `GISMapEngine`'s click handler runs `hitTest`, scoped to the selectable layers (Tourist Attractions, MRT Stations, MRT Lines, Drawings, and every portal layer). Route and stop graphics are excluded.
3. If a feature is hit, its `layerId`, `layer.title`, `objectIdField`, `attributes`, and click coordinates are packaged and handed to the `onFeatureSelect` callback; the engine also caches the graphic (`selectedGraphic`) for later edits.
4. `ApplicationShell` stores the result in `selectedFeature` state, causing `FeatureAttributesPanel` to render.
5. The user may click *Edit* to change values (saved via `updateSelectedFeatureAttributes`), add a new column (via `addColumnToLayer`), or delete one (via `deleteColumnFromLayer`, behind a per-row confirmation).
6. Clicking empty map space (or a non-selectable graphic) clears the panel.

## Dependencies
- **ArcGIS Core SDK**: `MapView`/`SceneView` `hitTest`, `FeatureLayer.applyEdits`, `IdentityManager.getCredential`, and `esriRequest` (used for the `addToDefinition`/`deleteFromDefinition` schema changes).
- Reuses the four existing selectable layers created in `attachToView`; introduces no new layers.

## Limitations
- Only the layers listed in `selectableLayers` are clickable for attributes (the three fixed hosted layers, Drawings, and portal layers); `route` and `stops` graphics are intentionally excluded, as are named heatmap/route/search/buffer result layers.
- Raw attribute values are rendered/edited as strings; no field aliasing, formatting, or domain/coded-value lookup is performed.
- Only one feature is shown at a time — if multiple selectable features overlap at the click point, only the first `hitTest` result with attributes is used.
- **Drawings edits/columns are in-memory only** — they are not persisted to any service and are lost on reload, and (per the Drawing System docs) are not included in the GeoJSON export.
- **Deleting a column is not undoable and is not confined to the selected feature** — `deleteFromDefinition` drops the column from the *layer*, destroying that value on every feature in it. The panel's per-row confirmation is the only guard; there is no restore path from inside the app.
- **Hosted-layer edits require privileges** — editing attribute values (`applyEdits`) and adding/deleting a column (`addToDefinition`/`deleteFromDefinition`) all require an authenticated user with edit/admin rights on the service item, not just the app's public API key. The three *configured* hosted services are published `Query`-only, so these operations are unavailable on them to every identity the app has; the UI reflects that by hiding the controls rather than failing when used (see *Never Force a Sign-In*). A layer the signed-in user created through `createHostedFeatureLayer` (published `Create,Delete,Query,Update,Editing`) or added from their own portal content is the realistic target for all three.
- **Editing is unreachable until OAuth is configured.** `canEditSelectedFeature` keys off `signedInUser`, which stays `null` while `VITE_ARCGIS_OAUTH_CLIENT_ID` is unset — the default. Enabling hosted-layer editing therefore takes two independent steps: configure the OAuth client ID (so a user *can* sign in), **and** enable editing on the service items in ArcGIS Online (so the signed-in owner is actually permitted). Neither alone is sufficient.
- **`capabilities` is read once, at layer load.** `attachToView` constructs the `FeatureLayer`s anonymously, so `supportsUpdate` reflects the identity at load time. Signing in mid-session does not re-load them, so a fresh sign-in may still report read-only until the next 2D/3D switch rebuilds the layers. Reloading the page is the reliable path.
- **A credential existing does not mean it is sufficient.** `findCredential` only proves *someone* is signed in, not that they own the layer. A signed-in user without edit rights still gets a service-side error — surfaced as a toast, not a modal.
- The click handler is reattached on every `attachToView` call (2D/3D switch); the previous handle is removed first to avoid duplicate handlers.
