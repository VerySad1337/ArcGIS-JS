export default function FloatingDrawTools({ drawPoint, drawLine, drawPolygon }) {
  return (
    <div className="fab-container">
      <button className="fab-tool fab-top" onClick={drawPoint} title="Plot Point">📍</button>
      <button className="fab-tool fab-left" onClick={drawPolygon} title="Draw Polygon">⬠</button>
      <button className="fab-tool fab-right" onClick={drawLine} title="Draw Line">📏</button>
      <button className="fab-main">+</button>
    </div>
  );
}