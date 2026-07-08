---
  Upload System

  Purpose:
  Provides a UI‑driven way for users to import external GeoJSON files and have their features rendered as drawings on the map. The system funnels
  user‑selected files through the UI (FloatingDrawTools), forwards them to the engine (ApplicationShell → GISMapEngine.uploadGeoJSON), validates the
  file, converts GeoJSON geometries to ArcGIS Graphics, and adds them to the drawings layer (drawLayer).

  ---
  1. Responsibilities (per‑component)

  ┌───────────────────────┬────────────────────────────────┬────────────────────────────────────────────────────────────────────────────────────┐
  │       Component       │      Core Responsibility       │                                   Key Functions                                    │
  ├───────────────────────┼────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────┤
  │ FloatingDrawTools.jsx │ UI entry point for file        │ • Renders a hidden <input type="file"> that accepts .geojson,.json. <br> •         │
  │                       │ uploads.                       │ handleFileUpload extracts the File object and calls the prop uploadGeoJSON(file).  │
  ├───────────────────────┼────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────┤
  │ ApplicationShell.jsx  │ Glue layer that connects UI to │ • Declares uploadGeoJSON async wrapper that logs the file name, calls              │
  │                       │  the engine.                   │ engineRef.current.uploadGeoJSON(file), then refreshes the layer list.              │
  ├───────────────────────┼────────────────────────────────┼────────────────────────────────────────────────────────────────────────────────────┤
  │                       │ Core business logic for        │ • uploadGeoJSON(file, msg?) – main implementation (see details below). <br> •      │
  │ GISMapEngine.js       │ parsing, validating, and       │ Holds the permanent drawings GraphicsLayer (drawLayer). <br> • Tracks uploaded     │
  │                       │ inserting GeoJSON features.    │ layers in uploadedLayers for possible later reference.                             │
  └───────────────────────┴────────────────────────────────┴────────────────────────────────────────────────────────────────────────────────────┘

  ---
  2. GeoJSON Upload Workflow

  1. User selects a file in FloatingDrawTools.
  2. handleFileUpload → props.uploadGeoJSON(file) (prop passed from ApplicationShell).
  3. ApplicationShell.uploadGeoJSON → engineRef.current.uploadGeoJSON(file).
  4. In GISMapEngine.uploadGeoJSON:

    a. Early exit checks – abort if:
        - file is falsy.
      - this.currentMap or this.currentView are not attached (engine not bound to a view).

    b. Drawing‑layer guard – if any unsaved graphics already exist in drawLayer, the upload is blocked and the optional msg callback is invoked
  with:
  ▎ “Please save your current drawing and refresh the page before uploading”
    c. File parsing – reads the file as text (await file.text()) and parses it as JSON (JSON.parse).
    d. Feature conversion – for each feature in geojson.features:
        - Extracts geometry.type (Point, LineString, Polygon).
      - Builds an ArcGIS geometry object with Web Mercator spatial reference (wkid: 3857).
      - Creates a Graphic with a symbol tailored to the geometry type:
            - Point → simple-marker, red, size 8.
        - LineString → simple-line, blue, width 2.
        - Polygon → simple-fill, semi‑transparent blue [0,120,255,0.3].
      - Seeds the Graphic's attributes via buildDrawingAttributes(feature.properties || {}), so uploaded features carry the drawings-layer client-side schema (drawingFields) merged with their source GeoJSON properties; this makes them selectable/editable in the Feature Attribute panel (see feature-attributes.md).

    e. Layer insertion – this.drawLayer.addMany(graphics) adds all created graphics to the persistent Drawings GraphicsLayer.
    f. Tracking – pushes an entry into this.uploadedLayers containing a generated id, the original filename, and a reference to the drawLayer.
    g. View navigation – calls await this.currentView.goTo(this.drawLayer) to zoom/pan the map to the newly added graphics.
    h. Error handling – any exception is logged to the console (console.error("Upload failed:", err)).

  ---
  3. Drawings Layer Integration

  - Layer creation – this.drawLayer = new GraphicsLayer({ title: "Drawings" }) (constructor).
  - Map attachment – In attachToView(view), after the map is cleared and all other layers are added, drawLayer is inserted last via the layerOrder
  array (drawings entry). This guarantees the drawings appear on top of other layers.
  - Sketch support – SketchViewModel is instantiated with layer: this.drawLayer, allowing users to draw points/lines/polygons directly. The same
  layer is reused for upload‑generated graphics, preserving a single source‑of‑truth for all user‑generated geometry.
  - Persistence handling – saveDrawings (export) and uploadGeoJSON (import) both operate on drawLayer. Uploaded graphics are simply added; there is
  no automatic merge with existing drawings—hence the guard that forces the user to save/clear current graphics before a new upload.

  ---
  4. Validation Logic

  ┌───────────────┬───────────────────────────────────────────────────────────────────────────┬────────────────────────────────────────────────┐
  │  Validation   │                              What is Checked                              │               Outcome on Failure               │
  │     Step      │                                                                           │                                                │
  ├───────────────┼───────────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────┤
  │ File          │ if (!file)                                                                │ Silently returns (no UI feedback).             │
  │ existence     │                                                                           │                                                │
  ├───────────────┼───────────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────┤
  │ Engine        │ if (!this.currentMap || !this.currentView)                                │ Returns early (no UI feedback).                │
  │ attached      │                                                                           │                                                │
  ├───────────────┼───────────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────┤
  │ Unsaved       │                                                                           │ Calls msg?.("Please save your current drawing  │
  │ drawings      │ if (this.drawLayer?.graphics?.length > 0)                                 │ and refresh the page before uploading"); and   │
  │               │                                                                           │ aborts upload.                                 │
  ├───────────────┼───────────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────┤
  │               │                                                                           │ If malformed, error is caught and logged       │
  │ JSON parse    │ JSON.parse(await file.text()) (wrapped in try…catch)                      │ (console.error). No user‑visible message is    │
  │               │                                                                           │ provided (could be enhanced).                  │
  ├───────────────┼───────────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────┤
  │ Geometry type │ Handles only "Point", "LineString", "Polygon"; any other type is skipped  │ Feature is dropped; msg callback reports how   │
  │  support      │ (feature.geometry stays unconvertible, so the graphic is never created).  │  many feature(s) were skipped, upload proceeds │
  │               │                                                                            │  with the supported features.                  │
  ├───────────────┼───────────────────────────────────────────────────────────────────────────┼────────────────────────────────────────────────┤
  │ Spatial       │ Always forces wkid: 3857. No validation that the source GeoJSON is        │ Potential mis‑placement if source data uses a  │
  │ reference     │ already in Web Mercator; coordinates are taken as‑is.                     │ different CRS.                                 │
  └───────────────┴───────────────────────────────────────────────────────────────────────────┴────────────────────────────────────────────────┘

  ▎ Note: The validation is intentionally lightweight to keep the upload flow simple, but it leaves a few edge cases unaddressed (malformed GeoJSON,
  ▎ CRS mismatches).

  ▎ Bug fix (2026-07-08): Unsupported geometry types used to produce a Graphic with geometry: null, added to drawLayer alongside the valid
  ▎ features. That graphic didn't fail silently as assumed above - the ArcGIS LayerView throws while building the Drawings layer's render batch
  ▎ whenever it encounters a null-geometry graphic, which kills rendering for every graphic on drawLayer, not just the bad one. Because drawLayer
  ▎ is rebuilt into the map on every attachToView call (see drawing-system.md's 2D/3D section), this made ALL drawings vanish on every subsequent
  ▎ 2D/3D switch once a single unsupported-type feature had been uploaded - a permanent, session-wide break, not a one-time glitch.
  ▎ uploadGeoJSON now filters unsupported-type features out before creating graphics (skips them, reports the skipped count via msg), and
  ▎ attachToView defensively drops any already-corrupted (geometry: null) graphic still sitting in drawLayer from before this fix, so an existing
  ▎ user's session self-heals on the next reattachment instead of staying permanently broken.

  ---
  5. Limitations & Risks

  1. No CRS conversion – The system assumes incoming coordinates are already in Web Mercator (EPSG:3857). Uploading GeoJSON in another projection
  will place features in the wrong location.
  2. Partial validation – Only a small subset of errors is surfaced to the user (unsaved drawings). JSON parse errors are logged to console but not
  reported in‑UI, making debugging difficult for non‑technical users.
  3. Geometry type restriction – Multi‑part geometries (e.g., MultiPolygon, MultiLineString) are not recognized and are skipped (reported via the
  msg callback), not converted.
  4. Overwrite guard – The upload is blocked if any graphics exist in the draw layer, even if they are unrelated to the incoming file. Users must
  explicitly save or clear existing drawings first, which could be inconvenient.
  5. No deduplication – Uploaded graphics are appended directly; duplicate features from repeated uploads are not filtered.
  6. No undo / versioning – Once uploaded, graphics are part of the permanent drawLayer until the user manually clears them or saves the map.
  There's no transaction rollback if something goes wrong mid‑upload.
  7. Error visibility – All unexpected errors go to the browser console; end‑users receive no feedback, potentially leading to silent failures.
  8. Potential performance impact – Large GeoJSON files (thousands of features) are processed synchronously on the main thread; this could freeze
  the UI. No streaming or chunked handling is implemented.

  ---
  6. Summary Flow Diagram (textual)

  User selects file → FloatingDrawTools.handleFileUpload
     ↓ calls uploadGeoJSON(file) prop
  ApplicationShell.uploadGeoJSON
     ↓ engine.uploadGeoJSON(file)
  GISMapEngine.uploadGeoJSON
     ├─ Guard: engine attached?
     ├─ Guard: existing drawings? → abort with msg
     ├─ Parse JSON
     ├─ For each feature:
     │     • Convert geometry → ArcGIS format
     │     • Choose symbol by type
     │     • Create Graphic
     └─ Add all Graphics to drawLayer
          → Record in uploadedLayers
          → Zoom view to drawLayer