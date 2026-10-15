const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const loadGame = require('./harness.cjs');

function junction(type = 'STREET', control = 'YIELD') {
  const {api:a, context} = loadGame({blank:true});
  vm.runInContext('globalThis.junctionHooks = {Car, Path, arbitrate, buildSignal, computeConflicts, signalAllows, updateSignals, amberTime: CFG.AMBER_TIME}', context);
  const h = context.junctionHooks;
  a.W.cars = []; a.NET.nodes = []; a.NET.edges = [];
  const node = a.NET.addNode(500, 500);
  for (const [x,y] of [[500,100],[900,500],[500,900],[100,500]]) {
    a.NET.addEdge(node, a.NET.addNode(x,y), type);
  }
  node.control = control;
  h.buildSignal(node);

  function car(conn, {distance=18, speed=0, kind='CAR'} = {}) {
    const from = {x:0,y:0,lane:conn.fromLane,s:0};
    const dest = {x:0,y:0,lane:conn.toLane,s:conn.toLane.length-30};
    const c = new h.Car(from,dest,kind);
    c.setRoute([conn.fromLane,conn,conn.toLane],dest.lane,dest.s);
    c.s = c.track.length-distance; c.v = speed; c.v0 = 100; c.changeCd = 1000;
    a.W.cars.push(c);
    return c;
  }

  function index() {
    for (const e of a.NET.edges) for (const l of e.lanes) l.vehicles=[];
    for (const n of a.NET.nodes) for (const c of n.connectors) c.vehicles=[];
    for (const c of a.W.cars) if (!c.dead && c.track) c.track.vehicles.push(c);
    for (const c of a.W.cars) if (c.track) c.track.vehicles.sort((x,y)=>x.s-y.s);
  }

  function arbitrate() { index(); h.arbitrate(a.W.cars); }
  function occupy(conn, s, {speed=40, kind='CAR'} = {}) {
    const c = car(conn,{kind});
    c.track = conn; c.ri = 1; c.s = s; c.v = speed;
    c.claim = conn; c.claimT = 0;
    node.occ.set(conn.id, (node.occ.get(conn.id) || 0) + 1);
    return c;
  }
  return {a,h,node,car,occupy,index,arbitrate};
}

function conflictingPair(node, predicate = () => true) {
  for (const a of node.connectors) for (const b of a.conflicts) {
    if (a.id < b.id && a.conflictZonesByVehiclePair.get(b).CAR.length && predicate(a,b)) return [a,b];
  }
  return null;
}

test('a conflicting movement may reserve after the other vehicle rear clears its local zone',()=>{
  const f=junction();
  const pair=conflictingPair(f.node, (a,b)=>a.fromLane!==b.fromLane && a.conflictZones.has(b));
  assert.ok(pair);
  const [a,b]=pair;
  const zone=a.conflictZonesByVehiclePair.get(b).CAR[0];
  const lead=f.occupy(a, zone.end + 15/2 + 2);
  const follower=f.car(b);
  f.arbitrate();
  assert.ok(lead.claim===a, 'the vehicle keeps its connector reservation until the exit rear clears');
  assert.ok(follower.claim===b, 'a cleared local zone no longer blocks the rest of the connector');
});

test('rear clearance holds a conflict zone through the full vehicle footprint region',()=>{
  const f=junction();
  const pair=conflictingPair(f.node, (a,b)=>a.fromLane!==b.fromLane && a.conflictZones.has(b));
  assert.ok(pair);
  const [a,b]=pair;
  const zone=a.conflictZonesByVehiclePair.get(b).CAR[0];
  f.occupy(a, zone.end - 1);
  const follower=f.car(b);
  f.arbitrate();
  assert.ok(follower.claim===null,'the lead car rear still overlaps the paired conflict interval');
  assert.equal(follower.waitReason,'conflict');
});

test('predicted arrival windows admit a later car after the current movement clears',()=>{
  const f=junction('STREET','SIGNAL');
  const pair=conflictingPair(f.node, (a,b)=>a.fromLane!==b.fromLane && a.conflictZonesByVehiclePair.get(b).CAR[0].start>5);
  assert.ok(pair);
  const [a,b]=pair;
  const zone=a.conflictZonesByVehiclePair.get(b).CAR[0];
  const lead=f.occupy(a, zone.start - 2, {speed:80});
  const follower=f.car(b,{distance:115,speed:50});
  const signal=f.node.signal;
  signal.idx=signal.movementGroup ? signal.movementGroup.get(b.id) : signal.group.get(b.fromLane.id);
  signal.timer=0; signal.amber=false;
  f.arbitrate();
  assert.ok(lead.claim===a);
  assert.ok(follower.claim===b,'non-overlapping predicted conflict windows can reserve together');
  assert.ok(Number.isFinite(follower.reservationLeadTime));
});

test('an unentered future reservation is revalidated when its lead stalls',()=>{
  const f=junction('STREET','SIGNAL');
  const pair=conflictingPair(f.node, (a,b)=>a.fromLane!==b.fromLane && a.conflictZonesByVehiclePair.get(b).CAR[0].start>5);
  assert.ok(pair);
  const [a,b]=pair;
  const zone=a.conflictZonesByVehiclePair.get(b).CAR[0];
  const lead=f.occupy(a, zone.start - 2, {speed:80});
  const follower=f.car(b,{distance:115,speed:50});
  const signal=f.node.signal;
  signal.idx=signal.movementGroup ? signal.movementGroup.get(b.id) : signal.group.get(b.fromLane.id);
  signal.timer=0; signal.amber=false;
  f.arbitrate();
  assert.ok(lead.claim===a);
  assert.ok(follower.claim===b,'the original forecasts are non-overlapping');

  lead.v=0;
  f.arbitrate();
  assert.ok(follower.claim===null,'the unentered reservation yields after a stalled lead changes the forecast');
  assert.equal(follower.waitReason,'conflict');
  assert.ok(lead.claim===a,'a vehicle already on the connector keeps its reservation');
});

test('two entered connectors stage one vehicle before a shared region after a stall',()=>{
  const f=junction();
  const pair=conflictingPair(f.node, (a,b)=>{
    const zones=a.conflictZonesByVehiclePair?.get(b)?.CAR || [];
    return zones.some(z=>z.start>5 && z.otherStart>5);
  });
  assert.ok(pair);
  const [a,b]=pair;
  const zone=a.conflictZonesByVehiclePair.get(b).CAR.find(z=>z.start>5 && z.otherStart>5);
  const lead=f.occupy(a,zone.start-2,{speed:0});
  const follower=f.occupy(b,zone.otherStart-2,{speed:10});
  lead.claimT=5; follower.claimT=1;
  f.arbitrate();
  assert.ok(lead.claim===a && follower.claim===b,'entered connector claims are never revoked');
  assert.ok(follower.junctionStopS !== null && follower.junctionStopS < zone.otherStart,
    'the newer vehicle is held before the shared region');
  assert.equal(follower.waitReason,'conflict');
});

test('same-source movements reserve their shared departure prefix with spacing',()=>{
  const f=junction();
  const pair=conflictingPair(f.node, (a,b)=>a.fromLane===b.fromLane && a.conflictZones.has(b));
  assert.ok(pair,'diverging movements from one lane retain a geometric shared prefix');
  const [a,b]=pair;
  const first=f.car(a,{distance:18,speed:0});
  const second=f.car(b,{distance:18,speed:0});
  f.arbitrate();
  assert.equal([first,second].filter(c=>c.claim).length,1);
  assert.equal([first,second].find(c=>!c.claim).waitReason,'conflict');
});

test('conflict geometry includes long angled vehicle footprints near connector ends',()=>{
  const f=junction();
  const rail=(from,to)=>({
    fromLane:{edge:{}},toLane:{edge:{}},path:f.h.Path.line(from,to),conflicts:[],
  });
  const a=rail({x:0,y:0},{x:30,y:0});
  const b=rail({x:12,y:12},{x:12,y:40});
  a.length=a.path.length;b.length=b.path.length;
  f.h.computeConflicts({connectors:[a,b]});
  assert.ok(a.conflicts.includes(b),'truck and car bodies overlap although their centerlines stay 12 units apart');
  assert.ok(a.conflictZones.get(b)?.length);
});

test('signal greens never authorize geometrically conflicting movements together',()=>{
  const f=junction('STREET','SIGNAL');
  const signal=f.node.signal;
  assert.equal(typeof signal.group.get,'function','retain the legacy inbound lane-to-phase map');
  for (let phase=0; phase<signal.phases; phase++) {
    signal.idx=phase; signal.amber=false;
    const green=f.node.connectors.filter(c=>f.h.signalAllows(f.node,c));
    for (let i=0;i<green.length;i++) for (let j=i+1;j<green.length;j++) {
      assert.equal(green[i].conflicts.includes(green[j]),false,
        `phase ${phase} gives conflicting movements ${green[i].id} and ${green[j].id} green`);
    }
  }
});

test('signals leave empty phases for a phase with queued movement demand',()=>{
  const f=junction('STREET','SIGNAL');
  const signal=f.node.signal;
  const conn=f.node.connectors.find(c => {
    const phase=signal.movementGroup.get(c.id);
    return phase!==signal.idx && phase!==undefined;
  });
  assert.ok(conn,'fixture has a movement in another compatible phase');
  const demandedPhase=signal.movementGroup.get(conn.id);
  signal.idx=(demandedPhase+1)%signal.phases;
  signal.timer=1.3;
  f.car(conn,{distance:18,speed:0});
  f.index();
  f.h.updateSignals(0.05);
  assert.equal(signal.amber,true,'an empty green yields after its minimum green');
  f.h.updateSignals(f.h.amberTime);
  assert.equal(signal.idx,demandedPhase,'amber ends at a phase with queued demand');
});

test('signals hold their current green when no movement is waiting',()=>{
  const f=junction('STREET','SIGNAL');
  const signal=f.node.signal;
  signal.idx=1;
  signal.timer=100;
  f.h.updateSignals(0.05);
  assert.equal(signal.amber,false);
  assert.equal(signal.idx,1);
});
