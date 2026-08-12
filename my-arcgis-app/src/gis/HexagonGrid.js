// Pure, ArcGIS-import-free hexagon-grid + point-binning logic for the
// Hexagon Analysis tool (see knowledge/index.md's "Named Hexagon Layers"
// section) - the same architectural role SymbolRenderers.js plays for
// renderers and LayerFilterExpression.js plays for filters: this module
// never imports an ArcGIS class, it only produces plain numbers and
// coordinate arrays that GISMapEngine turns into real Graphic/Polygon
// geometry.

// Builds a flat-top hexagon grid covering `extent` ({xmin,ymin,xmax,ymax}),
// in the same planar units as the extent itself (this app's layers are all
// Web Mercator, so `cellSize` is effectively meters - see
// GISMapEngine.createHexagonLayer). Returns one entry per hexagon that
// intersects the extent: { ring: [[x,y], ...] }, closed (first point
// repeated last) - the shape a polygon Graphic's `rings` expects.
export function buildHexagonGrid(extent, cellSize) {
  const size = cellSize / Math.sqrt(3); // circumradius for a flat-top hex of the given flat-to-flat width
  const hexWidth = Math.sqrt(3) * size;
  const hexHeight = 2 * size;
  const horizStep = hexWidth;
  const vertStep = hexHeight * 0.75;

  const { xmin, ymin, xmax, ymax } = extent;
  const cols = Math.ceil((xmax - xmin) / horizStep) + 2;
  const rows = Math.ceil((ymax - ymin) / vertStep) + 2;

  const hexagons = [];
  for (let row = -1; row <= rows; row++) {
    const y = ymin + row * vertStep;
    const xOffset = row % 2 !== 0 ? horizStep / 2 : 0;
    for (let col = -1; col <= cols; col++) {
      const x = xmin + col * horizStep + xOffset;
      const ring = hexagonRing(x, y, size);
      if (ring.some(([rx, ry]) => rx >= xmin && rx <= xmax && ry >= ymin && ry <= ymax)) {
        hexagons.push({ ring });
      }
    }
  }
  return hexagons;
}

function hexagonRing(cx, cy, size) {
  const ring = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    ring.push([cx + size * Math.cos(angle), cy + size * Math.sin(angle)]);
  }
  ring.push(ring[0]);
  return ring;
}

// Ray-casting point-in-polygon test against one closed ring of [x, y] pairs.
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

// Counts how many of `points` ([x, y] pairs) fall inside each hexagon in
// `hexagons` (as built by buildHexagonGrid above). O(hexagons x points), one
// bin per point (a point that happens to land on a shared edge is only ever
// counted once) - fine at the feature counts this app's source layers deal
// with (a hosted/portal point service, not a bulk import), and keeps this
// module free of any spatial-index dependency.
export function countPointsInHexagons(hexagons, points) {
  const counts = new Array(hexagons.length).fill(0);
  points.forEach(([x, y]) => {
    for (let h = 0; h < hexagons.length; h++) {
      if (pointInRing(x, y, hexagons[h].ring)) {
        counts[h]++;
        return;
      }
    }
  });
  return counts;
}
