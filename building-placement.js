(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BuildingPlacement = api;
})(typeof globalThis === 'object' ? globalThis : this, function() {
  'use strict';

  const TILE = 15;
  const GAP = 3;
  const SETBACK = 2;
  const SIZES = Object.freeze({
    S: Object.freeze({width: 60, depth: 45, parking: 1, multiplier: 1}),
    M: Object.freeze({width: 90, depth: 60, parking: 4, multiplier: 3}),
    L: Object.freeze({width: 120, depth: 120, parking: 16, multiplier: 8})
  });
  const EPSILON = 1e-10;

  function finite(value, label) {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  }

  function nonNegative(value, label) {
    finite(value, label);
    if (value < 0) throw new RangeError(`${label} must be non-negative`);
  }

  function validateLot(lot) {
    if (!lot || typeof lot !== 'object') throw new TypeError('lot must be an object');
    finite(lot.x, 'lot.x');
    finite(lot.y, 'lot.y');
    finite(lot.width, 'lot.width');
    finite(lot.depth, 'lot.depth');
    finite(lot.angle, 'lot.angle');
    if (lot.width <= 0 || lot.depth <= 0) throw new RangeError('lot dimensions must be positive');
  }

  function validatePoint(point, label) {
    if (!point || typeof point !== 'object') throw new TypeError(`${label} must be a point`);
    finite(point.x, `${label}.x`);
    finite(point.y, `${label}.y`);
  }

  function corners(lot) {
    validateLot(lot);
    const cos = Math.cos(lot.angle);
    const sin = Math.sin(lot.angle);
    const halfWidth = lot.width / 2;
    const halfDepth = lot.depth / 2;
    return [
      [-halfWidth, -halfDepth],
      [halfWidth, -halfDepth],
      [halfWidth, halfDepth],
      [-halfWidth, halfDepth]
    ].map(([x, y]) => ({
      x: lot.x + x * cos - y * sin,
      y: lot.y + x * sin + y * cos
    }));
  }

  function contains(lot, point, tolerance = 0) {
    validateLot(lot);
    validatePoint(point, 'point');
    nonNegative(tolerance, 'tolerance');
    const dx = point.x - lot.x;
    const dy = point.y - lot.y;
    const cos = Math.cos(lot.angle);
    const sin = Math.sin(lot.angle);
    const localX = dx * cos + dy * sin;
    const localY = -dx * sin + dy * cos;
    return Math.abs(localX) <= lot.width / 2 + tolerance &&
      Math.abs(localY) <= lot.depth / 2 + tolerance;
  }

  function overlaps(a, b, gap = 0) {
    validateLot(a);
    validateLot(b);
    nonNegative(gap, 'gap');
    const axes = [a.angle, a.angle + Math.PI / 2, b.angle, b.angle + Math.PI / 2];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    for (const angle of axes) {
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      const radiusA = Math.abs(Math.cos(a.angle - angle)) * a.width / 2 +
        Math.abs(Math.sin(a.angle - angle)) * a.depth / 2;
      const radiusB = Math.abs(Math.cos(b.angle - angle)) * b.width / 2 +
        Math.abs(Math.sin(b.angle - angle)) * b.depth / 2;
      const projectedSeparation = Math.abs(dx * ux + dy * uy) - radiusA - radiusB;
      // Strict inequality accepts penetrating rectangles and gaps smaller than the
      // requested clearance while treating exact contact as non-overlap.
      if (projectedSeparation >= gap - EPSILON) return false;
    }
    return true;
  }

  function pointSegmentDistanceSquared(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) {
      const px = point.x - a.x;
      const py = point.y - a.y;
      return px * px + py * py;
    }
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
    const px = point.x - (a.x + t * dx);
    const py = point.y - (a.y + t * dy);
    return px * px + py * py;
  }

  function cross(a, b, c) {
    return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  }

  function onSegment(a, b, point) {
    return Math.abs(cross(a, b, point)) <= EPSILON &&
      point.x >= Math.min(a.x, b.x) - EPSILON && point.x <= Math.max(a.x, b.x) + EPSILON &&
      point.y >= Math.min(a.y, b.y) - EPSILON && point.y <= Math.max(a.y, b.y) + EPSILON;
  }

  function segmentsIntersect(a, b, c, d) {
    const abC = cross(a, b, c);
    const abD = cross(a, b, d);
    const cdA = cross(c, d, a);
    const cdB = cross(c, d, b);
    if (((abC > EPSILON && abD < -EPSILON) || (abC < -EPSILON && abD > EPSILON)) &&
        ((cdA > EPSILON && cdB < -EPSILON) || (cdA < -EPSILON && cdB > EPSILON))) return true;
    return (Math.abs(abC) <= EPSILON && onSegment(a, b, c)) ||
      (Math.abs(abD) <= EPSILON && onSegment(a, b, d)) ||
      (Math.abs(cdA) <= EPSILON && onSegment(c, d, a)) ||
      (Math.abs(cdB) <= EPSILON && onSegment(c, d, b));
  }

  function segmentDistanceSquared(a, b, c, d) {
    if (segmentsIntersect(a, b, c, d)) return 0;
    return Math.min(
      pointSegmentDistanceSquared(a, c, d),
      pointSegmentDistanceSquared(b, c, d),
      pointSegmentDistanceSquared(c, a, b),
      pointSegmentDistanceSquared(d, a, b)
    );
  }

  function toLocal(lot, point) {
    const dx = point.x - lot.x;
    const dy = point.y - lot.y;
    const cos = Math.cos(lot.angle);
    const sin = Math.sin(lot.angle);
    return {x: dx * cos + dy * sin, y: -dx * sin + dy * cos};
  }

  function corridorOverlaps(lot, points, radius) {
    validateLot(lot);
    nonNegative(radius, 'radius');
    if (!Array.isArray(points)) throw new TypeError('points must be an array');
    const local = points.map((point, index) => {
      validatePoint(point, `points[${index}]`);
      return toLocal(lot, point);
    });
    if (local.length === 0) return false;
    const halfWidth = lot.width / 2;
    const halfDepth = lot.depth / 2;
    const radiusSquared = radius * radius;
    const inside = point => Math.abs(point.x) <= halfWidth && Math.abs(point.y) <= halfDepth;
    const pointToRectangleDistanceSquared = point => {
      const dx = Math.max(Math.abs(point.x) - halfWidth, 0);
      const dy = Math.max(Math.abs(point.y) - halfDepth, 0);
      return dx * dx + dy * dy;
    };
    const edges = [
      [{x: -halfWidth, y: -halfDepth}, {x: halfWidth, y: -halfDepth}],
      [{x: halfWidth, y: -halfDepth}, {x: halfWidth, y: halfDepth}],
      [{x: halfWidth, y: halfDepth}, {x: -halfWidth, y: halfDepth}],
      [{x: -halfWidth, y: halfDepth}, {x: -halfWidth, y: -halfDepth}]
    ];

    if (local.length === 1) return pointToRectangleDistanceSquared(local[0]) <= radiusSquared;
    for (let i = 1; i < local.length; i++) {
      const start = local[i - 1];
      const end = local[i];
      if (inside(start) || inside(end)) return true;
      for (const [edgeStart, edgeEnd] of edges) {
        if (segmentDistanceSquared(start, end, edgeStart, edgeEnd) <= radiusSquared) return true;
      }
    }
    return false;
  }

  function alongRoad(path, halfWidth, s, side, sizeKey) {
    if (!path || typeof path !== 'object' || typeof path.pos !== 'function' || typeof path.dir !== 'function') {
      throw new TypeError('path must provide pos(s) and dir(s)');
    }
    finite(path.length, 'path.length');
    nonNegative(path.length, 'path.length');
    nonNegative(halfWidth, 'halfWidth');
    finite(s, 's');
    if (side !== 1 && side !== -1) throw new RangeError('side must be 1 or -1');
    const size = SIZES[sizeKey];
    if (!size) throw new RangeError(`unknown size key: ${sizeKey}`);

    const roadPoint = path.pos(s);
    const tangent = path.dir(s);
    validatePoint(roadPoint, 'path.pos(s)');
    validatePoint(tangent, 'path.dir(s)');
    const tangentLength = Math.hypot(tangent.x, tangent.y);
    if (!(tangentLength > 0)) throw new RangeError('path direction must have non-zero length');
    const ux = tangent.x / tangentLength;
    const uy = tangent.y / tangentLength;
    const normal = {x: -uy * side, y: ux * side};
    const angle = Math.atan2(uy, ux) + (side < 0 ? Math.PI : 0);
    const centreOffset = halfWidth + SETBACK + size.depth / 2;
    return {
      x: roadPoint.x + normal.x * centreOffset,
      y: roadPoint.y + normal.y * centreOffset,
      width: size.width,
      depth: size.depth,
      angle,
      entrance: {
        x: roadPoint.x + normal.x * (halfWidth + SETBACK),
        y: roadPoint.y + normal.y * (halfWidth + SETBACK)
      }
    };
  }

  return Object.freeze({TILE, GAP, SETBACK, SIZES, corners, contains, overlaps, corridorOverlaps, alongRoad});
});
