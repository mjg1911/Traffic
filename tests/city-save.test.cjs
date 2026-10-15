const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const modulePath = path.join(__dirname, '..', 'city-save.js');
const CitySave = fs.existsSync(modulePath)
  ? require('../city-save.js')
  : { VERSION: undefined, ZONE_COUNT: undefined, validate: data => data };

const ZONE_COUNT = Math.ceil(3000 / 34) * Math.ceil(2000 / 34);

function validCity() {
  const zones = Array(ZONE_COUNT).fill(0);
  zones[0] = 1;
  zones[1] = 2;
  zones[2] = 3;
  return {
    version: 1,
    seed: 0,
    time: 12.5,
    nodes: [
      { id: 1, x: 0, y: 0, control: 'YIELD', isRing: false, ringId: 0 },
      { id: 2, x: 100, y: 0, control: 'STOP', isRing: false, ringId: 0 },
      { id: 3, x: 500, y: 500, control: 'YIELD', isRing: true, ringId: 1 },
      { id: 4, x: 520, y: 465, control: 'YIELD', isRing: true, ringId: 1 },
      { id: 5, x: 540, y: 500, control: 'YIELD', isRing: true, ringId: 1 },
    ],
    edges: [
      { id: 1, n1: 1, n2: 2, type: 'STREET', bend: 0 },
      { id: 2, n1: 3, n2: 4, type: 'RING', bend: 0 },
      { id: 3, n1: 4, n2: 5, type: 'RING', bend: 0 },
      { id: 4, n1: 5, n2: 3, type: 'RING', bend: 0 },
    ],
    rings: [{ id: 1, cx: 520, cy: 500, R: 22, hw: 11, nodes: [3, 4, 5] }],
    river: {
      centre: [{ x: 120, y: 300 }, { x: 240, y: 320 }],
      poly: [{ x: 110, y: 290 }, { x: 250, y: 310 }, { x: 310, y: 350 }],
    },
    zones,
    buildings: [
      { x: 17, y: 17, type: 'R', level: 1, cell: 0, service: 0.65, starve: 0, since: 0, trips: 2, outTimer: 8, born: 1, seed: 0.25 },
      { x: 51, y: 17, type: 'C', level: 2, cell: 1, service: 0.8, starve: 0, since: 4, trips: 3, outTimer: 12, born: 2, seed: 0.75 },
      { x: 85, y: 17, type: 'I', level: 3, cell: 2, service: 1, starve: 1, since: 5, trips: 4, outTimer: 15, born: 3, seed: 1 },
    ],
    camera: { x: 800, y: 600, z: 1.2 },
    trips: [18.25, 20],
    settings: { grid: true, drawMode: 'curve', roadType: 'AVENUE' },
  };
}

function assertInvalid(mutator, pattern = /invalid city save/i) {
  const data = structuredClone(validCity());
  mutator(data);
  assert.throws(() => CitySave.validate(data), pattern);
}

test('valid version 1 city with roads, ring, river, zones, buildings and trips passes unchanged', () => {
  const data = validCity();
  assert.equal(CitySave.VERSION, 1);
  assert.equal(CitySave.ZONE_COUNT, ZONE_COUNT);
  assert.equal(CitySave.validate(data), data);
});

test('CitySave is available as a browser global as well as CommonJS', () => {
  const source = fs.existsSync(modulePath) ? fs.readFileSync(modulePath, 'utf8') : '';
  const browser = {};
  vm.runInNewContext(source, browser);
  assert.equal(typeof browser.CitySave?.validate, 'function');
  assert.equal(browser.CitySave.VERSION, 1);
  assert.equal(browser.CitySave.validate(validCity()).version, 1);
});

test('rejects unsupported versions and missing required top-level fields', () => {
  assertInvalid(data => { data.version = 2; });
  assertInvalid(data => { delete data.camera; });
  assertInvalid(data => { data.settings = null; });
});

test('rejects invalid seed and time values', () => {
  assertInvalid(data => { data.seed = -1; });
  assertInvalid(data => { data.seed = 4294967296; });
  assertInvalid(data => { data.time = Infinity; });
  assertInvalid(data => { data.time = 1e9 + 1; });
});

test('rejects malformed nodes, duplicate IDs, and non-finite or excessive coordinates', () => {
  assertInvalid(data => { data.nodes[0].x = NaN; });
  assertInvalid(data => { data.nodes[0].y = 10001; });
  assertInvalid(data => { data.nodes[1].id = data.nodes[0].id; });
  assertInvalid(data => { data.nodes[0].control = 'GO'; });
  assertInvalid(data => { data.nodes[0].isRing = 1; });
});

test('rejects invalid edges, duplicate connections, dangling IDs, self-loops, and long bends', () => {
  assertInvalid(data => { data.edges[0].type = 'ALLEY'; });
  assertInvalid(data => { data.edges[0].n2 = 999; });
  assertInvalid(data => { data.edges[0].n2 = data.edges[0].n1; });
  assertInvalid(data => { data.nodes[1].x = data.nodes[0].x; });
  assertInvalid(data => { data.edges[0].bend = 101; });
  assertInvalid(data => { data.edges.push({ ...data.edges[0], id: 5, n1: 2, n2: 1 }); });
  assertInvalid(data => { data.edges[1].id = data.edges[0].id; });
});

test('requires ring declarations and node membership to agree with ring edges', () => {
  assertInvalid(data => { data.rings[0].nodes.pop(); });
  assertInvalid(data => { data.nodes[2].ringId = 7; });
  assertInvalid(data => { data.edges[1].n2 = 2; });
  assertInvalid(data => { data.rings[0].nodes[1] = 999; });
  assertInvalid(data => { data.rings.push({ ...data.rings[0] }); });
});

test('requires each ring member to have exactly one incoming and one outgoing ring edge', () => {
  assertInvalid(data => { data.edges = data.edges.filter(edge => edge.type !== 'RING'); });
  assertInvalid(data => { data.edges.pop(); });
  assertInvalid(data => { [data.edges[1].n1, data.edges[1].n2] = [data.edges[1].n2, data.edges[1].n1]; });
});

test('rejects disjoint directed cycles that do not cover one roundabout', () => {
  const data = validCity();
  data.nodes.push({ id: 6, x: 560, y: 500, control: 'YIELD', isRing: true, ringId: 1 });
  data.nodes.push({ id: 7, x: 520, y: 540, control: 'YIELD', isRing: true, ringId: 1 });
  data.nodes.push({ id: 8, x: 480, y: 500, control: 'YIELD', isRing: true, ringId: 1 });
  data.rings[0].nodes.push(6, 7, 8);
  data.edges = [
    data.edges[0],
    { id: 2, n1: 3, n2: 4, type: 'RING', bend: 0 },
    { id: 3, n1: 4, n2: 5, type: 'RING', bend: 0 },
    { id: 4, n1: 5, n2: 3, type: 'RING', bend: 0 },
    { id: 5, n1: 6, n2: 7, type: 'RING', bend: 0 },
    { id: 6, n1: 7, n2: 8, type: 'RING', bend: 0 },
    { id: 7, n1: 8, n2: 6, type: 'RING', bend: 0 },
  ];
  assert.throws(() => CitySave.validate(data), /invalid city save/i);
});

test('rejects malformed river geometry and corrupt zone arrays', () => {
  assertInvalid(data => { data.river.centre[0].x = NaN; });
  assertInvalid(data => { data.river.poly = null; });
  assertInvalid(data => { data.river.centre.pop(); });
  assertInvalid(data => { data.river.poly.pop(); });
  assertInvalid(data => { data.river.poly[0].y = 10001; });
  assertInvalid(data => { data.zones.pop(); });
  assertInvalid(data => { delete data.zones[100]; });
  assertInvalid(data => { data.zones[1] = 4; });
  assertInvalid(data => { data.zones[0] = 1.5; });
});

test('rejects invalid buildings, duplicate cells, and zone/type mismatches', () => {
  assertInvalid(data => { data.buildings[0].level = 4; });
  assertInvalid(data => { data.buildings[0].service = 1.1; });
  assertInvalid(data => { data.buildings[0].cell = ZONE_COUNT; });
  assertInvalid(data => { data.buildings[1].cell = 0; });
  assertInvalid(data => { data.buildings[0].type = 'C'; });
  assertInvalid(data => { data.buildings[0].trips = -1; });
  assertInvalid(data => { data.buildings[0].x = -10001; });
  assertInvalid(data => { data.buildings[1].y = 10001; });
});

test('bounds ring centers and half-width for stable geometry reconstruction', () => {
  assertInvalid(data => { data.rings[0].cx = 10001; });
  assertInvalid(data => { data.rings[0].cy = -10001; });
  assertInvalid(data => { data.rings[0].hw = 101; });
});

test('rejects invalid camera, trips, and editing settings', () => {
  assertInvalid(data => { data.camera.z = 0.17; });
  assertInvalid(data => { data.camera.x = Infinity; });
  assertInvalid(data => { data.camera.x = 10001; });
  assertInvalid(data => { data.camera.y = -10001; });
  assertInvalid(data => { data.trips[0] = -1; });
  assertInvalid(data => { data.settings.grid = 'yes'; });
  assertInvalid(data => { data.settings.drawMode = 'free'; });
  assertInvalid(data => { data.settings.roadType = 'RING'; });
});

test('rejects arrays above each documented size limit', () => {
  assertInvalid(data => { data.nodes = Array.from({ length: 2001 }, (_, id) => ({ id: id + 1, x: id, y: 0, control: 'YIELD', isRing: false, ringId: 0 })); });
  assertInvalid(data => { data.edges = Array.from({ length: 4001 }, (_, id) => ({ id: id + 1, n1: 1, n2: 2, type: 'STREET', bend: 0 })); });
  assertInvalid(data => { data.buildings = Array.from({ length: 2001 }, (_, id) => ({ x: 17, y: 17, type: 'R', level: 1, cell: id, service: 0, starve: 0, since: 0, trips: 0, outTimer: 0, born: 0, seed: 0 })); });
  assertInvalid(data => { data.rings = Array.from({ length: 501 }, (_, id) => ({ id: id + 1, cx: 0, cy: 0, R: 1, hw: 1, nodes: [3, 4, 5] })); });
  assertInvalid(data => { data.river.centre = Array.from({ length: 901 }, (_, id) => ({ x: id, y: id })); data.river.poly = Array.from({ length: 900 }, (_, id) => ({ x: id, y: id })); });
  assertInvalid(data => { data.trips = Array(1001).fill(1); });
});

test('keeps identifiers below the safe regenerated-ID range', () => {
  const tooHigh = Number.MAX_SAFE_INTEGER - 99999;
  assertInvalid(data => { data.nodes[0].id = tooHigh; data.edges[0].n1 = tooHigh; });
  assertInvalid(data => { data.edges[0].id = tooHigh; });
  assertInvalid(data => { data.rings[0].id = tooHigh; data.nodes[2].ringId = tooHigh; });
});

test('accepts harmless extra properties without rewriting the input', () => {
  const data = validCity();
  data.author = 'local player';
  data.nodes[0].label = 'market junction';
  assert.equal(CitySave.validate(data), data);
  assert.equal(data.author, 'local player');
  assert.equal(data.nodes[0].label, 'market junction');
});
