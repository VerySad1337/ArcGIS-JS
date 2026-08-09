---
name: ui-feedback
description: Concise documentation of the app's user-feedback and accessibility affordances - toasts, draw-status chip, first-run hint, busy states, screen-reader announcements, and the shared icon set
metadata:
  type: reference
---

# UI Feedback & Accessibility System

## Purpose
Every subsystem in this app performs work that settles asynchronously (geocoding, routing, sketching, uploading, portal search, camera moves) or fails in ways the map itself cannot show. This document covers the cross-cutting affordances that report those outcomes to the user, plus the accessibility behavior that makes them usable without a mouse or a screen.

It is cross-cutting by nature: no single subsystem owns it, which is why it is documented separately rather than repeated in `drawing-system.md`, `upload-system.md`, and `feature-attributes.md`.

## Toasts

- **Single owner.** `ApplicationShell` holds `toast` state (`{ message, type }`) and the `showToast(message, type = "error")` function. Nothing else in the app renders a message. The default type is `"error"`, so a bare `showToast(msg)` call is treated as a failure.
- **Type-dependent lifetime.** Non-error toasts auto-dismiss after `TOAST_DURATION_MS` (4000ms). **Error toasts do not auto-dismiss** — they stay until the user clicks the close button. A 4s auto-hide risks the user missing the reason an action failed, whereas a success message has nothing to re-read.
- **One at a time.** `showToast` clears any pending dismissal timeout before setting the new message, so a rapid sequence of actions cannot leave an earlier toast's timer to dismiss a later toast prematurely.
- **Markup and semantics.** Rendered as an `<output>` element with `className="gis-toast gis-toast-<type>"`. Errors additionally carry `role="alert"` so assistive technology announces them immediately; success/info messages deliberately do not, to avoid interrupting the user for routine confirmations. A dedicated close button (`aria-label="Dismiss"`) calls `dismissToast`.
- **How the engine reports into it.** `GISMapEngine` never imports React or renders anything. Methods whose failure only the engine can detect take an optional `msg` callback — `zoomToLayer(id, msg)`, `uploadGeoJSON(file, msg)`, `saveDrawings(msg)` — and the shell passes `showToast` in. Methods a caller can meaningfully `try/catch` (`updateSelectedFeatureAttributes`, `addColumnToLayer`, `addPortalLayer`) throw instead, and the shell converts the thrown message. See `knowledge/architecture.md`'s Key Architectural Decisions.

### Messages by source

| Trigger | Type | Message |
| --- | --- | --- |
| Route solve fails | error | the thrown message, else "Couldn't calculate a route between those locations." |
| 2D/3D switch with a sketch in progress | error | "Switching views cancelled your in-progress drawing." |
| Zoom to an empty layer | error | "Nothing to zoom to on this layer yet." |
| `goTo` rejects during zoom-to-layer | error | "Could not zoom to this layer." |
| Export with nothing drawn | error | "Please draw something, before saving" |
| Export succeeds | success | "GeoJSON downloaded" |
| Upload blocked by existing drawings | error | "Please save your current drawing and refresh the page before uploading" |
| Upload succeeds | success | `Uploaded N feature(s) from "<file>".` + `(K unsupported feature(s) skipped)` when K > 0 |
| Upload throws | error | "Upload failed: the file could not be read as valid GeoJSON." |
| Attribute save / add column | success or error | "Attribute changes saved." / `Column "<name>" added.` / the thrown message |
| Portal search / add layer | error / success | the thrown message, else "Portal search failed." / "Failed to add layer." / `Added "<title>" to layers.` |
| Sign in / sign out | success or error | `Signed in as <fullName>.` / "Signed out." / the thrown message, else "Sign-in failed or was cancelled." |

Note `removePortalLayer` is deliberately silent — the layer row disappearing from the panel is its own confirmation.

## Draw-status chip
Covered in detail in `drawing-system.md`'s *Draw State Reporting* section. Summary: `FloatingDrawTools` renders a `.draw-status-chip` `<output>` ("Drawing point…/line…/polygon…") plus a Cancel button whenever the shell's `activeDrawType` is set, which the engine drives from the `SketchViewModel` "create" state machine via `setOnDrawStateChange`.

## First-run hint
`ApplicationShell` tracks `hasInteracted` (initially `false`) and renders `.map-first-run-hint` over the map — "Search a route above, or tap + to start drawing" — until it flips. It is set by the first meaningful action: starting a route, picking a search result, starting any draw, or uploading a file. It is deliberately **not** reset, and is not persisted across reloads.

## Busy states
- **Route search** — `isRouting` state is set around `handleRoute` and passed to `AnalysisPanel` → `RouteInput` (route search moved into the "ANALYSIS" card's Route Search section — see `knowledge/index.md`'s Routing System "UI" note), which disables the submit control while the geocode+solve round-trip is in flight. Both geocode calls and the route solve are sequential network calls, so the window is long enough to invite a double-submit without this.
- **Global search** — `GlobalSearchPanel` owns its own `searching` state (the search is the panel's own async prop call, not shell state), swapping the button label to "Searching…" and disabling it. It also guards against out-of-order responses with a monotonically increasing `requestIdRef`: a response is discarded if a newer search started while it was in flight, so pressing Enter twice can't leave the older result set rendered.
- **Portal sign-in** — `signingIn` state disables the sign-in control during the OAuth popup round-trip.

## Keyboard & screen-reader support

- **Sidebar drawer** — opening it moves focus into `.side-panel` (`tabIndex={-1}` + ref); `Escape` closes it and returns focus to `.sidebar-toggle`. See `responsive-layout.md`.
- **Feature attributes panel** — on selection, focus moves to the panel's Close button and `Escape` closes it. See `feature-attributes.md`.
- **Layer reordering has a non-drag path.** Drag-and-drop is unusable by keyboard and hostile on touch, so every layer row also has explicit *Move layer up* / *Move layer down* buttons (disabled at the ends of the list), and the drag handle itself responds to `ArrowUp`/`ArrowDown`. All three paths converge on the same `onReorder(from, to)` prop.
- **Reorder announcements.** Because a reorder's only visual result is rows changing position, `ApplicationShell` holds `reorderAnnouncement` and renders it in an always-present `.sr-only` `<span role="status" aria-live="polite">`. After each reorder it sets `"<layer name> moved to position N of M."`. The live region is rendered unconditionally (not mounted on demand) because a region inserted at the same time as its text is not reliably announced.
- **Labelled controls.** Icon-only buttons carry `aria-label`s that include the layer name where relevant (`Hide <layer>`, `Zoom to <layer>`, `Remove <layer>`). The 2D/3D control is a `fieldset` (`aria-label="Map view mode"`) of two buttons using `aria-pressed`, rather than a single toggle button whose label states the *other* mode — that phrasing is ambiguous under a screen reader.
- **Layer panel empty state.** `LayerControlPanel` renders "Layers will appear here once the map finishes loading." rather than an empty box, since `layers` is `[]` until the first `attachToView`/`refreshLayers` completes.
- **Reduced motion.** A top-level `@media (prefers-reduced-motion: reduce)` block in `gis-theme.css` disables transitions/animations app-wide (not scoped to the mobile breakpoint).

## Icon set (`src/components/Icon.jsx`)
One inline-SVG icon component with a `PATHS` map keyed by name (`point`, `line`, `polygon`, `save`, `upload`, `eye`, `eyeOff`, `drag`, `zoomTo`, `arrowUp`, `arrowDown`, `chevronUp`, `chevronDown`, `close`, `menu`, `search`, …), taking `name`, `size`, and `className`.

It exists because the controls previously used a mix of emoji and bare unicode glyphs (📍 ⬠ 📏 💾 📂 👁 🚫 ☰ ▲ ▼ ✕), which render at inconsistent sizes, weights, and colors across operating systems and font stacks — and which screen readers announce as their emoji names. Inline SVG inherits `currentColor` and font size, so icons stay consistent with the surrounding control and with each other. Imported by `ApplicationShell`, `FloatingDrawTools`, `LayerControlPanel`, `GlobalSearchPanel`, and `PortalLayerPanel`.

Icons are decorative in every current usage — the accessible name always comes from the parent button's `aria-label` or `title`, never from the icon.

## Known gaps
- `GlobalSearchPanel.jsx` and `Icon.jsx` have no test files, unlike every other component (see `knowledge/index.md`'s Testing System).
- The search results dropdown uses `role="listbox"`/`role="option"` but has no arrow-key navigation between options; results are reachable by Tab only.
- Toast messages are not localized and are not surfaced anywhere after dismissal (no message history/log).
