import PropTypes from "prop-types";

export default function SidePanel({ children }) {
  return (
    <div className="side-panel">
      <div className="app-title">ArcGIS ReactJS Learning</div>
      {children}
    </div>
  );
}

SidePanel.propTypes = {
  children: PropTypes.node
};