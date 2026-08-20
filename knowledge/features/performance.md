# Performance

**Purpose:** Documents the deliberate performance decisions in this app — what was measured, what was changed, and which costs were accepted rather than removed. The app was reported as feeling "slow and clunky compared to ArcGIS Online map and scene"; this file records the causes that were found and fixed, so a later change doesn't quietly undo one of them.

Three independent costs were identified, in descending order of impact:

1. **Bytes and requests on first load** — an entry chunk of 3.76 MB served uncompressed, over HTTP/1.1, with ~480 preloaded module chunks.
2. **React re-render fan-out** — every shell state change re-rendered the entire panel tree, including `LayerControlPanel`'s ~1500 lines of nested per-layer forms.
3. **Continuous-drag inputs driving the engine at pointer frequency** — each pointer event on a slider cost an ArcGIS renderer rebuild plus a full `getLayers()` projection.

---

## 1. First load: bytes, compression, and request count

### 3D is loaded on demand, not in the entry chunk

`GISMapView.jsx` imports `@arcgis/map-components/components/arcgis-map` and `arcgis-zoom` at module scope, but **not** `arcgis-scene`. Registering the scene element statically pulls the whole SceneView/3D graph (WebGL techniques, 3D symbol layer factories, elevation/I3S handling) into the entry chunk, which every visitor downloaded and parsed on first paint even though `ApplicationShell` always starts in 2D (`useState(false)` for `is3D`) and a session may never switch.

`loadSceneComponent()` performs a dynamic `import()` the first time `is3D` becomes true, caching the promise at module scope so switching back and forth doesn't re-enter it. Until it resolves, the component renders a `.map-view-loading` placeholder (`role="status"`, "Loading 3D view…") sized identically to the map so nothing shifts.

**The element is rendered only after the definition loads, deliberately.** Rendering `<arcgis-scene>` before its custom element is defined would leave an un-upgraded element that React has already attached its ready-event handler to; the upgrade timing of that handler is exactly the kind of ambiguity that surfaces as "the 3D view sometimes never initializes." Waiting is cheap and unambiguous.

Measured effect of this one change (`vite build`, before vs. after):

| | Before | After |
| --- | --- | --- |
| Entry chunk, raw | 3,764,393 B | 2,334,033 B |
| Entry chunk, gzipped | 1,004,982 B | 602,116 B |
| `modulepreload` links in `index.html` | 476 | 288 |

The 3D machinery now lives in its own `arcgis-scene-*.js` chunk (896 KB raw / 228 KB gzipped) fetched only on the first 2D → 3D switch.

**Consequence for tests:** `GISMapView.test.jsx`'s 3D case must `await waitFor(...)` for the element rather than asserting synchronously, and there is a second test covering the placeholder. This is the intended behavior change, not a workaround.

### nginx compresses, and speaks HTTP/2

`nginx.conf` previously enabled neither. The stock `nginx:alpine` image ships with `gzip` commented out, so the entry chunk went over the wire at its full 3.76 MB — the single largest cost on a cold load, ahead of anything in the application code.

- `gzip on` (level 6, `gzip_min_length 1024`, `gzip_vary on`) scoped to JS/CSS/JSON/SVG/plain text. The `.woff2` fonts and ArcGIS `.wasm`/image assets are deliberately excluded: they are already-compressed formats, so re-compressing them burns CPU for no gain. `gzip_vary` matters here specifically because `/assets/` is served `immutable` — a cache must key on encoding or a proxy can hand a gzipped body to a client that never asked for one.
- `http2 on;` (directive form, nginx 1.25.1+). The ArcGIS SDK ships as a very large number of small ES module chunks, and Vite emits a `modulepreload` link for each one the entry statically imports. On HTTP/1.1 a browser opens ~6 connections per origin, so a few hundred preloads queue in waves and the *waterfall*, not the bytes, becomes the bottleneck. Validated with `nginx -t` against the real `nginx:alpine` image.

Combined with the deferred 3D chunk, first-load JS drops from **3.76 MB transferred to ~0.66 MB** (entry + `react-vendor`, gzipped).

### Build configuration (`vite.config.js`)

- `build.target: 'es2022'` — the default downlevels syntax the ArcGIS SDK already requires a modern engine for, which only inflates a bundle this size. Every browser that can run a WebGL `SceneView` supports es2022.
- `manualChunks` pins **only** React/react-dom/scheduler into a `react-vendor` chunk (190 KB raw / 59 KB gzipped). It changes on a completely different cadence from the app code, so it caches well on its own.
- **`@arcgis/core` is deliberately *not* force-bundled into a vendor chunk.** It relies on its own dynamic imports for lazy loading (SceneView, VideoLayer, ImageryLayer, arcade, …) and Rollup already splits those out — that is what the ~1400 hashed chunks in `dist/` are, and what `nginx.conf`'s immutable `/assets/` policy and the "stale-deploy 404s" note in `knowledge/deployment.md` are both about. A `manualChunks` rule sweeping it into one file would collapse that back into a single multi-megabyte download on first paint. This is the most likely way for a future change to accidentally undo this work.
- `chunkSizeWarningLimit: 1500` — the 500 kB default can never be met here (the SDK's own core chunks exceed it by construction), so the warning was pure noise on every build.
- `optimizeDeps.include` names the four `@arcgis/core` entry points the engine imports, so the dev server prebundles them on start instead of discovering them lazily and re-optimizing (with a page reload) partway through the first few loads. Dev-server only; no effect on a production build.

---

## 2. React re-render fan-out

**Every handler in `ApplicationShell` is wrapped in `useCallback`, and every child panel is wrapped in `React.memo`.** The two go together and neither works alone: an inline arrow or a re-created function prop changes identity on every render, which defeats `memo` entirely.

Before this, a single layer-visibility toggle — or one frame of a colour-picker drag — re-rendered the whole panel tree, `LayerControlPanel`'s per-layer Symbology/Filter/Aggregate/Annotate/Details forms included, even though only the layer list had changed.

Memoized components: `GISMapView`, `LayerControlPanel`, `AnalysisPanel`, `FloatingDrawTools`, `FeatureAttributesPanel`, `GlobalSearchPanel`, `PortalLayerPanel`, `CreateFeatureLayerPanel`, `AccountButton`, `ViewModeToggle`, `RouteInput`, `Icon`, `ThrottledRangeInput`.

- **`GISMapView` is the important one** — the map element is by far the most expensive node in the tree to touch, and none of its props change when unrelated shell state (a toast, a draw-state flip, a layer refresh) does.
- **`Icon` is memoized for the opposite reason** — it is the most-instantiated component in the app (several per layer row), and its props are a string and a number, so the comparison is trivially cheap next to rebuilding the SVG element tree.
- **`drawTargetOptions` is `useMemo`d.** It is derived from `layers` and would otherwise be a fresh array on every render, making `FloatingDrawTools`' `memo` a no-op.

**`refreshLayers` was left as-is: it still calls `getLayers()` and always sets a new array.** It is called after essentially every engine mutation, and `getLayers()` is a non-trivial projection (it walks `drawLayer.graphics` for distinct symbol types, resolves five `*LayerMeta` maps, and runs `hasEditCredential` per layer). Making it change-detecting was considered and rejected: the projection produces fresh objects by construction, so a correct comparison would be a deep one, and the memo boundaries above already stop the fan-out at the two components that genuinely depend on `layers`. Revisit only with a profile showing `getLayers()` itself as hot.

**Not changed, and why:** `<React.StrictMode>` in `main.jsx` double-renders every component in development. That roughly halves dev-mode render throughput, and is a real part of "it feels slow when I'm working on it" — but it is a correctness tool that catches exactly the impure-render bugs this codebase's engine/React seam is prone to, and it has no effect on a production build. It stays.

---

## 3. Continuous-drag inputs

Two controls fed the ArcGIS engine directly from the raw ~60 Hz pointer stream:

- a named heatmap layer's **Heat Intensity** slider (`LayerControlPanel`), where each commit rebuilds a `HeatmapRenderer` and re-renders the whole density surface;
- a style group's **Opacity** slider (`RendererControls`), where each commit clones and reassigns the layer's symbol — for `drawings`, once per graphic.

Both now go through `ThrottledRangeInput`, built on `useThrottledCallback` (`src/hooks/`).

**The throttle is leading-edge with a trailing flush**, at 80 ms (~12 commits/second):

- *Leading edge* — the first call in a burst runs synchronously, so a single discrete interaction (a click, one keyboard nudge) behaves exactly as before and needs no waiting. This is also what keeps the existing "moving the slider calls `onUpdateHeatmapLayerIntensity`" test passing unchanged.
- *Trailing flush with the latest arguments* — a plain "drop everything inside the window" throttle would lose the value a user actually released the thumb on.

**The thumb position is local state, not the `value` prop.** A throttled commit means the prop lags a drag in progress by up to one interval; feeding that lagged value back into a controlled input would snap the thumb backwards under the user's finger. `value` is therefore read once, on mount, and a caller that needs the slider re-seeded from a value changed elsewhere (a project load) **re-keys it** — the same convention `LayerControlPanel` already uses for `RendererControls` via its `projectVersion` prop. The heat slider is keyed `heat-${projectVersion}`; the opacity slider inherits it from `RendererControls`' own key.

`onDraftChange` exists for the readout beside the heat slider ("Heat Intensity: 65"), which must follow the drag rather than the throttled commit or it would visibly lag the thumb. `HeatIntensitySlider` (a real component in `LayerControlPanel.jsx`, not inline JSX in the row `.map()`) exists purely to give that draft value somewhere to live.

**Colour and numeric inputs were deliberately left synchronous.** `<input type="color">` also fires continuously while a user drags inside the picker, so the same argument applies — but those inputs' assertions in `LayerControlPanel.test.jsx` fire immediately after each interaction, and several occur within one throttle window of each other, so throttling them would trade a real behavioral guarantee (the panel's committed style always matches what the tests assert synchronously) for a smaller win than the two range inputs give. Revisit if colour dragging is reported as janky in its own right.

---

## 4. Retained browser memory (2026-08)

The three sections above are all about CPU and bytes on the wire. The one thing none of them bounded is memory the tab *keeps*.

**`ChatPanel`'s `protocolMessages` grew for the whole session.** It is the literal array `mcp-chat-proxy` round-trips, so every tool result the model ever saw stayed in it - whole `search_portal_layers` payloads, feature-query JSON, statistics results - and because the service is stateless by design (see `knowledge/features/chatbot-mcp-system.md`) the entire array was also re-uploaded on every request. Both costs grow without limit on a tab left open all day.

`services/chatTranscript.js`'s `trimTranscript` caps it at 128 KB by dropping whole oldest exchanges. Two constraints shape it, and neither is optional:

- **It cuts only on user-turn boundaries.** An assistant `tool_calls` entry and the `tool` message answering it are paired by `tool_call_id`, and `chatLoop.js` walks the array relying on that pairing (`knownPortalItems`, `renameOwedAfterAdd`). A `user` message is the only position guaranteed not to sit between the two, so it is the only safe cut point.
- **It runs only at the start of a new user turn, never mid-chain.** A turn in flight still owes a tool result under a specific `callId`; trimming underneath it would strand that pairing. `handleSubmit` calls it; `handleLoopResult` deliberately does not.

The most recent exchange is never dropped however large, and a leading system message is preserved. The trimmed array propagates back into component state naturally, because the server echoes back the messages it was sent - so the memory is genuinely released, not merely excluded from the next request.

**`mapContext` was three passes over `layers`, on every engine mutation.** It allocated a copy of every layer object, and `refreshLayers()` replaces `layers` after essentially every engine mutation - including each throttled commit of a colour or opacity drag (see §3). Now one pass, and short-circuited to a frozen module constant when `CHAT_ENABLED` is off: nothing renders `ChatPanel` then and nothing reads it, so the whole derivation was waste, and the stable identity is what lets `ChatPanel`'s `memo` boundary hold. Same gating the `chatLayerFields` prefetch beside it already used.

**Dead dependencies removed.** `shpjs` and `file-saver` were declared in `package.json` and imported nowhere in the app (nothing else in the lockfile depended on them either). Not a runtime win - they were never bundled - but install size and supply-chain surface. `@esri/calcite-components` stays: it is a real peer dependency of `@arcgis/map-components`.

---

## Measured state as of 2026-08

A fresh `vite build` after the above, for comparison against §1's table:

| | Value |
| --- | --- |
| Entry chunk, raw | 2,373,310 B |
| Entry chunk, gzipped | 613,295 B |
| `modulepreload` links | 298 |
| Emitted chunks in `dist/assets` | 1,402 |
| `dist/` total (all lazy chunks included) | 23 MB |

No regression against §1's post-change figures. `VideoLayer` (731 KB) and `arcgis-scene` (898 KB) are confirmed *not* preloaded - they stay lazy.

**The largest remaining lever, not taken.** `@arcgis/map-components` pulls the whole Calcite/Lumina custom-element runtime into the entry chunk (3,308 `calcite` references in it). Constructing `MapView`/`SceneView` directly from `@arcgis/core` instead of using `<arcgis-map>`/`<arcgis-scene>` would drop that weight from first paint. Deliberately left alone: it rewrites `GISMapView.jsx`, its tests, and the lazy-3D design §1 exists to protect. That is an architecture decision, not an optimization - raise it as one.

---

## Costs consciously left in place

- **`getLayers()` is recomputed in full on every engine mutation** — see §2.
- **`.side-panel` uses `backdrop-filter: blur(20px)`** over the live map. Backdrop blur forces the compositor to re-sample the region beneath it while the map animates. It is part of the intended visual design and the panel is off-canvas on mobile, so it was left alone; it is the first thing to try if panning feels heavy *specifically while the sidebar is open*.
- **~288 preloaded module chunks remain on first load.** These are static imports of the entry — the bytes would be fetched regardless — and HTTP/2 is the correct fix for their request count, not fewer chunks (see the `manualChunks` note above for why consolidating them would be worse).

---

## Verification

- Full suite: 545 tests across 28 suites, all passing (was 465 across 24 at the time of §1-§3), including new coverage for `useThrottledCallback` (leading edge, coalescing, stable identity, unmount safety) and `ThrottledRangeInput` (immediate single commit, thumb tracking during a coalesced burst, no snap-back on a stale prop).
- `npx eslint` on the touched files reports the same pre-existing errors as before the change (`react-hooks/refs` on `AnalysisPanel`'s `hasRoute`/`hasBuffer` props, `react-hooks/set-state-in-effect` on the draw-target auto-select) and one fewer warning.
- `nginx -t` against `nginx:alpine` validates the gzip and HTTP/2 additions.
- **Not verified in a browser.** The byte and request-count figures above come from build output; no live profiling session (Lighthouse, React Profiler, or a real 2D/3D switch) was run.
