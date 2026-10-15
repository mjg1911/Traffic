(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CitySave = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LEGACY_VERSION = 1;
  const PREVIOUS_VERSION = 2;
  const VERSION = 3;
  const LEGACY_COLS = Math.ceil(3000 / 34), LEGACY_ROWS = Math.ceil(2000 / 34);
  const CURRENT_COLS = Math.ceil(4800 / 34), CURRENT_ROWS = Math.ceil(3200 / 34);
  const LEGACY_ZONE_COUNT = LEGACY_COLS * LEGACY_ROWS;
  const ZONE_COUNT = CURRENT_COLS * CURRENT_ROWS;
  const NODE_LIMIT = 2000;
  const EDGE_LIMIT = 4000;
  const BUILDING_LIMIT = 2000;
  const RING_LIMIT = 500;
  const RIVER_POINT_LIMIT = 1800;
  const TRIP_LIMIT = 1000;
  const MAX_ID = Number.MAX_SAFE_INTEGER - 100000;
  const ROAD_TYPES = new Set(['STREET', 'AVENUE', 'ONEWAY', 'HIGHWAY', 'RING']);
  const ZONE_BUILDING_TYPES = { 1: 'R', 2: 'C', 3: 'I' };

  function invalid(path, detail) {
    throw new Error('Invalid city save: ' + path + ' ' + detail + '.');
  }

  function object(value, path) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      invalid(path, 'must be an object');
    }
    return value;
  }

  function array(value, path, limit, minLength) {
    if (!Array.isArray(value)) invalid(path, 'must be an array');
    if (value.length > limit) invalid(path, 'exceeds the maximum size of ' + limit);
    if (minLength !== undefined && value.length < minLength) invalid(path, 'must contain at least ' + minLength + ' items');
    for (let i = 0; i < value.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(value, i)) invalid(path + '[' + i + ']', 'is missing');
    }
    return value;
  }

  function finite(value, path, min, max) {
    if (typeof value !== 'number' || !Number.isFinite(value)) invalid(path, 'must be a finite number');
    if (min !== undefined && value < min) invalid(path, 'must be at least ' + min);
    if (max !== undefined && value > max) invalid(path, 'must be at most ' + max);
    return value;
  }

  function integer(value, path, min, max) {
    finite(value, path, min, max);
    if (!Number.isInteger(value)) invalid(path, 'must be an integer');
    return value;
  }

  function point(value, path) {
    object(value, path);
    const x = finite(value.x, path + '.x', -10000, 10000);
    const y = finite(value.y, path + '.y', -10000, 10000);
    return { x, y };
  }

  function uniqueId(value, path, ids, min) {
    integer(value, path, min === undefined ? 1 : min, MAX_ID);
    if (ids.has(value)) invalid(path, 'must be unique');
    ids.add(value);
  }

  function validate(data) {
    object(data, 'save');
    const zoneCount = data.version === LEGACY_VERSION ? LEGACY_ZONE_COUNT :
      data.version === PREVIOUS_VERSION || data.version === VERSION ? ZONE_COUNT : 0;
    if (!zoneCount) invalid('version', 'is unsupported');
    integer(data.seed, 'seed', 0, 0xFFFFFFFF);
    finite(data.time, 'time', 0, 1e9);

    const nodes = array(data.nodes, 'nodes', NODE_LIMIT);
    const nodeById = new Map();
    const nodeIds = new Set();
    nodes.forEach((raw, index) => {
      const path = 'nodes[' + index + ']';
      const node = object(raw, path);
      uniqueId(node.id, path + '.id', nodeIds);
      finite(node.x, path + '.x', -10000, 10000);
      finite(node.y, path + '.y', -10000, 10000);
      const controls = data.version === VERSION ? ['YIELD', 'STOP', 'SIGNAL', 'PRIORITY'] : ['YIELD', 'STOP', 'SIGNAL'];
      if (!controls.includes(node.control)) invalid(path + '.control', 'is not supported by this save version');
      if (data.version === VERSION) {
        const priorityEdges = array(node.priorityEdges, path + '.priorityEdges', EDGE_LIMIT);
        const selected = new Set();
        priorityEdges.forEach((edgeId, edgeIndex) => {
          integer(edgeId, path + '.priorityEdges[' + edgeIndex + ']', 1, MAX_ID);
          if (selected.has(edgeId)) invalid(path + '.priorityEdges', 'must not contain duplicate edge IDs');
          selected.add(edgeId);
        });
        if (node.control === 'PRIORITY' && !selected.size) invalid(path + '.priorityEdges', 'must select an approach for a priority junction');
        if (node.control !== 'PRIORITY' && selected.size) invalid(path + '.priorityEdges', 'must be empty unless the node uses priority control');
      }
      if (typeof node.isRing !== 'boolean') invalid(path + '.isRing', 'must be a boolean');
      integer(node.ringId, path + '.ringId', 0, MAX_ID);
      nodeById.set(node.id, node);
    });

    const rings = array(data.rings, 'rings', RING_LIMIT);
    const ringById = new Map();
    const ringIds = new Set();
    rings.forEach((raw, index) => {
      const path = 'rings[' + index + ']';
      const ring = object(raw, path);
      uniqueId(ring.id, path + '.id', ringIds, 0);
      finite(ring.cx, path + '.cx', -10000, 10000);
      finite(ring.cy, path + '.cy', -10000, 10000);
      finite(ring.R, path + '.R', Number.MIN_VALUE, 500);
      finite(ring.hw, path + '.hw', Number.MIN_VALUE, 100);
      const memberIds = array(ring.nodes, path + '.nodes', NODE_LIMIT, 3);
      const members = new Set();
      memberIds.forEach((id, memberIndex) => {
        integer(id, path + '.nodes[' + memberIndex + ']', 1, MAX_ID);
        if (members.has(id)) invalid(path + '.nodes', 'must not contain duplicate node IDs');
        members.add(id);
        const node = nodeById.get(id);
        if (!node) invalid(path + '.nodes', 'references an unknown node ID');
        if (!node.isRing || node.ringId !== ring.id) invalid(path + '.nodes', 'must match the ring metadata on each member node');
      });
      const incoming = new Map();
      const outgoing = new Map();
      members.forEach(id => { incoming.set(id, 0); outgoing.set(id, 0); });
      ringById.set(ring.id, { value: ring, members, incoming, outgoing, next: new Map() });
    });

    nodeById.forEach((node, id) => {
      if (node.isRing) {
        const ring = ringById.get(node.ringId);
        if (!ring || !ring.members.has(id)) invalid('nodes', 'contains a ring node that is missing from its declared ring');
      } else if (node.ringId !== 0) {
        invalid('nodes', 'contains a non-ring node with a ring ID');
      }
    });

    const edges = array(data.edges, 'edges', EDGE_LIMIT);
    const edgeIds = new Set();
    const edgeById = new Map();
    const connections = new Set();
    edges.forEach((raw, index) => {
      const path = 'edges[' + index + ']';
      const edge = object(raw, path);
      uniqueId(edge.id, path + '.id', edgeIds);
      edgeById.set(edge.id, edge);
      integer(edge.n1, path + '.n1', 1, MAX_ID);
      integer(edge.n2, path + '.n2', 1, MAX_ID);
      const n1 = nodeById.get(edge.n1);
      const n2 = nodeById.get(edge.n2);
      if (!n1 || !n2) invalid(path, 'references an unknown node ID');
      if (edge.n1 === edge.n2) invalid(path, 'must not connect a node to itself');
      if (typeof edge.type !== 'string' || !ROAD_TYPES.has(edge.type)) invalid(path + '.type', 'is not a supported road type');
      const bend = finite(edge.bend, path + '.bend');
      const dx = n2.x - n1.x;
      const dy = n2.y - n1.y;
      const chord = Math.hypot(dx, dy);
      if (chord === 0) invalid(path, 'must have non-zero length');
      if (edge.type !== 'RING' && Math.abs(bend) > chord) invalid(path + '.bend', 'must not exceed the road chord length');
      const connection = edge.n1 < edge.n2 ? edge.n1 + ':' + edge.n2 : edge.n2 + ':' + edge.n1;
      if (connections.has(connection)) invalid(path, 'duplicates an existing node connection');
      connections.add(connection);
      if (edge.type === 'RING' && (!n1.isRing || !n2.isRing || n1.ringId !== n2.ringId || !ringById.has(n1.ringId))) {
        invalid(path, 'must connect nodes in the same declared ring');
      }
      if (edge.type === 'RING') {
        const ring = ringById.get(n1.ringId);
        ring.outgoing.set(n1.id, ring.outgoing.get(n1.id) + 1);
        ring.incoming.set(n2.id, ring.incoming.get(n2.id) + 1);
        ring.next.set(n1.id, n2.id);
      }
    });

    if (data.version === VERSION) {
      nodeById.forEach((node, nodeId) => {
        for (const edgeId of node.priorityEdges) {
          const edge = edgeById.get(edgeId);
          if (!edge) invalid('nodes', 'contains a priority approach that references an unknown edge ID');
          if (edge.type === 'RING' || (edge.n1 !== nodeId && edge.n2 !== nodeId)) {
            invalid('nodes', 'contains a priority approach that is not a non-ring incident road');
          }
        }
      });
    }

    ringById.forEach((ring, ringId) => {
      const path = 'rings (ID ' + ringId + ')';
      ring.members.forEach(id => {
        if (ring.incoming.get(id) !== 1 || ring.outgoing.get(id) !== 1) {
          invalid(path + '.nodes', 'must each have exactly one incoming and one outgoing RING edge');
        }
      });
      const start = ring.members.values().next().value;
      const seen = new Set();
      let current = start;
      while (!seen.has(current) && seen.size < ring.members.size) {
        seen.add(current);
        current = ring.next.get(current);
      }
      if (current !== start || seen.size !== ring.members.size) {
        invalid(path + '.nodes', 'must form one directed cycle covering every member');
      }
    });

    const river = object(data.river, 'river');
    const centre = array(river.centre, 'river.centre', RIVER_POINT_LIMIT, 2);
    const poly = array(river.poly, 'river.poly', RIVER_POINT_LIMIT, 3);
    if (centre.length + poly.length > RIVER_POINT_LIMIT) invalid('river', 'contains too many geometry points');
    centre.forEach((p, i) => point(p, 'river.centre[' + i + ']'));
    poly.forEach((p, i) => point(p, 'river.poly[' + i + ']'));

    const zones = array(data.zones, 'zones', zoneCount);
    if (zones.length !== zoneCount) invalid('zones', 'must contain exactly ' + zoneCount + ' cells');
    zones.forEach((zone, index) => integer(zone, 'zones[' + index + ']', 0, 3));

    const buildings = array(data.buildings, 'buildings', BUILDING_LIMIT);
    const occupiedCells = new Set();
    buildings.forEach((raw, index) => {
      const path = 'buildings[' + index + ']';
      const building = object(raw, path);
      finite(building.x, path + '.x', -10000, 10000);
      finite(building.y, path + '.y', -10000, 10000);
      if (!['R', 'C', 'I'].includes(building.type)) invalid(path + '.type', 'must be R, C, or I');
      integer(building.level, path + '.level', 1, 3);
      integer(building.cell, path + '.cell', 0, zoneCount - 1);
      if (occupiedCells.has(building.cell)) invalid(path + '.cell', 'duplicates an occupied cell');
      occupiedCells.add(building.cell);
      if (ZONE_BUILDING_TYPES[zones[building.cell]] !== building.type) invalid(path + '.type', 'does not match the zone at its cell');
      finite(building.service, path + '.service', 0, 1);
      finite(building.starve, path + '.starve', 0);
      finite(building.since, path + '.since', 0);
      finite(building.trips, path + '.trips', 0);
      finite(building.outTimer, path + '.outTimer', 0);
      finite(building.born, path + '.born', 0);
      finite(building.seed, path + '.seed', 0, 1);
    });

    const camera = object(data.camera, 'camera');
    finite(camera.x, 'camera.x', -10000, 10000);
    finite(camera.y, 'camera.y', -10000, 10000);
    finite(camera.z, 'camera.z', 0.18, 3.2);

    const trips = array(data.trips, 'trips', TRIP_LIMIT);
    trips.forEach((duration, index) => finite(duration, 'trips[' + index + ']', 0));

    const settings = object(data.settings, 'settings');
    if (typeof settings.grid !== 'boolean') invalid('settings.grid', 'must be a boolean');
    if (!['straight', 'curve'].includes(settings.drawMode)) invalid('settings.drawMode', 'must be straight or curve');
    if (!['STREET', 'AVENUE', 'ONEWAY', 'HIGHWAY'].includes(settings.roadType)) invalid('settings.roadType', 'must be a standard road type');

    return data;
  }

  function migrate(data) {
    validate(data);
    if (data.version === VERSION) return data;
    if (data.version === PREVIOUS_VERSION) {
      return validate({
        ...data,
        version: VERSION,
        nodes: data.nodes.map(node => ({ ...node, priorityEdges: [] })),
      });
    }
    const migrated = {
      ...data,
      version: VERSION,
      nodes: data.nodes.map(node => ({ ...node, priorityEdges: [] })),
      zones: new Array(ZONE_COUNT).fill(0),
      buildings: data.buildings.map(building => ({
        ...building,
        cell: Math.floor(building.cell / LEGACY_COLS) * CURRENT_COLS + (building.cell % LEGACY_COLS),
      })),
    };
    for (let oldCell = 0; oldCell < data.zones.length; oldCell++) {
      const row = Math.floor(oldCell / LEGACY_COLS), column = oldCell % LEGACY_COLS;
      migrated.zones[row * CURRENT_COLS + column] = data.zones[oldCell];
    }
    return validate(migrated);
  }

  return { VERSION, ZONE_COUNT, validate, migrate };
});
