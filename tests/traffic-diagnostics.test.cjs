const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const diagnostics = require('../traffic-diagnostics.js');

test('module exposes the same API as a browser global and CommonJS export', () => {
  const browser = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../traffic-diagnostics.js'), 'utf8'), browser);

  assert.equal(typeof browser.TrafficDiagnostics.detectSweptOverlaps, 'function');
  assert.equal(typeof diagnostics.detectSweptOverlaps, 'function');
  assert.equal(typeof browser.TrafficDiagnostics.createRecorder, 'function');
});

function vehicle(id, x0, y0, x1, y1, options = {}) {
  return {
    id,
    ppx: x0,
    ppy: y0,
    pang: options.startAngle ?? 0,
    px: x1,
    py: y1,
    ang: options.endAngle ?? options.startAngle ?? 0,
    len: options.len ?? 15,
    wide: options.wide ?? 8,
    kind: options.kind ?? 'CAR',
    phase: options.phase ?? 'BACK',
    dead: options.dead ?? false,
  };
}

test('footprint SAT detects oriented rectangle overlap and separates disjoint boxes', () => {
  const a = diagnostics.footprintAt(vehicle('a', 0, 0, 0, 0), {x: 0, y: 0, angle: 0});
  const crossing = diagnostics.footprintAt(vehicle('b', 0, 0, 0, 0, {startAngle: Math.PI / 2}), {x: 0, y: 0, angle: Math.PI / 2});
  const apart = diagnostics.footprintAt(vehicle('c', 0, 20, 0, 20), {x: 0, y: 20, angle: 0});

  assert.equal(diagnostics.footprintsOverlap(a, crossing), true);
  assert.equal(diagnostics.footprintsOverlap(a, apart), false);
});

test('swept detector reports close passes without counting them as overlaps', () => {
  const first = vehicle('first', 0, 0, 0, 0);
  const second = vehicle('second', 0, 10.5, 0, 10.5);
  const firstBox = diagnostics.footprintAt(first, {x: 0, y: 0, angle: 0});
  const secondBox = diagnostics.footprintAt(second, {x: 0, y: 10.5, angle: 0});

  assert.equal(diagnostics.footprintDistance(firstBox, secondBox), 2.5);
  const result = diagnostics.detectSweptOverlaps([first, second]);
  assert.equal(result.overlaps.length, 0);
  assert.equal(result.nearMisses.length, 1);
  assert.equal(result.nearMisses[0].clearance, 2.5);
});

test('near-miss tolerance and subdivision proof agree at the clearance threshold', () => {
  const first = vehicle('first', 0, 0, 0, 0);
  const clearance = 3 + 1e-12;
  const second = vehicle('second', 0, 8 + clearance, 0, 8 + clearance);

  const result = diagnostics.detectSweptOverlaps([first, second]);

  assert.equal(result.overlaps.length, 0);
  assert.equal(result.nearMisses.length, 1);
  assert.ok(Math.abs(result.nearMisses[0].clearance - clearance) < 1e-12);
  assert.equal(result.inconclusive.length, 0);
  assert.equal(result.stats.truncated, false);
});

test('rectangle distance checks vertices of either box against every edge of the other', () => {
  const long = vehicle('long', 0, 0, 0, 0, {len: 100, wide: 2});
  const short = vehicle('short', 0, 4.5, 0, 4.5, {len: 4, wide: 2});
  const longBox = diagnostics.footprintAt(long, {x: 0, y: 0, angle: 0});
  const shortBox = diagnostics.footprintAt(short, {x: 0, y: 4.5, angle: 0});

  assert.equal(diagnostics.footprintDistance(longBox, shortBox), 2.5);
});

test('swept detector catches a fast perpendicular car and truck crossing between endpoint poses', () => {
  const horizontal = vehicle('horizontal-truck', -120, 3, 120, 3, {kind: 'TRUCK', len: 24, wide: 9.5});
  const vertical = vehicle('vertical', 0, -100, 0, 100, {startAngle: Math.PI / 2});
  vertical.ang = Math.PI / 2;

  const result = diagnostics.detectSweptOverlaps([horizontal, vertical]);

  assert.equal(result.overlaps.length, 1);
  assert.deepEqual(result.overlaps[0].ids, ['horizontal-truck', 'vertical']);
  assert.ok(result.overlaps[0].time > 0 && result.overlaps[0].time < 1);
});

test('swept detector catches a corner-grazing collision between coarse samples', () => {
  const stationary = vehicle('stationary', 0, 0, 0, 0);
  const grazing = vehicle('grazing', -100, 122.99, 100, -77.01);

  const result = diagnostics.detectSweptOverlaps([stationary, grazing]);

  assert.equal(result.overlaps.length, 1);
  assert.deepEqual(result.overlaps[0].ids, ['stationary', 'grazing']);
  assert.ok(result.overlaps[0].time > 0 && result.overlaps[0].time < 1);
});

test('swept detector marks unresolved candidate pairs when its adaptive budget runs out', () => {
  const stationary = vehicle('stationary', 0, 0, 0, 0);
  const grazing = vehicle('grazing', -100, 122.99, 100, -77.01);

  const result = diagnostics.detectSweptOverlaps([stationary, grazing], {maxSamplesPerPair: 2});

  assert.equal(result.overlaps.length, 0);
  assert.equal(result.inconclusive.length, 1);
  assert.deepEqual(result.inconclusive[0].ids, ['stationary', 'grazing']);
  assert.equal(result.stats.truncated, true);
});

test('swept detector does not flag safe same-lane headway or nearby parallel trucks', () => {
  const sameLane = [vehicle('lead', 0, 0, 0, 0), vehicle('following', 18, 0, 18, 0)];
  const trucks = [
    vehicle('truck-a', 0, 30, 0, 30, {kind: 'TRUCK', len: 24, wide: 9.5}),
    vehicle('truck-b', 0, 42, 0, 42, {kind: 'TRUCK', len: 24, wide: 9.5}),
  ];

  assert.equal(diagnostics.detectSweptOverlaps(sameLane).overlaps.length, 0);
  assert.equal(diagnostics.detectSweptOverlaps(trucks).overlaps.length, 0);
});

test('sweep interpolation follows the short angular arc across minus pi and pi', () => {
  const car = vehicle('turning', 0, 0, 0, 0, {startAngle: Math.PI - 0.1, endAngle: -Math.PI + 0.1});
  const middle = diagnostics.interpolatePose(car, 0.5);

  assert.ok(Math.abs(Math.abs(middle.angle) - Math.PI) < 1e-9);
  assert.ok(Math.abs(diagnostics.angleDelta(car.pang, middle.angle)) < 0.11);
});

test('swept detector excludes dead, entering, and visiting vehicles', () => {
  const live = vehicle('live', -100, 0, 100, 0);
  const dead = vehicle('dead', 0, -100, 0, 100, {dead: true, startAngle: Math.PI / 2});
  const entering = vehicle('entering', 0, -100, 0, 100, {phase: 'ENTER', startAngle: Math.PI / 2});
  const visiting = vehicle('visiting', 0, -100, 0, 100, {phase: 'VISIT', startAngle: Math.PI / 2});

  assert.equal(diagnostics.detectSweptOverlaps([live, dead, entering, visiting]).overlaps.length, 0);
});

test('spatial broadphase sharply reduces candidates for a dispersed 240-car scene', () => {
  const cars = Array.from({length: 240}, (_, i) => {
    const x = (i % 20) * 100;
    const y = Math.floor(i / 20) * 100;
    return vehicle(`car-${i}`, x, y, x + 0.5, y);
  });

  const result = diagnostics.detectSweptOverlaps(cars);

  assert.equal(result.stats.vehicleCount, 240);
  assert.ok(result.stats.candidatePairs < (240 * 239) / 20);
  assert.equal(result.stats.truncated, false);
});

test('detector reports when its configured vehicle cap truncates a scan', () => {
  const cars = Array.from({length: 12}, (_, i) => vehicle(`c${i}`, i * 100, 0, i * 100, 0));
  const result = diagnostics.detectSweptOverlaps(cars, {maxVehicles: 10});

  assert.equal(result.stats.vehicleCount, 10);
  assert.equal(result.stats.inputCount, 12);
  assert.equal(result.stats.truncated, true);
});

test('diagnostic recorder summarizes bounded trip, wait, lane, route, reservation, safety, and performance metrics', () => {
  const recorder = diagnostics.createRecorder({maxEvents: 4, maxSamples: 3});
  recorder.recordTrip({vehicleId: 'a', duration: 10});
  recorder.recordTrip({vehicleId: 'b', duration: 20});
  recorder.recordWait({vehicleId: 'a', reason: 'signal', seconds: 2});
  recorder.recordWait({vehicleId: 'a', reason: 'queue', seconds: 3});
  recorder.recordLaneChange({vehicleId: 'a', duration: 1.2, success: true});
  recorder.recordRouteChange({vehicleId: 'a', reason: 'congestion'});
  recorder.recordReservation({vehicleId: 'a', requestedAt: 5, grantedAt: 6.5});
  recorder.recordSafety({overlaps: [{ids: ['a', 'b']}], nearMisses: [{ids: ['a', 'c']}]});
  recorder.recordPerformance({frameMs: 16, vehicleCount: 240});
  recorder.recordPerformance({frameMs: 32, vehicleCount: 240});
  recorder.recordSafety({inconclusive: [{ids: ['x', 'y']}], stats: {truncated: true}});

  const summary = recorder.summary();
  assert.equal(summary.trips.count, 2);
  assert.equal(summary.trips.average, 15);
  assert.equal(summary.waitReasons.signal.seconds, 2);
  assert.equal(summary.waitReasons.queue.seconds, 3);
  assert.equal(summary.laneChanges.count, 1);
  assert.equal(summary.routeChanges.count, 1);
  assert.equal(summary.reservationLead.average, 1.5);
  assert.equal(summary.safety.overlaps, 1);
  assert.equal(summary.safety.nearMisses, 1);
  assert.equal(summary.safety.inconclusivePairs, 1);
  assert.equal(summary.safety.incompleteScans, 1);
  assert.equal(summary.performance.averageFrameMs, 24);
  assert.equal(recorder.getEvents().length, 4);
});

test('a proven collision-free near-threshold pass does not exhaust the safety scan on near-miss precision',()=>{
  const a=vehicle('a',0,0,0,0),b=vehicle('b',-1,11+1e-8,1,11+1e-8);
  const result=diagnostics.detectSweptOverlaps([a,b]);
  assert.equal(result.overlaps.length,0);
  assert.equal(result.stats.truncated,false);
  assert.equal(result.nearMisses.length,1);
  assert.equal(result.nearMisses[0].possible,true);
});
