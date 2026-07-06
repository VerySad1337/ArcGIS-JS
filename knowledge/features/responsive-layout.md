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

## Verification
Manually verified via a headless Chromium screenshot at a 393×852 viewport (iPhone 15 Pro): the map fills the screen by default with the drawer closed, and clicking `.sidebar-toggle` opens the drawer over the map without corrupting the underlying layout.
