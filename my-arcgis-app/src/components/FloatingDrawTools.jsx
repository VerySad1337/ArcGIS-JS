export default function FloatingDrawTools({
  drawPoint,
  drawLine,
  drawPolygon,
  saveGeoJSON
}) {
  return (
    <div className="fab-container">
      <button className="fab-tool fab-top" onClick={drawPoint}>📍</button>
      <button className="fab-tool fab-left" onClick={drawPolygon}>⬠</button>
      <button className="fab-tool fab-right" onClick={drawLine}>📏</button>

      <div className="save-wrapper">
        <button className="fab-tool fab-save">💾</button>
        <button className="save-tool save-geojson"   onClick={saveGeoJSON}> GeoJSON</button>
</div>

      <button className="fab-main">+</button>
    </div>
  );
}