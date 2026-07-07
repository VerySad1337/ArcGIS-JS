import PropTypes from "prop-types";

export default function ViewControlPanel({ is3D, setIs3D }) {
  return (
    <div className="panel-card">
      <div className="panel-title">View Mode</div>
      <button className="gis-button" onClick={() => setIs3D(!is3D)}>
        {is3D ? "Switch to 2D" : "Switch to 3D"}
      </button>
    </div>
  );
}

ViewControlPanel.propTypes = {
  is3D: PropTypes.bool,
  setIs3D: PropTypes.func
};