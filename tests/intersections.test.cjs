const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const loadGame = require('./harness.cjs');

function junction(type = 'STREET', control = 'SIGNAL') {
  const {api:a, context} = loadGame();
  vm.runInContext('globalThis.junctionHooks = {Car, Path, arbitrate, buildSignal, computeConflicts}', context);
  const h = context.junctionHooks;
  a.W.cars = []; a.NET.nodes = []; a.NET.edges = [];
  const node = a.NET.addNode(500, 500);
  for (const [x,y] of [[500,100],[900,500],[500,900],[100,500]]) {
    a.NET.addEdge(node, a.NET.addNode(x,y), type);
  }
  node.control = control; h.buildSignal(node);
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
    for (const c of a.W.cars) if(c.track) c.track.vehicles.sort((x,y)=>x.s-y.s);
  }
  function arbitrate() { index(); h.arbitrate(a.W.cars); }
  return {a,h,node,car,index,arbitrate};
}

test('opposing street through movements reserve together',()=>{
  const f=junction(), through=f.node.connectors.filter(c=>Math.abs(c.turn)<.1);
  const phase=f.node.signal.idx;
  const cars=through.filter(c=>f.node.signal.group.get(c.fromLane.id)===phase).map(c=>f.car(c));
  assert.equal(cars.length,2);
  f.arbitrate();
  assert.equal(cars.filter(c=>c.claim).length,2);
});

test('all four independent right turns can reserve together at a yield junction',()=>{
  const f=junction('STREET','YIELD');
  const cars=f.node.connectors.filter(c=>c.turn>.45).map(c=>f.car(c,{speed:10}));
  assert.equal(cars.length,4);
  f.arbitrate();
  assert.equal(cars.filter(c=>c.claim).length,4);
});

for (const [type,count] of [['AVENUE',4],['HIGHWAY',6]]) {
  test(`${type} admits every compatible through lane in both directions`,()=>{
    const f=junction(type);
    const cars=f.node.connectors.filter(c=>Math.abs(c.turn)<.1 &&
      f.node.signal.group.get(c.fromLane.id)===f.node.signal.idx).map(c=>f.car(c));
    assert.equal(cars.length,count);
    f.arbitrate();
    assert.equal(cars.filter(c=>c.claim).length,count);
  });
}

test('conflict geometry catches crossings between sample points',()=>{
  const f=junction();
  const rail=(p,q)=>({fromLane:{edge:{}},toLane:{edge:{}},path:f.h.Path.line(p,q),conflicts:[]});
  const a=rail({x:0,y:0},{x:140,y:0}), b=rail({x:10,y:-10},{x:10,y:130});
  a.length=a.path.length; b.length=b.path.length;
  f.h.computeConflicts({connectors:[a,b]});
  assert.ok(a.conflicts.includes(b));
  assert.ok(b.conflicts.includes(a));
});

test('nearby paths with insufficient truck clearance still conflict',()=>{
  const f=junction();
  const rail=y=>({fromLane:{edge:{}},toLane:{edge:{}},path:f.h.Path.line({x:0,y},{x:100,y}),length:100});
  const a=rail(0),b=rail(9);
  f.h.computeConflicts({connectors:[a,b]});
  assert.ok(a.conflicts.includes(b));
});

test('conflicting connectors retain paired path intervals',()=>{
  const f=junction('STREET','YIELD');
  const a=f.node.connectors.find(c=>Math.abs(c.turn)<.1);
  const b=a.conflicts.find(c=>c.fromLane.edge!==a.fromLane.edge);
  const zones=a.conflictZones && a.conflictZones.get(b);
  const reverse=b.conflictZones && b.conflictZones.get(a);
  assert.ok(Array.isArray(zones) && zones.length>0);
  assert.ok(Array.isArray(reverse) && reverse.length>0);
  assert.ok(zones.every(z=>Number.isFinite(z.start) && Number.isFinite(z.end) &&
    Number.isFinite(z.otherStart) && Number.isFinite(z.otherEnd)));
});

test('crossing movements and shared exit lanes remain mutually exclusive',()=>{
  const f=junction('STREET','YIELD');
  const a=f.node.connectors.find(c=>Math.abs(c.turn)<.1);
  const crossing=f.node.connectors.find(c=>Math.abs(c.turn)<.1 && c.fromLane.edge!==a.fromLane.edge && c.toLane!==a.fromLane && c.fromLane!==a.toLane);
  const merging=f.node.connectors.find(c=>c.toLane===a.toLane && c.fromLane!==a.fromLane);
  for (const b of [crossing,merging]) {
    const first=f.car(a), second=f.car(b);
    f.arbitrate();
    assert.equal([first,second].filter(c=>c.claim).length,1);
    first.kill();second.kill();f.a.W.cars=[];
  }
});

test('yield ignores a nearby car whose actual turn does not conflict',()=>{
  const f=junction('AVENUE','YIELD');
  const a=f.node.connectors.find(c=>c.turn>.45);
  const b=f.node.connectors.find(c=>c.turn>.45 && c.fromLane.edge!==a.fromLane.edge && !a.conflicts.includes(c) &&
    a.conflicts.some(o=>o.fromLane===c.fromLane));
  assert.ok(b);
  const first=f.car(a), other=f.car(b,{distance:50,speed:10});
  f.arbitrate();
  assert.ok(first.claim===a);
  assert.equal(other.claim,null,'far car should not reserve early');
});

test('a safe gap is not blocked by priority traffic inside the old lookahead',()=>{
  const f=junction('AVENUE','YIELD');
  const a=f.node.connectors.find(c=>c.turn<-.45);
  const b=a.conflicts.find(c=>c.fromLane.edge!==a.fromLane.edge);
  assert.ok(b);
  f.node.control='PRIORITY';
  f.node.priorityEdges=new Set([b.fromLane.edge.id]);
  const turning=f.car(a,{distance:18,speed:0});
  f.car(b,{distance:77,speed:4});
  f.arbitrate();
  assert.equal(turning.claim,a,'the turn clears before the slow priority car reaches the shared zone');
});

test('yield still waits for an approaching car on a conflicting route',()=>{
  const f=junction('AVENUE','YIELD');
  const a=f.node.connectors.find(c=>Math.abs(c.turn)<.1);
  const b=a.conflicts.find(c=>c.priority>=a.priority && c.fromLane!==a.fromLane);
  const first=f.car(a);f.car(b,{distance:50,speed:15});
  f.arbitrate();assert.ok(first.claim===null);
});

test('queued and distant cars do not reserve early',()=>{
  const f=junction(), conn=f.node.connectors.find(c=>f.node.signal.group.get(c.fromLane.id)===f.node.signal.idx);
  const first=f.car(conn), queued=f.car(conn,{distance:42}), distant=f.car(conn,{distance:110,speed:20});
  f.arbitrate();assert.ok(first.claim===conn);assert.equal(queued.claim,null);assert.equal(distant.claim,null);
});

test('red and amber signals deny new claims',()=>{
  const f=junction(), conn=f.node.connectors.find(c=>f.node.signal.group.get(c.fromLane.id)!==f.node.signal.idx);
  const c=f.car(conn);f.arbitrate();assert.ok(c.claim===null);
  f.node.signal.idx=f.node.signal.group.get(conn.fromLane.id);f.node.signal.amber=true;
  f.arbitrate();assert.ok(c.claim===null);
});

test('blocked exits prevent entry',()=>{
  const f=junction(), conn=f.node.connectors.find(c=>f.node.signal.group.get(c.fromLane.id)===f.node.signal.idx);
  const c=f.car(conn), obstruction=f.car(conn);
  obstruction.track=conn.toLane;obstruction.route=[conn.toLane];obstruction.s=12;
  f.arbitrate();assert.ok(c.claim===null);
});

test('stop signs cannot be reserved early by a fast car',()=>{
  const f=junction('STREET','STOP'), c=f.car(f.node.connectors[0],{distance:60,speed:120});
  f.arbitrate();assert.ok(c.claim===null);
  c.s=c.track.length-18;c.v=0;f.arbitrate();assert.ok(c.claim);
});

for (const [type,kind,count] of [['STREET','CAR',2],['AVENUE','CAR',4],['HIGHWAY','CAR',6],['AVENUE','TRUCK',4]]) {
test(`${count} ${kind}s actually cross ${type} together and release their reservations`,()=>{
  const f=junction(type);
  const cars=f.node.connectors.filter(c=>Math.abs(c.turn)<.1 &&
    f.node.signal.group.get(c.fromLane.id)===f.node.signal.idx).map(c=>f.car(c,{kind,distance:24}));
  const exits=cars.map(c=>c.route[2]);
  let peak=0;
  for(let i=0;i<300;i++) {
    f.arbitrate();
    for(const c of cars) if(!c.dead)c.step(1/60);
    peak=Math.max(peak,cars.filter(c=>c.track.kind==='CONN').length);
    if(cars.every((c,j)=>c.track===exits[j] && !c.claim)) break;
  }
  assert.equal(peak,count);
  assert.ok(cars.every((c,j)=>c.track===exits[j]));
  assert.equal(f.node.occ.size,0);
});
}

test('rerouting inside a junction retains its active reservation',()=>{
  const f=junction(), conn=f.node.connectors[0], c=f.car(conn);
  c.track=conn;c.ri=1;c.s=conn.length/2;c.claim=conn;f.node.occ.set(conn.id,1);
  c.reroute(true);
  assert.ok(c.claim===conn);
  assert.equal(f.node.occ.get(conn.id),1);
});

test('editing roads waits for cars on retired connectors to clear',()=>{
  const f=junction(), conn=f.node.connectors.find(c=>Math.abs(c.turn)<.1), inside=f.car(conn);
  inside.track=conn;inside.ri=1;inside.s=conn.length/2;inside.claim=conn;f.node.occ.set(conn.id,1);
  f.a.NET.rebuildAround([f.node]);
  const next=f.node.connectors.find(c=>Math.abs(c.turn)<.1 &&
    f.node.signal.group.get(c.fromLane.id)===f.node.signal.idx);
  const waiting=f.car(next);f.arbitrate();assert.ok(waiting.claim===null);
  inside.kill();f.arbitrate();assert.ok(waiting.claim===next);
});

test('an unreserved car cannot overshoot into a red intersection',()=>{
  const f=junction(), conn=f.node.connectors.find(c=>f.node.signal.group.get(c.fromLane.id)!==f.node.signal.idx);
  const c=f.car(conn,{distance:12,speed:180});
  f.index();
  for(let i=0;i<10;i++) c.step(1/60);
  assert.ok(c.track===conn.fromLane);
  assert.ok(c.s<=c.track.length-c.len/2-f.a.CFG.STOPLINE);
});

test('a truck keeps its reservation until its rear clears the exit',()=>{
  const f=junction(), conn=f.node.connectors[0], c=f.car(conn,{kind:'TRUCK'});
  c.track=conn;c.ri=1;c.s=conn.length-.1;c.v=20;c.claim=conn;f.node.occ.set(conn.id,1);
  f.index();c.step(1/60);
  assert.ok(c.track===conn.toLane);
  assert.ok(c.claim===conn,'rear is still inside');
  c.reroute(true);assert.ok(c.claim===conn,'rerouting must also preserve rear clearance');
  c.s=c.len/2+.1;c.step(1/60);
  assert.ok(c.claim===null);assert.equal(f.node.occ.size,0);
});

test('retired rear-clear reservations hold new junction traffic after a rebuild',()=>{
  const f=junction(), conn=f.node.connectors[0], c=f.car(conn,{kind:'TRUCK'});
  c.track=conn;c.ri=1;c.s=conn.length-.1;c.v=20;c.claim=conn;f.node.occ.set(conn.id,1);
  f.index();c.step(1/60);
  f.a.NET.rebuildAround([f.node]);
  const next=f.node.connectors.find(c=>f.node.signal.group.get(c.fromLane.id)===f.node.signal.idx);
  const waiting=f.car(next);f.arbitrate();assert.ok(waiting.claim===null);
  c.kill();f.arbitrate();assert.ok(waiting.claim===next);
});

test('roundabout conversion waits for a crossing on the removed junction',()=>{
  const f=junction(), conn=f.node.connectors[0], c=f.car(conn);
  c.track=conn;c.ri=1;c.s=conn.length/2;c.v=10;c.claim=conn;f.node.occ.set(conn.id,1);
  assert.ok(f.a.NET.makeRoundabout(f.node,60));
  const next=f.a.NET.nodes.flatMap(n=>n.connectors)[0], waiting=f.car(next);
  f.arbitrate();assert.ok(waiting.claim===null);
  c.kill();f.arbitrate();assert.ok(waiting.claim===next);
});

test('a stale connector on an otherwise live approach is replanned before entry',()=>{
  const f=junction(), conn=f.node.connectors[0], c=f.car(conn);
  f.h.buildSignal(f.node);
  f.h.computeConflicts(f.node);
  f.node.connectors=f.node.connectors.filter(o=>o!==conn);
  f.arbitrate();
  assert.ok(c.claim===null);assert.equal(c.needsReroute,true);
});

test('an unused reservation on a retired connector is cancelled immediately',()=>{
  const f=junction(), conn=f.node.connectors[0], c=f.car(conn);
  c.claim=conn;f.node.occ.set(conn.id,1);
  f.node.connectors=f.node.connectors.filter(o=>o!==conn);
  f.arbitrate();
  assert.ok(c.claim===null);assert.equal(c.needsReroute,true);
  assert.equal(f.node.occ.size,0);
});

test('arriving just after a junction waits until the rear has cleared',()=>{
  const f=junction(), conn=f.node.connectors[0], c=f.car(conn,{kind:'TRUCK'});
  c.goalS=2;c.dest.s=2;
  c.track=conn;c.ri=1;c.s=conn.length-.1;c.v=20;c.claim=conn;f.node.occ.set(conn.id,1);
  for(let i=0;i<300 && c.phase!=='VISIT';i++) { f.index();c.step(1/60); }
  assert.equal(c.phase,'VISIT');
  assert.ok(c.s>=c.len/2,'arrival must not park a truck with its rear in the intersection');
  assert.equal(f.node.occ.size,0);
});


