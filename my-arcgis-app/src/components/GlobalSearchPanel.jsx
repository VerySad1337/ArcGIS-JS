import { useRef, useState } from "react";
import PropTypes from "prop-types";
import Icon from "./Icon";

const LAYER_LABELS = {
  touristAttractions: "Tourist Attraction",
  mrtStations: "MRT Station",
  mrtLines: "MRT Line",
  drawings: "Drawing",
  address: "Address"
};

export default function GlobalSearchPanel({ onSearch, onSelectResult }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
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
    </div>
  );
}

GlobalSearchPanel.propTypes = {
  onSearch: PropTypes.func.isRequired,
  onSelectResult: PropTypes.func.isRequired
};
