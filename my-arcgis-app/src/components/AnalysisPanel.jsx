import { useState } from "react";
import PropTypes from "prop-types";
import Icon from "./Icon";
import RouteInput from "./RouteInput";

const BUFFER_UNITS = [
  { value: "meters", label: "Meters" },
  { value: "kilometers", label: "Kilometers" },
  { value: "feet", label: "Feet" },
  { value: "miles", label: "Miles" }
];

// "Add to Layers" for Route Search - route/stops have no row of their own
// in the Layers card (see GISMapEngine.getLayers's comment), so this is the
// only way to keep a particular route result around once a later search
// overwrites the live route/stop graphics. Pulled out of AnalysisPanel as
// its own component purely to keep the Route Search section's JSX flat.
function SaveRouteLayerForm({ hasRoute, name, onNameChange, onSave, saving }) {
  if (!hasRoute) {
    return <p className="analysis-tool-hint">Search a route first, then add it to the layers card.</p>;
  }

  return (
    <label className="analysis-aggregate-field">
      <span>Save route as layer</span>
      <input
        type="text"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="e.g. Home to Office"
        aria-label="New route layer name"
      />
      <button type="button" className="gis-button" disabled={!name.trim() || saving} onClick={onSave}>
        {saving ? "Adding…" : "Add to Layers"}
      </button>
    </label>
  );
}

SaveRouteLayerForm.propTypes = {
  hasRoute: PropTypes.bool,
  name: PropTypes.string.isRequired,
  onNameChange: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  saving: PropTypes.bool
};

// Route Search, Buffer, and Slice are the three tools under this card.
// Buffer works in both 2D and 3D (geodesicBuffer is pure geometry math,
// independent of the current view). Slice wraps an ArcGIS widget that only
// ever operates against a SceneView, so it alone is gated on is3D - shown
// as an explanatory hint instead of the toggle button whenever is3D is
// false, rather than a disabled control whose failure mode a user would
// have to guess at.
// Each tool section below is independently collapsible (default collapsed),
// same per-row chevron sub-section pattern LayerControlPanel uses for
// Symbology/Filter/Aggregate/Annotate - opening the card shouldn't dump all
// three tools' controls on the user at once.
export default function AnalysisPanel({
  is3D,
  selectedFeature,
  onBuffer,
  sliceActive,
  onToggleSlice,
  routeOn,
  toggleRoute,
  onRoute,
  isRouting,
  hasRoute,
  onCreateRouteLayer,
  layers,
  onCreateHeatmapLayer
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [openSections, setOpenSections] = useState({});
  const [distance, setDistance] = useState("100");
  const [unit, setUnit] = useState("meters");
  const [routeLayerName, setRouteLayerName] = useState("");
  const [creatingRouteLayer, setCreatingRouteLayer] = useState(false);
  const [heatmapSourceId, setHeatmapSourceId] = useState("");
  const [heatmapName, setHeatmapName] = useState("");
  const [creatingHeatmap, setCreatingHeatmap] = useState(false);

  const isSectionOpen = (section) => Boolean(openSections[section]);
  const toggleSection = (section) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const distanceValue = Number(distance);
  const canBuffer = Boolean(selectedFeature) && Number.isFinite(distanceValue) && distanceValue > 0;

  const handleBuffer = () => {
    onBuffer(distanceValue, unit);
  };

  // Saves the current route search result under a user-given name as a new
  // Layers-card row (see GISMapEngine.createRouteResultLayer) - route/stops
  // themselves have no card row of their own (they're just the live,
  // always-overwritten-by-the-next-search working state), so this is the
  // only way to keep a particular route result around after a later search.
  const handleCreateRouteLayer = async () => {
    if (!routeLayerName.trim() || !onCreateRouteLayer) return;
    setCreatingRouteLayer(true);
    try {
      await onCreateRouteLayer(routeLayerName.trim());
      setRouteLayerName("");
    } finally {
      setCreatingRouteLayer(false);
    }
  };

  // A layer qualifies as a heatmap analysis source when it has at least one
  // heatmap-eligible style group (point geometry - see GISMapEngine.getLayers's
  // heatmapEligible computation) AND is URL-backed (a hosted or portal
  // FeatureLayer) - GISMapEngine.createHeatmapLayer works by duplicating the
  // source layer's own `url` into a new FeatureLayer, so a source with no
  // `url` can never actually be used. `drawings` is the one layer this
  // excludes despite sometimes having a heatmapEligible (simple-marker)
  // style group of its own: that flag is shared with the in-place Heatmap
  // renderer mode in the layer's own Symbology section (which *is* valid for
  // drawings, since it assigns the renderer straight to the live
  // GraphicsLayer instead of duplicating a service) - without this extra
  // check, a drawings layer with any point graphic on it would appear
  // selectable here and then fail once submitted.
  const heatmapSourceOptions = (layers ?? []).filter(
    (l) => l && l.id !== "drawings" && (l.styleGroups ?? []).some((g) => g.heatmapEligible)
  );

  // Intensity starts at a fixed default (matching GISMapEngine.createHeatmapLayer's
  // own default) rather than being a control on this creation form - the
  // per-layer intensity slider already lives on the created layer's own row
  // in the Layers card (see LayerControlPanel), so there is no need for a
  // second intensity control here before the layer even exists.
  const handleCreateHeatmapLayer = async () => {
    if (!heatmapSourceId || !heatmapName.trim() || !onCreateHeatmapLayer) return;
    setCreatingHeatmap(true);
    try {
      await onCreateHeatmapLayer(heatmapSourceId, { name: heatmapName.trim() });
      setHeatmapName("");
    } finally {
      setCreatingHeatmap(false);
    }
  };

  return (
    <div className="panel-card">
      <button
        type="button"
        className="panel-title panel-title-toggle"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
      >
        <span>ANALYSIS</span>
        <Icon name={isOpen ? "chevronUp" : "chevronDown"} />
      </button>

      {isOpen && (
        <>
          <div className="layer-section">
            <button
              type="button"
              className="layer-section-toggle"
              aria-expanded={isSectionOpen("routeSearch")}
              onClick={() => toggleSection("routeSearch")}
            >
              <Icon name={isSectionOpen("routeSearch") ? "chevronUp" : "chevronDown"} size={14} />
              <span>Route Search</span>
            </button>

            {isSectionOpen("routeSearch") && (
              <div className="analysis-tool-section">
                <RouteInput onRoute={onRoute} isRouting={isRouting} />
                <button type="button" className="gis-button gis-button-secondary" onClick={toggleRoute}>
                  {routeOn ? "Hide Route" : "Show Route"}
                </button>

                {onCreateRouteLayer && (
                  <SaveRouteLayerForm
                    hasRoute={hasRoute}
                    name={routeLayerName}
                    onNameChange={setRouteLayerName}
                    onSave={handleCreateRouteLayer}
                    saving={creatingRouteLayer}
                  />
                )}
              </div>
            )}
          </div>

          <div className="layer-section">
            <button
              type="button"
              className="layer-section-toggle"
              aria-expanded={isSectionOpen("buffer")}
              onClick={() => toggleSection("buffer")}
            >
              <Icon name={isSectionOpen("buffer") ? "chevronUp" : "chevronDown"} size={14} />
              <span>Buffer</span>
            </button>

            {isSectionOpen("buffer") && (
              <div className="analysis-tool-section">
                <div className="analysis-tool-row">
                  <input
                    type="number"
                    min="0"
                    step="any"
                    aria-label="Buffer distance"
                    value={distance}
                    onChange={(e) => setDistance(e.target.value)}
                  />
                  <select
                    aria-label="Buffer unit"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                  >
                    {BUFFER_UNITS.map((u) => (
                      <option key={u.value} value={u.value}>{u.label}</option>
                    ))}
                  </select>
                </div>
                {!selectedFeature && (
                  <p className="analysis-tool-hint">Select a feature on the map first.</p>
                )}
                <button
                  type="button"
                  className="gis-button"
                  disabled={!canBuffer}
                  onClick={handleBuffer}
                >
                  Apply Buffer
                </button>
              </div>
            )}
          </div>

          <div className="layer-section">
            <button
              type="button"
              className="layer-section-toggle"
              aria-expanded={isSectionOpen("slice")}
              onClick={() => toggleSection("slice")}
            >
              <Icon name={isSectionOpen("slice") ? "chevronUp" : "chevronDown"} size={14} />
              <span>Slice</span>
            </button>

            {isSectionOpen("slice") && (
              <div className="analysis-tool-section">
                {!is3D ? (
                  <p className="analysis-tool-hint">Switch to 3D view to use Slice.</p>
                ) : (
                  <>
                    <p className="analysis-tool-hint">
                      Drag out a box on the scene to cut away part of the 3D view.
                    </p>
                    <button
                      type="button"
                      className="gis-button-secondary"
                      onClick={onToggleSlice}
                    >
                      {sliceActive ? "Stop Slice" : "Start Slice"}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {onCreateHeatmapLayer && (
            <div className="layer-section">
              <button
                type="button"
                className="layer-section-toggle"
                aria-expanded={isSectionOpen("heatmap")}
                onClick={() => toggleSection("heatmap")}
              >
                <Icon name={isSectionOpen("heatmap") ? "chevronUp" : "chevronDown"} size={14} />
                <span>Heatmap</span>
              </button>

              {isSectionOpen("heatmap") && (
                <div className="analysis-tool-section">
                  {heatmapSourceOptions.length === 0 ? (
                    <p className="analysis-tool-hint">
                      Add a point layer (Tourist Attractions, MRT Stations, or an eligible portal layer) first.
                    </p>
                  ) : (
                    <>
                      <label className="analysis-aggregate-field">
                        <span>Analyze</span>
                        <select
                          value={heatmapSourceId}
                          onChange={(e) => setHeatmapSourceId(e.target.value)}
                          aria-label="Heatmap source layer"
                        >
                          <option value="">Choose a layer…</option>
                          {heatmapSourceOptions.map((l) => (
                            <option key={l.id} value={l.id}>{l.name}</option>
                          ))}
                        </select>
                      </label>

                      <label className="analysis-aggregate-field">
                        <span>Name</span>
                        <input
                          type="text"
                          value={heatmapName}
                          onChange={(e) => setHeatmapName(e.target.value)}
                          placeholder="e.g. Attraction Density"
                          aria-label="New heatmap layer name"
                        />
                      </label>

                      <button
                        type="button"
                        className="gis-button"
                        disabled={!heatmapSourceId || !heatmapName.trim() || creatingHeatmap}
                        onClick={handleCreateHeatmapLayer}
                      >
                        {creatingHeatmap ? "Adding…" : "Add Heatmap Layer"}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

AnalysisPanel.propTypes = {
  is3D: PropTypes.bool,
  selectedFeature: PropTypes.object,
  onBuffer: PropTypes.func.isRequired,
  sliceActive: PropTypes.bool,
  onToggleSlice: PropTypes.func.isRequired,
  routeOn: PropTypes.bool,
  toggleRoute: PropTypes.func,
  onRoute: PropTypes.func,
  isRouting: PropTypes.bool,
  hasRoute: PropTypes.bool,
  onCreateRouteLayer: PropTypes.func,
  layers: PropTypes.array,
  onCreateHeatmapLayer: PropTypes.func
};
