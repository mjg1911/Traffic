const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const loadGame=require('./harness.cjs');

function blockedCorner(kind='CAR',type='AVENUE',right=false,atGoal=false) {
  const f=loadGame({blank:true}),a=f.api;
  vm.runInContext('globalThis.queueHooks={Car,considerLaneChange,routeLaneChangeFeasible}',f.context);
  const h=f.context.queueHooks;
  const start=a.NET.addNode(0,0),corner=a.NET.addNode(700,0);
  const approach=a.NET.addEdge(start,corner,type);
  a.NET.addEdge(corner,a.NET.addNode(700,right?700:-700),type);
  const source=right?approach.fwd.at(-1):approach.fwd[0];
  const target=right?approach.fwd[0]:approach.fwd.at(-1);
  const turn=corner.connectors.find(c=>c.fromLane===target);
  assert.ok(turn);
  const dest=atGoal?{x:600,y:0,lane:target,s:target.length-50}
    :{x:700,y:right?600:-600,lane:turn.toLane,s:turn.toLane.length-50};
  const car=new h.Car({x:0,y:0,lane:source,s:0},dest,kind);
  car.setRoute(atGoal?[source]:[source,turn,turn.toLane],dest.lane,dest.s);
  car.s=source.length-150;car.v=0;car.v0=80;car.changeCd=0;
  // A queue fills the destination lane right up to its stop line.
  for(const lane of approach.fwd.filter(l=>l!==source)) {
    for(let s=lane.length-16;s>car.s-50;s-=21)
      lane.vehicles.push({s,len:15,v:0,v0:80});
    lane.vehicles.sort((x,y)=>x.s-y.s);
  }
  function step(count) {
    for(let i=0;i<count && car.phase!=='ENTER' && !car.dead;i++) {
      a.W.time+=1/60;h.considerLaneChange(car,1/60);car.step(1/60);
    }
  }
  function clearQueue() {
    for(const lane of approach.fwd.filter(l=>l!==source))lane.vehicles=[];
  }
  return {a,h,car,source,target,step,clearQueue};
}

for(const kind of ['CAR','TRUCK'])test(`a ${kind.toLowerCase()} waiting for a merge keeps room to finish when the queue clears`,()=>{
  const {h,car,source,target,step,clearQueue}=blockedCorner(kind);
  step(1200);
  assert.ok(h.routeLaneChangeFeasible(source,target,car.s,undefined,car.len),
    `waiting must preserve a reachable merge, but only ${car.toEnd} units remain`);
  clearQueue();
  step(600);
  assert.ok(car.track===target,'the car should finish merging after the gap opens');
  assert.equal(car.manoeuvre,null);
  assert.equal(car.dead,false);
});

for(const right of [false,true])test(`a queued two-lane merge to the ${right?'right':'left'} preserves room for both changes`,()=>{
  const {h,car,source,target,step,clearQueue}=blockedCorner('TRUCK','HIGHWAY',right);
  step(1200);
  assert.ok(h.routeLaneChangeFeasible(source,target,car.s,undefined,car.len));
  clearQueue();step(900);
  assert.ok(car.track===target);
  assert.equal(car.manoeuvre,null);
  assert.equal(car.missedTurns,0);
});

test('waiting for the destination lane preserves merge room before the kerb',()=>{
  const {h,car,source,target,step,clearQueue}=blockedCorner('CAR','AVENUE',false,true);
  step(1200);
  assert.ok(h.routeLaneChangeFeasible(source,target,car.s,car.goalS,car.len));
  clearQueue();step(900);
  assert.equal(car.phase,'ENTER');
  assert.equal(car.dead,false);
  assert.equal(car.manoeuvre,null);
});

test('the waiting boundary still permits entry into a 45-unit turn pocket',()=>{
  const {api:a,context}=loadGame({blank:true});
  vm.runInContext('globalThis.pocketCar=Car',context);
  const node=a.NET.addNode(600,600);
  for(const [x,y] of [[600,100],[1100,600],[600,1100],[100,600]])
    a.NET.addEdge(a.NET.addNode(x,y),node,'AVENUE');
  a.addPreSorting(node,2);
  const initial=node.lanesIn.find(l=>l.pocket==='left');
  a.resizePreSorting(node,initial.edge,'left',45);
  const pocket=node.lanesIn.find(l=>l.edge===initial.edge && l.pocket==='left');
  const source=pocket.siblings.find(l=>l.order===pocket.order-1);
  const turn=node.connectors.find(c=>c.fromLane===pocket);
  const dest={...turn.toLane.pos(100),lane:turn.toLane,s:100};
  const car=new context.pocketCar({...source.pos(0),lane:source,s:0},dest);
  car.setRoute([source,turn,turn.toLane],dest.lane,dest.s);
  a.W.cars=[car];a.CITY.spawn=()=>{};a.CITY.develop=()=>{};
  let entered=false;
  for(let i=0;i<3600 && !entered;i++) {
    a.simStep(1/60);entered=car.track===pocket;
  }
  assert.ok(entered,`pocket entry must remain reachable: ${car.mergeFailure} at ${car.s}`);
});
