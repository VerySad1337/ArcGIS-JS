export default function FloatingDrawTools({
  drawPoint,
  drawLine,
  drawPolygon,
  saveGeoJSON,
  uploadGeoJSON
}) {
  const handleFileUpload = ({ target }) => {
    const file = target.files?.[0];
    if (!file) return;
    uploadGeoJSON(file);
    target.value = "";
  };

  return (
    <div className="fab-container">
      <button className="fab-tool fab-top" onClick={drawPoint}>📍</button>
      <button className="fab-tool fab-top-left" onClick={drawPolygon}>⬠</button>
      <button className="fab-tool fab-top-right" onClick={drawLine}>📏</button>
      <div className="save-wrapper">
        <button className="fab-tool fab-left">💾</button>
        <button className="save-tool save-geojson" onClick={saveGeoJSON}>
          GeoJSON
        </button>
      </div>

      <label className="fab-tool fab-upload">
        📂
        <input
          hidden
          type="file"
          accept=".geojson,.json"
          onChange={handleFileUpload}
        />
      </label>

      <button className="fab-main">+</button>
    </div>
  );
}