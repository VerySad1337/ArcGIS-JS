---
name: responsive-layout
description: Concise documentation of the mobile/responsive layout behavior of the ArcGIS JS app shell
metadata:
  type: reference
---

# Responsive Layout System

## Purpose
Keeps the app usable on narrow viewports (e.g. iPhone 15 Pro, 393px wide) by turning the always-visible desktop sidebar into a collapsible overlay drawer and rescaling floating UI so it doesn't overflow the screen.

## Architecture
- **ApplicationShell (`src/app/ApplicationShell.jsx`)**
  - Owns `sidebarOpen` state (default `false`).
  - Renders a `.sidebar-toggle` button (hamburger `☰` / close `✕`) that flips `sidebarOpen`.
  - Renders a `.side-panel-backdrop` when `sidebarOpen` is true; clicking it closes the drawer.
  - Adds the `open` class to `.side-panel` when `sidebarOpen` is true.
- **gis-theme.css (`src/styles/gis-theme.css`)**
  - All responsive rules are scoped under a single `@media (max-width: 768px)` breakpoint; desktop layout (`.side-panel` as a static 380px column) is untouched above that width.
  - `.sidebar-toggle` and `.side-panel-backdrop` are `display: none` by default and only shown inside the breakpoint.

## Behavior at ≤768px
- **Sidebar** — `.side-panel` becomes `position: fixed`, off-canvas (`transform: translateX(-100%)`), capped at `min(85vw, 340px)`. Toggling `sidebarOpen` slides it in (`.open` → `translateX(0)`) over a semi-transparent backdrop, instead of permanently occupying screen width next to the map.
- **FAB (`FloatingDrawTools`)** — `.fab-container`/`.fab-main` shrink from 60px to 52px and sit closer to the corner (`right: 20px; bottom: 24px`); `.fab-tool` fan buttons shrink from 48px to 44px. The fan-out radius itself (`FAN_RADIUS = 110` in `FloatingDrawTools.jsx`) is a JS constant, not CSS, and is unchanged — it still fits on-screen at these container positions because the container itself moved further from the edge.
- **Feature attributes popup (`FeatureAttributesPanel`)** — `.feature-attributes-panel` gets `max-width: calc(100vw - 28px)` on top of its normal 280px width, so it can't overflow horizontally on narrow screens. Its existing edge-avoidance logic (`overflowsRight`/`overflowsBottom` computed from click coordinates in `FeatureAttributesPanel.jsx`) is unchanged.
- **Toast (`.gis-toast`)** — capped at `max-width: calc(100vw - 40px)` with `box-sizing: border-box` so long messages can't push it off-screen.

## Key Decisions
- **Drawer over shrink-to-fit.** A stacked/shrunk sidebar was rejected in favor of an overlay drawer, because permanently reserving vertical or horizontal space for the sidebar on a small screen would leave too little room for the map, which is the primary content.
- **CSS-only breakpoint, single toggle state.** No new engine or layer logic was needed; the fix is confined to `ApplicationShell.jsx` (one boolean) and `gis-theme.css` (one media query block), preserving the existing desktop behavior exactly.

## A recurring class of bug: form controls don't shrink like other flex items

`LayerControlPanel`'s per-layer row (`.layer-row`, see `knowledge/index.md`'s Layer Styling System) already packs five icon-sized controls (eye, drag, zoom, up/down, chevron) onto one line, with `.layer-name` the only item that actually gives up space when things get tight (it alone has `min-width: 0`; every icon button is small enough that its intrinsic size never becomes the bottleneck). When the Layer Grouping System's per-row `<select>` was first added directly into that same line, it didn't behave like the icon buttons: a `<select>` (like `<input>`) defaults to a **content-based** `min-width`, not `0` — a flex item's `min-width: auto` resolves to its own minimum content size for form controls, not to zero the way a `<div>`'s would. `flex-shrink: 1` alone doesn't override this; the item simply refuses to shrink past that floor. The practical effect: the select rendered at nearly full size no matter how little room was left, and `.layer-name` — the only item both willing and able to shrink — absorbed the *entire* deficit, collapsing to 3-4 visible characters.

The fix that shipped was **not** `min-width: 0` on the select (that alone still left too little combined room once five icon buttons + a select + the name all fought over one ~310px line). It was giving the group picker **its own full-width line** below the row (`.layer-group-picker`, styled like `.heat-slider-container`'s existing sibling-block pattern) instead of making it one more competitor on the row's single line. Any future control added to this row should default to a sibling block below the row, not a new item squeezed into `.layer-row-secondary` — that line is already at capacity.

**Second round: a portal layer's name was still truncated even with the select moved out.** `.layer-zoom-btn`/`.layer-reorder-btns`/`.layer-chevron-btn` are `opacity: 0` at rest (see the "Reorder/zoom/chevron controls" rule in `gis-theme.css`) so they're invisible until hover/focus - but `opacity: 0` still reserves each control's *full* box width. Combined with a portal layer's always-visible `.layer-remove-btn` (which has no hover-recessed treatment at all), a removable layer's row was carrying the same visual weight as five icon-sized controls even though three of them were invisible at rest - dead space that only `.layer-name` (the one item with `min-width: 0`) gave up, so a long portal item title (e.g. "Singapore Subzone Boundaries") still got crushed to a handful of characters. The fix extended the existing opacity-based hide to also collapse width (`width: 0; padding: 0; overflow: hidden` at rest, restored to `width: auto` alongside `opacity: 1` on `:hover`/`:focus-within`), so an invisible control stops reserving space it isn't using. This reclaims real room for the name at rest, at the cost of a small layout reflow when the row is hovered/focused (the name re-truncates slightly as the icons pop back in) - an accepted trade-off since the alternative (permanently reserved dead space) was crushing far more common shorter names too. `.layer-remove-btn` itself was deliberately left always-visible/full-width (removing a layer is a meaningful, not-safely-hidden action) — the two-line move above is what makes room for it now, not a hover-hide.

## Verification
Manually verified via a headless Chromium screenshot at a 393×852 viewport (iPhone 15 Pro): the map fills the screen by default with the drawer closed, and clicking `.sidebar-toggle` opens the drawer over the map without corrupting the underlying layout.
