const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const loadGame=require('./harness.cjs');
function fixture(type='AVENUE') {
  const f=loadGame({blank:true}),a=f.api;
  vm.runInContext('globalThis.movementHooks={Car,executeChange,considerLaneChange,resyncTrack,updateManoeuvre}',f.context);
  a.W.cars=[];a.NET.nodes=[];a.NET.edges=[];
  const e=a.NET.addEdge(a.NET.addNode(0,0),a.NET.addNode(700,0),type);
  const [source,target]=e.fwd;
  const dest={x:680,y:0,lane:target,s:target.length-30};
  const car=new f.context.movementHooks.Car({x:0,y:0,lane:source,s:0},dest);
  car.setRoute([source],target,dest.s);car.s=100;car.v=60;car.v0=80;car.changeCd=0;
  source.vehicles=[car];a.W.cars=[car];car.pose();
  return {...f,a,h:f.context.movementHooks,car,source,target,e};
}
test('ownership remains in source and both lanes see the moving vehicle until completion',()=>{
  const {car,source,target,h}=fixture();
  h.executeChange(car,target);
  assert.ok(car.track===source);
  assert.ok(car.manoeuvre);
  assert.ok(source.vehicles.includes(car));
  assert.ok(target.vehicles.some(v=>v.owner===car));
  for(let i=0;i<100 && car.manoeuvre;i++) {car.step(1/60);car.pose();}
  assert.ok(car.track===target);assert.ok(car.manoeuvre===null);
  assert.ok(!source.vehicles.includes(car));assert.ok(target.vehicles.includes(car));
});
test('a stopped car cannot slide laterally while waiting',()=>{
  const {car,target,h}=fixture();h.executeChange(car,target);
  car.v=0;car.v0=0;
  car.track.vehicles.push({s:car.s+car.len+1,len:car.len,v:0});
  car.pose();const y=car.py;
  for(let i=0;i<30;i++){car.step(1/60);car.pose();}
  assert.equal(car.py,y);assert.ok(car.manoeuvre);
});
test('heading follows the smooth moving trajectory and settles on lane tangent',()=>{
  const {car,target,h}=fixture();h.executeChange(car,target);
  const start=car.s;car.step(1/60);car.pose();
  assert.ok(Math.abs(car.ang)<.03,'zero lateral tangent at start');
  while(car.manoeuvre && car.manoeuvre.progress<.45){car.step(1/60);car.pose();}
  const p={x:car.px,y:car.py};car.step(1/600);car.pose();
  const tangent=Math.atan2(car.py-p.y,car.px-p.x);
  assert.ok(Math.abs(car.ang-tangent)<.03);
  assert.ok(car.s>start);
});
test('a late mandatory instruction never starts a manoeuvre at the stop line',()=>{
  const {car,source,target,h,a}=fixture();
  car.s=source.length-car.len/2-a.CFG.STOPLINE;car.v=10;
  h.executeChange(car,target);
  assert.ok(car.manoeuvre===null);assert.ok(car.track===source);
});
test('destination followers see the merge as their leader before ownership transfers',()=>{
  const {car,source,target,h}=fixture();h.executeChange(car,target);
  const follower=new h.Car({x:0,y:0},car.dest);follower.setRoute([target],target,car.goalS);
  follower.s=car.s-40;follower.v=65;target.vehicles.sort((a,b)=>a.s-b.s);
  assert.ok(follower.findLeader());assert.ok(car.track===source);
});
test('a returning car joins lane occupancy immediately before later same-tick lane changes',()=>{
  const {car,source,target,h,a}=fixture();
  car.s=100;car.v=0;
  // A VISIT car is absent from the arrays rebuilt at the start of simStep.
  const returning=new h.Car({x:0,y:0,lane:source,s:240},{x:0,y:0,lane:target,s:90});
  returning.setRoute([target],source,240);returning.s=90;returning.phase='VISIT';
  target.vehicles=[];returning.track=null;
  a.W.cars.push(returning);

  returning.depart();
  assert.equal(returning.phase,'BACK');
  assert.ok(target.vehicles.includes(returning),
    'departing traffic must be visible before another vehicle tests the same lane');
  assert.equal(h.executeChange(car,target),false,
    'the lane change must reject a follower whose full longitudinal footprint overlaps');
  assert.equal(car.mergeFailure,'rear-gap');
  assert.equal(car.gapConstraints.rear,-5);
  assert.equal(car.gapConstraints.targetLane,target.id);
  assert.ok(car.manoeuvre===null);
});
test('a vehicle entering a lane from a connector updates same-frame occupancy',()=>{
  const {a,e,h}=fixture();
  const nextEdge=a.NET.addEdge(e.n2,a.NET.addNode(980,0),'AVENUE');
  const target=e.fwd[1];
  const conn=e.n2.connectors.find(c=>c.fromLane===target&&c.toLane.edge===nextEdge);
  assert.ok(conn);
  const entrant=new h.Car({x:0,y:0},{x:980,y:0,lane:conn.toLane,s:200});
  entrant.track=conn;entrant.route=[conn,conn.toLane];entrant.ri=0;
  entrant.phase='BACK';entrant.s=conn.length-.05;entrant.v=12;
  conn.vehicles=[entrant];conn.toLane.vehicles=[];
  entrant.step(.1);
  assert.ok(entrant.track===conn.toLane);
  assert.ok(conn.toLane.vehicles.includes(entrant),
    'connector arrivals must be visible before later same-frame lane decisions');
});
test('a completed lane change commits direction until the route approach window',()=>{
  const {car,source,target,h}=fixture();
  const next={kind:'CONN',fromLane:source,length:40,node:{}};
  car.setRoute([source,next],source,source.length-30);
  car.s=100;car.v=0;car.track.vehicles=[car];
  assert.equal(h.executeChange(car,target),true);
  car.s=car.manoeuvre.startS+car.manoeuvre.distance;h.updateManoeuvre(car);
  assert.ok(car.track===target);
  h.considerLaneChange(car,1/60);
  assert.equal(!!car.manoeuvre,false,
    'a mandatory reverse should wait until the turn-sorting window instead of ping-ponging');
  assert.equal(car.mergeFailure,'route-commitment');
});
test('an edited destination lane invalidates the manoeuvre without orphan occupancy',()=>{
  const {car,target,h,e}=fixture();h.executeChange(car,target);
  e.fwd=e.fwd.filter(l=>l!==target);h.resyncTrack(car);
  assert.ok(car.manoeuvre===null);assert.ok(car.needsReroute);
  assert.ok(!target.vehicles.some(v=>v.owner===car));
});


test('simulation exposes bounded diagnostics and a complete safety scan when enabled',()=>{
  const {api:a}=loadGame();
  assert.ok(a.trafficDiagnostics);
  const before=a.trafficDiagnostics.summary().performance.samples;
  a.W.safetyChecks=true;
  for(let i=0;i<5;i++)a.simStep(1/60);
  const summary=a.trafficDiagnostics.summary();
  assert.equal(summary.performance.samples,before+5);
  assert.ok(a.W.lastSafetyScan);
  assert.equal(a.W.lastSafetyScan.stats.truncated,false);
});

test('a manoeuvre near a red light settles before the IDM stopping gap',()=>{
  const {car,target,source,h,a}=fixture();
  const conn=source.to.connectors.find(c=>c.fromLane===target);
  // A synthetic legal continuation supplies a stop line without needing a populated city.
  const next=conn || {kind:'CONN',length:30,firstVehicle:()=>null,fromLane:target,speedLimit:60,node:{occ:new Map(),connectors:[]}};
  car.route=[source,next,target];car.ri=0;car.s=source.length-80;car.v=70;
  h.executeChange(car,target);assert.ok(car.manoeuvre);
  for(let i=0;i<600 && car.manoeuvre;i++)car.step(1/60);
  assert.ok(car.manoeuvre===null,'the merge must finish before the stop-line IDM equilibrium');
  assert.ok(car.track===target);
});



test('a near destination cannot strand a car partway through its final lane change',()=>{
  const {car,target,h}=fixture();car.s=100;car.goalS=120;car.v=10;
  h.executeChange(car,target);
  for(let i=0;i<500;i++){car.step(1/60);car.pose();if(car.phase==='ENTER')break;}
  assert.ok(car.manoeuvre===null);assert.equal(car.phase,'ENTER');
});
test('a fast car refuses a short merge whose duration and lateral budget cannot be met',()=>{
  const {car,source,target,h}=fixture();car.s=source.length-35;car.v=car.v0=130;
  h.executeChange(car,target);
  assert.ok(car.manoeuvre===null);
});

test('final-lane planning budgets distance to the kerb rather than the road end',()=>{
  const {car,target,h}=fixture();car.s=100;car.goalS=120;car.v=60;
  h.executeChange(car,target);
  assert.ok(car.manoeuvre===null || car.manoeuvre.distance<=18);
});

test('replanning the same route does not count a route change',()=>{
  const {car}=fixture();car.reroute();assert.equal(car.routeChanges,0);
});

test('traffic analysis counts active queues and groups their current causes',()=>{
  const {api:a}=loadGame();
  a.W.cars=[{track:{kind:'LANE'},v:0,waitReason:'signal'},
    {track:{kind:'LANE'},v:0,waitReason:'merge-gap'},
    {track:{kind:'LANE'},v:40}, {track:null,v:0,phase:'VISIT'}];
  const analysis=a.trafficAnalysis();
  assert.equal(analysis.queued,2);
  assert.equal(analysis.waitReasons.signal,1);assert.equal(analysis.waitReasons['merge-gap'],1);
});

test('signal drawing recognizes movement phases beyond the old approach groups',()=>{
  const {api:a,context}=loadGame();
  const node=a.NET.nodes.find(n=>n.signal?.movementGroup && n.signal.phases>2);
  assert.ok(node);
  const movement=node.connectors.find(c=>node.signal.movementGroup.get(c.id)>1);
  node.signal.idx=node.signal.movementGroup.get(movement.id);
  vm.runInContext('globalThis.signalDisplay=signalApproachActive',context);
  assert.equal(context.signalDisplay(node,movement.fromLane),true);
});

test('junction grants feed reservation lead-time diagnostics',()=>{
  const {api:a}=loadGame();
  assert.ok(a.trafficDiagnostics.summary().reservationLead.count>0);
});

test('new traffic starts with its physical pose on the lane rather than sweeping out of a building',()=>{
  const {api:a}=loadGame(),before=new Set(a.W.cars.map(c=>c.id));
  for(const b of a.CITY.buildings)b.outTimer=-1;
  a.CITY.spawn(.1,8);
  const spawned=a.W.cars.filter(c=>!before.has(c.id));assert.ok(spawned.length>0);
  for(const c of spawned) {
    const p=c.track.pos(c.s);
    assert.ok(Math.hypot(c.px-p.x,c.py-p.y)<1e-7);
    assert.equal(c.ppx,c.px);assert.equal(c.ppy,c.py);
  }
});

test('movement signal displays distinguish a red turn from a green turn on the same approach',()=>{
  const {api:a,context}=loadGame();
  const node=a.NET.nodes.find(n=>n.signal && n.connectors.some(c=>n.connectors.some(o=>o.fromLane===c.fromLane && n.signal.movementGroup.get(o.id)!==n.signal.movementGroup.get(c.id))));
  assert.ok(node);
  const first=node.connectors.find(c=>node.connectors.some(o=>o.fromLane===c.fromLane && node.signal.movementGroup.get(o.id)!==node.signal.movementGroup.get(c.id)));
  const other=node.connectors.find(c=>c.fromLane===first.fromLane && node.signal.movementGroup.get(c.id)!==node.signal.movementGroup.get(first.id));
  node.signal.idx=node.signal.movementGroup.get(first.id);node.signal.amber=false;
  vm.runInContext('globalThis.signalAspect=signalMovementAspect',context);
  assert.equal(context.signalAspect(node,first),'green');assert.equal(context.signalAspect(node,other),'red');
  node.signal.amber=true;assert.equal(context.signalAspect(node,first),'amber');
});
test('a crossing vehicle respects a held conflict-region center boundary without overshooting',()=>{
  const {car,source}=fixture();
  // A straight connector with the same geometry isolates the per-region stop controller.
  source.kind='CONN';car.route=[source];car.goalLane=null;
  car.s=100;car.v=80;car.junctionStopS=108;
  for(let i=0;i<30;i++)car.step(1/60);
  assert.ok(car.s<=108);assert.equal(car.v,0);
});
