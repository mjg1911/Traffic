const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const loadGame = require('./harness.cjs');

function approach(type = 'AVENUE') {
  const {api:a, context} = loadGame({blank:true});
  vm.runInContext('globalThis.laneHooks = {Car, considerLaneChange, arbitrate, buildSignal}', context);
  const h = context.laneHooks;
  a.W.cars = []; a.NET.nodes = []; a.NET.edges = [];
  const node = a.NET.addNode(500,500);
  for (const [x,y] of [[500,0],[1000,500],[500,1000],[0,500]]) {
    a.NET.addEdge(a.NET.addNode(x,y),node,type);
  }
  node.control = 'SIGNAL'; h.buildSignal(node);
  const turn = node.connectors.find(c=>c.turn < -.45 && c.turn > -2);
  const lanes = turn.fromLane.siblings;
  function car(lane, distance, speed = 0, connector = turn) {
    const dest = {x:0,y:0,lane:connector.toLane,s:connector.toLane.length-30};
    const c = new h.Car({x:0,y:0,lane,s:0},dest);
    c.setRoute([lane,connector,connector.toLane],dest.lane,dest.s);
    c.s = lane.length-distance; c.v = speed; c.v0 = 100; c.changeCd = 0;
    a.W.cars.push(c);
    return c;
  }
  function index() {
    for (const e of a.NET.edges) for (const l of e.lanes) l.vehicles = [];
    for (const n of a.NET.nodes) for (const c of n.connectors) c.vehicles = [];
    for (const c of a.W.cars) if (!c.dead && c.track) c.track.vehicles.push(c);
    for (const c of a.W.cars) if (c.track) c.track.vehicles.sort((x,y)=>x.s-y.s);
  }
  return {a,h,node,turn,lanes,car,index};
}

test('left-turning cars stay in their approach lane instead of passing a red-light queue',()=>{
  const f = approach();
  const c = f.car(f.turn.fromLane,180,35);
  f.car(f.turn.fromLane,140);
  f.index();
  f.h.considerLaneChange(c,1/60);
  assert.ok(c.track===f.turn.fromLane || c.manoeuvre?.target===f.turn.fromLane);
});

test('cars pre-sort into a slower turn queue as soon as a safe gap is available',()=>{
  const f = approach();
  const c = f.car(f.lanes[0],250,60);
  f.car(f.turn.fromLane,180);
  c.changeCd = f.a.CFG.CHANGE_CD;
  f.index();
  f.h.considerLaneChange(c,1/60);
  assert.ok(c.track===f.turn.fromLane || c.manoeuvre?.target===f.turn.fromLane);
});

test('mandatory pre-sorting prioritizes a safe gap over the acceleration advantage',()=>{
  const f = approach();
  const c = f.car(f.lanes[0],240,80);
  f.car(f.turn.fromLane,190);
  f.index();
  f.h.considerLaneChange(c,1/60);
  assert.ok(c.track===f.turn.fromLane || c.manoeuvre?.target===f.turn.fromLane);
});

test('a car still moving sideways cannot reserve a junction',()=>{
  const f = approach();
  const c = f.car(f.turn.fromLane,18,10);
  c.lat = f.a.CFG.LANE_W;
  f.node.signal.idx = (f.node.signal.movementGroup?.get(f.turn.id) ?? f.node.signal.group.get(f.turn.fromLane.id));
  f.index(); f.h.arbitrate(f.a.W.cars);
  assert.ok(c.claim===null);
});

test('an existing reservation cannot snap a merging car onto its turn',()=>{
  const f = approach();
  const c = f.car(f.turn.fromLane,.1,100);
  c.lat = f.a.CFG.LANE_W;
  c.claim = f.turn; f.node.occ.set(f.turn.id,1);
  f.index(); c.step(1/60);
  assert.equal(c.track.kind,'LANE');
  assert.ok(c.lat > 0,'lateral interpolation must finish before entering the connector');
});

test('waiting behind upstream traffic preserves the intended turn',()=>{
  const f = approach();
  const c = f.car(f.lanes[0],180);
  f.car(f.lanes[0],159);
  c.wait = 3.6;
  f.index(); c.step(1/60);
  assert.ok(c.route[c.ri+1]===f.turn);
  assert.equal(c.wantIdx,f.turn.fromLane.idx);
});

test('pre-sorting never merges into an occupied gap',()=>{
  const f = approach();
  const c = f.car(f.lanes[0],200,30);
  f.car(f.turn.fromLane,200);
  f.index(); f.h.considerLaneChange(c,1/60);
  assert.ok(c.track===f.lanes[0]);
});

test('pre-sorting waits when a slower target-lane leader leaves insufficient braking room',()=>{
  const f = approach();
  const c = f.car(f.lanes[0],200,100);
  f.car(f.turn.fromLane,175);
  f.index(); f.h.considerLaneChange(c,1/60);
  assert.ok(c.track===f.lanes[0]);
});

test('a highway car pre-sorts across two adjacent lanes and settles before the stop line',()=>{
  const f = approach('HIGHWAY');
  const c = f.car(f.lanes[0],300,70);
  f.node.signal.idx = ((f.node.signal.movementGroup?.get(f.turn.id) ?? f.node.signal.group.get(f.turn.fromLane.id))+1)%f.node.signal.phases;
  for (let i=0;i<300;i++) {
    f.index(); f.h.arbitrate(f.a.W.cars);
    f.h.considerLaneChange(c,1/60); c.step(1/60);
  }
  assert.ok(c.track===f.turn.fromLane);
  assert.equal(c.lat,0);
  assert.ok(c.claim===null);
  f.node.signal.idx = (f.node.signal.movementGroup?.get(f.turn.id) ?? f.node.signal.group.get(f.turn.fromLane.id));
  let entered = false;
  for (let i=0;i<300;i++) {
    f.index(); f.h.arbitrate(f.a.W.cars);
    f.h.considerLaneChange(c,1/60); c.step(1/60);
    if (c.track === f.turn) { entered = true; assert.equal(c.lat,0); break; }
  }
  assert.ok(entered,'pre-sorted car should take its turn when green');
});
