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
- `src/components/LayerControlPanel.jsx` – Layer panel UI. Renders the layer list, visibility toggle, zoom-to-layer, remove (portal layers only), reordering, heat intensity slider, and — for stylable layers — a per-layer chevron toggle (collapsed by default) that reveals one style-control block per `styleGroups` entry: a color `<input type="color">` and a border-width `<input type="number">` always, plus a border-color `<input type="color">` when that group's `symbolType` is `simple-fill`. Each control calls `onStyleChange(id, { ...change, symbolType })`. Reordering has three equivalent input paths — drag-and-drop, per-row Move up/Move down buttons, and `ArrowUp`/`ArrowDown` on the focused drag handle — all converging on `onReorder(from, to)`; the shell mirrors each move into an `aria-live` announcement (see `knowledge/features/ui-feedback.md`).
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
- Portal layers – added at runtime with a service-supplied renderer of unknown shape, so there is no single symbol to expose. Their rows get a remove control instead.

Layers with no style groups still render a row (with the chevron hidden via `visibility: hidden`, preserving the row's column alignment).

**Style groups:** `getLayers()` exposes styling as a `styleGroups` array per layer rather than a single flat `color`/`borderWidth`, built by `symbolToStyleGroup(symbol, label)`. `route`, `touristAttractions`, `mrtStations`, and `mrtLines` each yield exactly one group (they own a single renderer/graphic symbol). `drawings` is the exception: since `drawLayer` holds heterogeneous graphic types (see Drawing System) with no restriction on what coexists, `getLayers()` scans `drawLayer.graphics` for every distinct symbol type present (`simple-marker`/`simple-line`/`simple-fill`) and returns one style group per type, so points/lines/polygons drawn together each get independent color/border controls instead of the whole layer being styled off one arbitrarily-chosen graphic. `setLayerStyle(id, { color, borderWidth, outlineColor, symbolType })` mirrors this: for `drawings`, passing `symbolType` scopes the update to only graphics of that geometry type. `outlineColor` (a border color distinct from fill color) only applies to `simple-fill` (polygon) groups.

**UI gating:** `LayerControlPanel.jsx` hides all style controls behind a per-layer chevron toggle (collapsed by default) and renders one control block per `styleGroups` entry; polygon groups (`symbolType === "simple-fill"`) get Fill Color + Border Color + Border Width, point/line groups get Color + Border Width.

**Drawings refresh:** because drawing a new graphic is asynchronous (`SketchViewModel` "create" completes after the user finishes sketching), the engine calls `onDrawingsChanged` (registered via `setOnDrawingsChanged`) when a graphic completes, which `ApplicationShell` wires to `refreshLayers()` — without this, the panel's `layers` state would keep serving the pre-drawing snapshot and never show style controls for a just-drawn graphic.

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

**Deliberately excluded:** Portal layers are not wired into `handleFeatureClick`'s selectable-layers list or the attribute-edit path (`resolveLayerId`/`hostedLayerById`/`updateSelectedFeatureAttributes`) — they are visualize/toggle/zoom-only. Extending click-to-select and editing to arbitrary portal layers would need per-layer schema handling beyond what a user-added layer of unknown shape can assume.

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
  - `searchFeatures(query)` – queries `touristAttractionLayer`/`mrtStationLayer`/`mrtLineLayer` (via `searchHostedLayer`) and the local `drawLayer` (via `searchDrawings`), returning up to 10 matches per layer.
  - `zoomToSearchResult(result)` – `view.goTo(result.geometry)`, then reuses the `onFeatureSelect` callback (the same one `handleFeatureClick` uses) so picking a search result opens `FeatureAttributesPanel` exactly like clicking the feature on the map would.
  - `zoomToPoint(longitude, latitude)` – `view.goTo` for an address match, plus drops a diamond marker `Graphic` on a dedicated `searchLayer` (part of `layerOrder`, id `searchResult`) so the geocoded point is visibly confirmed on the map, not just centered under the camera. `searchGraphic`/`searchLayer` follow the same persist-on-the-engine, restore-in-`attachToView` pattern as `routeGraphic`/`routeLayer`, so the marker survives a 2D/3D reattachment. Each call replaces the previous marker rather than accumulating one per search. An address match has no backing layer graphic/schema, so (unlike a feature result) it never opens `FeatureAttributesPanel`.
- `src/components/GlobalSearchPanel.jsx` – search box + results dropdown UI, rendered at the top of the sidebar (above `RoutingControlPanel`). Owns its own `searching`/`searched`/`open` state and a `requestIdRef` guard that discards an in-flight response once a newer search has started, so pressing Enter twice can't leave the older result set rendered. Each result row shows a human-readable layer label (`LAYER_LABELS`, keyed by `layerId` and falling back to `type` for address matches).
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
- `my-arcgis-app/src/**/*.test.{js,jsx}` – one test file per component/service/hook (`ApplicationShell`, `FeatureAttributesPanel`, `FloatingDrawTools`, `GISMapView`, `LayerControlPanel`, `PortalLayerPanel`, `RouteInput`, `RoutingControlPanel`, `GISMapEngine`, `useHeatmapAnalysis`, `useRoutingEngine`, `heatmapLayer`, `GeocodingService`, `RoutingService`, `PortalService`, `AuthService`). `HeatmapControlPanel`, `ViewControlPanel`, `RouteSearchPanel`, and `SidePanel` were removed as dead code — they duplicated logic already hand-rolled inline in `RoutingControlPanel`/`ApplicationShell` and were never imported by any app code.
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