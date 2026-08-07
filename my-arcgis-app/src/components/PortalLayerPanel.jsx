import { useRef, useState } from "react";
import PropTypes from "prop-types";
import Icon from "./Icon";

// Collapsed by default: searching the portal is an occasional action, not
// something every session needs, and it shouldn't push the always-relevant
// LAYERS panel further down the sidebar. Mirrors LayerControlPanel's
// per-row chevron-collapse pattern.
export default function PortalLayerPanel({
  onSearch,
  onAddLayer,
  oauthConfigured,
  signedInUser,
  signingIn,
  onSignIn,
  onSignOut
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const requestIdRef = useRef(0);

  const runSearch = async (e) => {
    e.preventDefault();
    const text = query.trim();
    if (!text) return;

    const requestId = ++requestIdRef.current;
    setSearching(true);
    try {
      const found = await onSearch(text);
      if (requestId !== requestIdRef.current) return;
      setResults(found || []);
      setSearched(true);
    } finally {
      if (requestId === requestIdRef.current) setSearching(false);
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
        <span>ADD LAYER FROM PORTAL</span>
        <Icon name={isOpen ? "chevronUp" : "chevronDown"} />
      </button>

      {isOpen && (
        <>
          {oauthConfigured && (
            <div className="portal-account-row">
              {signedInUser ? (
                <>
                  <span className="portal-account-status">
                    Signed in as <strong>{signedInUser.fullName}</strong>
                  </span>
                  <button type="button" className="gis-button-secondary portal-account-btn" onClick={onSignOut}>
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <span className="portal-account-status">
                    Sign in to search your organization&apos;s shared content
                  </span>
                  <button
                    type="button"
                    className="gis-button-secondary portal-account-btn"
                    onClick={onSignIn}
                    disabled={signingIn}
                  >
                    {signingIn ? "Signing in…" : "Sign in"}
                  </button>
                </>
              )}
            </div>
          )}

          <form className="global-search-form" onSubmit={runSearch}>
            <div className="global-search-input-wrap">
              <Icon name="search" size={16} className="global-search-icon" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search ArcGIS portal feature layers"
                aria-label="Search ArcGIS portal feature layers"
              />
            </div>
            <button type="submit" className="gis-button" disabled={searching || !query.trim()}>
              {searching ? "Searching…" : "Search"}
            </button>
          </form>

          {searched && !searching && results.length === 0 && (
            <p className="layer-empty-state">No portal layers found for that search.</p>
          )}

          {results.length > 0 && (
            <ul className="portal-search-results">
              {results.map((item) => (
                <li key={item.id} className="portal-search-result">
                  <span className="portal-result-title" title={item.snippet || item.title}>
                    {item.title}
                  </span>
                  <button
                    type="button"
                    className="gis-button-secondary portal-result-add-btn"
                    onClick={() => onAddLayer(item)}
                  >
                    Add
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

PortalLayerPanel.propTypes = {
  onSearch: PropTypes.func.isRequired,
  onAddLayer: PropTypes.func.isRequired,
  oauthConfigured: PropTypes.bool,
  signedInUser: PropTypes.shape({
    username: PropTypes.string,
    fullName: PropTypes.string,
    orgId: PropTypes.string,
    thumbnailUrl: PropTypes.string
  }),
  signingIn: PropTypes.bool,
  onSignIn: PropTypes.func,
  onSignOut: PropTypes.func
};
