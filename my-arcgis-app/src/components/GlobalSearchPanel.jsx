import { memo, useRef, useState } from "react";
import PropTypes from "prop-types";
import Icon from "./Icon";

const LAYER_LABELS = {
  touristAttractions: "Tourist Attraction",
  mrtStations: "MRT Station",
  mrtLines: "MRT Line",
  drawings: "Drawing",
  address: "Address"
};

function GlobalSearchPanel({ onSearch, onSelectResult, hasSearchResult, onCreateSearchResultLayer }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchLayerName, setSearchLayerName] = useState("");
  const [creatingSearchLayer, setCreatingSearchLayer] = useState(false);
  const requestIdRef = useRef(0);

  const runSearch = async () => {
    const text = query.trim();
    if (!text) return;

    const requestId = ++requestIdRef.current;
    setSearching(true);
    try {
      const found = await onSearch(text);
      // Ignore a stale response if a newer search started while this one
      // was in flight (e.g. the user pressed Enter twice in quick succession).
      if (requestId !== requestIdRef.current) return;
      setResults(found || []);
      setSearched(true);
      setOpen(true);
    } finally {
      if (requestId === requestIdRef.current) setSearching(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    runSearch();
  };

  const handleSelect = (result) => {
    onSelectResult(result);
    setOpen(false);
  };

  // "Add to Layers" for the marker zoomToPoint drops on the map after an
  // address search - the address marker (searchResult) has no row of its
  // own in the Layers card (it's just the live, always-overwritten-by-the-
  // next-search marker - see GISMapEngine.getLayers's comment), so this is
  // the only way to keep a particular search result around once a later
  // search overwrites it. Once saved, ApplicationShell.createSearchResultLayer
  // clears the live marker (engine.clearSearchResult) on its side; this
  // resets every piece of local state back to what it was before any search
  // ran (query, results, the results dropdown) so the whole card - not just
  // the map - returns to its empty initial state instead of leaving a stale
  // query/result list sitting above a now-cleared marker.
  const handleCreateSearchLayer = async () => {
    if (!searchLayerName.trim() || !onCreateSearchResultLayer) return;
    setCreatingSearchLayer(true);
    try {
      await onCreateSearchResultLayer(searchLayerName.trim());
      setSearchLayerName("");
      setQuery("");
      setResults([]);
      setSearched(false);
      setOpen(false);
    } finally {
      setCreatingSearchLayer(false);
    }
  };

  return (
    <div className="panel-card global-search-panel">
      <div className="panel-title">SEARCH</div>

      <form className="global-search-form" onSubmit={handleSubmit}>
        <div className="global-search-input-wrap">
          <Icon name="search" size={16} className="global-search-icon" />
          <input
            type="text"
            placeholder="Search features or an address"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            aria-label="Search features or an address"
          />
        </div>
        <button type="submit" className="gis-button" disabled={searching || !query.trim()}>
          {searching ? "Searching…" : "Search"}
        </button>
      </form>

      {open && (
        <div className="global-search-results" role="listbox" aria-label="Search results">
          {results.length === 0 && searched && !searching && (
            <div className="global-search-empty">No matches found.</div>
          )}
          {results.map((result, i) => (
            <button
              type="button"
              key={`${result.type}-${result.layerId ?? "address"}-${i}`}
              className="global-search-result"
              role="option"
              onClick={() => handleSelect(result)}
            >
              <span className="global-search-result-label">{result.label}</span>
              <span className="global-search-result-layer">
                {LAYER_LABELS[result.layerId] || LAYER_LABELS[result.type] || ""}
              </span>
            </button>
          ))}
        </div>
      )}

      {onCreateSearchResultLayer && hasSearchResult && (
        <label className="analysis-aggregate-field global-search-save-field">
          <span>Save search result as layer</span>
          <input
            type="text"
            value={searchLayerName}
            onChange={(e) => setSearchLayerName(e.target.value)}
            placeholder="e.g. Client Site"
            aria-label="New search result layer name"
          />
          <button
            type="button"
            className="gis-button"
            disabled={!searchLayerName.trim() || creatingSearchLayer}
            onClick={handleCreateSearchLayer}
          >
            {creatingSearchLayer ? "Adding…" : "Add to Layers"}
          </button>
        </label>
      )}
    </div>
  );
}

GlobalSearchPanel.propTypes = {
  onSearch: PropTypes.func.isRequired,
  onSelectResult: PropTypes.func.isRequired,
  hasSearchResult: PropTypes.bool,
  onCreateSearchResultLayer: PropTypes.func
};

// Memoized: ApplicationShell re-renders on any of its own state changes
// (toast, sidebar, draw state, layer refresh). Every prop this component
// receives from there is either a primitive or a useCallback/useMemo-stabilized
// value, so memo lets those unrelated re-renders stop at this boundary.
export default memo(GlobalSearchPanel);
