(function (root) {
  'use strict';
  function snapPoint(p, spacing = 50) {
    return {x: Math.round(p.x / spacing) * spacing || 0, y: Math.round(p.y / spacing) * spacing || 0};
  }
  function endpoint(start, pointer, options = {}) {
    const {grid = false, straight = true, spacing = 50, nodes = [], tolerance = 24} = options;
    const horizontal = Math.abs(pointer.x - start.x) >= Math.abs(pointer.y - start.y);
    const p = grid ? snapPoint(pointer, spacing) : {x: pointer.x, y: pointer.y};
    if (grid && straight) p[horizontal ? 'y' : 'x'] = start[horizontal ? 'y' : 'x'];
    let node = null, distance = tolerance;
    for (const n of nodes) {
      if (grid && straight && Math.abs(n[horizontal ? 'y' : 'x'] - start[horizontal ? 'y' : 'x']) > 0.001) continue;
      const d = Math.hypot(n.x - pointer.x, n.y - pointer.y);
      if (d < distance) {node = n; distance = d;}
    }
    return node ? {x:node.x,y:node.y,node} : {...p,node:null};
  }
  const api = {snapPoint, endpoint};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RoadEditor = api;
})(typeof window !== 'undefined' ? window : globalThis);
