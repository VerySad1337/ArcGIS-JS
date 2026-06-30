export default function SidePanel({ children }) {
  return (
    <div className="side-panel">
      <div className="app-title">ArcGIS ReactJS Learning</div>
      {children}
    </div>
  );
}