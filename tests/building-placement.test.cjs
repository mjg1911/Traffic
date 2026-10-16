const assert = require('node:assert/strict');
const {test} = require('node:test');
const Placement = require('../building-placement.js');

const closeTo = (actual, expected, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} is not close to ${expected}`);
};

const path = (length, point, direction) => ({
  length,
  pos: point,
  dir: direction
});

test('exports fixed tile, setback, gap, and building size presets', () => {
  assert.equal(Placement.TILE, 15);
  assert.equal(Placement.GAP, 3);
  assert.equal(Placement.SETBACK, 2);
  assert.deepEqual(Placement.SIZES, {
    S: {width: 60, depth: 45, parking: 1, multiplier: 1},
    M: {width: 90, depth: 60, parking: 4, multiplier: 3},
    L: {width: 120, depth: 120, parking: 16, multiplier: 8}
  });
});

test('corners and contains use the full rotated rectangle', () => {
  const lot = {x: 10, y: 20, width: 8, depth: 4, angle: Math.PI / 2};
  const points = Placement.corners(lot);

  assert.equal(points.length, 4);
  for (const point of points) {
    closeTo(point.x, point.x < 10 ? 8 : 12);
    closeTo(point.y, point.y < 20 ? 16 : 24);
  }
  assert.equal(Placement.contains(lot, {x: 11.9, y: 23.9}), true);
  assert.equal(Placement.contains(lot, {x: 12.1, y: 20}), false);
  assert.equal(Placement.contains(lot, {x: 12.1, y: 20}, 0.2), true);
});

test('overlaps uses SAT for rotated rectangles, contained lots, and spacing', () => {
  const barA = {x: 0, y: 0, width: 12, depth: 2, angle: Math.PI / 4};
  const barB = {x: 0, y: 0, width: 12, depth: 2, angle: -Math.PI / 4};
  const contained = {x: 0, y: 0, width: 1, depth: 1, angle: 0};
  const touching = {x: 0, y: 2, width: 4, depth: 2, angle: 0};
  const beyondGap = {x: 0, y: 6.01, width: 4, depth: 2, angle: 0};

  assert.equal(Placement.overlaps(barA, barB), true);
  assert.equal(Placement.overlaps(barA, contained), true);
  assert.equal(Placement.overlaps(touching, {...touching, y: 4}), false);
  assert.equal(Placement.overlaps(touching, {...touching, y: 4}, 2), true);
  assert.equal(Placement.overlaps(touching, beyondGap, 2), false);
});

test('corridorOverlaps checks exact distance from every polyline segment to the lot', () => {
  const lot = {x: 0, y: 0, width: 10, depth: 4, angle: 0};
  const distantRoad = [{x: -8, y: 2.2}, {x: -4.9, y: 2.2}, {x: -4, y: 5}];

  assert.equal(Placement.corridorOverlaps(lot, distantRoad, 0.25), true);
  assert.equal(Placement.corridorOverlaps(lot, distantRoad, 0.1), false);
  assert.equal(Placement.corridorOverlaps(lot, [{x: -8, y: 7}, {x: 8, y: 7}], 2), false);
});

test('alongRoad aligns the lot with the tangent and places its front setback on either side', () => {
  const diagonal = Math.PI / 6;
  const road = path(100, () => ({x: 20, y: 30}), () => ({x: Math.cos(diagonal), y: Math.sin(diagonal)}));
  const halfWidth = 7;
  const positive = Placement.alongRoad(road, halfWidth, 40, 1, 'S');
  const negative = Placement.alongRoad(road, halfWidth, 40, -1, 'S');
  const normal = {x: -Math.sin(diagonal), y: Math.cos(diagonal)};
  const frontOffset = halfWidth + Placement.SETBACK;

  closeTo(positive.angle, diagonal);
  closeTo(negative.angle, diagonal + Math.PI);
  closeTo(positive.width, Placement.SIZES.S.width);
  closeTo(positive.depth, Placement.SIZES.S.depth);
  closeTo(positive.entrance.x, 20 + normal.x * frontOffset);
  closeTo(positive.entrance.y, 30 + normal.y * frontOffset);
  closeTo(negative.entrance.x, 20 - normal.x * frontOffset);
  closeTo(negative.entrance.y, 30 - normal.y * frontOffset);
});

test('geometry rejects invalid finite coordinates and negative dimensions', () => {
  assert.throws(() => Placement.corners({x: NaN, y: 0, width: 2, depth: 2, angle: 0}), /finite/i);
  assert.throws(() => Placement.contains({x: 0, y: 0, width: -2, depth: 2, angle: 0}, {x: 0, y: 0}), /finite|positive|dimension/i);
  assert.throws(() => Placement.alongRoad(path(10, () => ({x: 0, y: 0}), () => ({x: 1, y: 0})), -1, 1, 1, 'S'), /finite|non-negative|width/i);
});
