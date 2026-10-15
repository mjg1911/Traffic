const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const loadGame=require('./harness.cjs');
function fixture(type='STREET',bend=0) {
  const f=loadGame({blank:true}),a=f.api;
  a.W.cars=[];a.NET.nodes=[];a.NET.edges=[];
  const node=a.NET.addNode(600,600);
  for(const [x,y] of [[600,100],[1100,600],[600,1100],[100,600]]) a.NET.addEdge(a.NET.addNode(x,y),node,type,bend);
  vm.runInContext('globalThis.pocketHooks={Car,considerLaneChange,routeBetween,executeChange,arbitrate}',f.context);
  return {...f,a,node,h:f.context.pocketHooks};
}
test('intersection pockets add real turn-only lanes and retain through lanes',()=>{
  const {a,node}=fixture();
  assert.equal(typeof a.addPreSorting,'function');
  a.addPreSorting(node,2);
  assert.equal(node.lanesIn.length,12);
  assert.equal(node.lanesOut.length,4);
  for(const lane of node.lanesIn) {
    const cs=node.connectors.filter(c=>c.fromLane===lane);
    assert.ok(cs.length);
    assert.ok(cs.every(c=>lane.pocket==='left'?c.turn<-.45:lane.pocket==='right'?c.turn>.45:Math.abs(c.turn)<=.45));
  }
});
test('cars cannot enter a turning pocket upstream of its mouth',()=>{
  const {a,node,h}=fixture();
  assert.equal(typeof a.addPreSorting,'function');a.addPreSorting(node,2);
  const pocket=node.lanesIn.find(l=>l.pocket==='left'),lane=pocket.siblings[0];
  const conn=node.connectors.find(c=>c.fromLane===pocket);
  const dest={x:0,y:0,lane:conn.toLane,s:100};
  const c=new h.Car({x:0,y:0,lane,s:0},dest);
  c.setRoute([lane,conn,conn.toLane],dest.lane,dest.s);c.s=10;c.v=20;c.changeCd=0;
  h.considerLaneChange(c,1/60);assert.ok(c.track===lane);
  c.s=pocket.startS+30;c.changeCd=0;
  h.considerLaneChange(c,1/60);assert.ok(c.manoeuvre?.target===pocket);
  assert.ok(Math.abs(c.lat)<=a.CFG.LANE_W*1.1);
});
test('pocket lengths resize independently, clamp to the approach and survive saves',()=>{
  const {a,node}=fixture();
  assert.equal(typeof a.addPreSorting,'function');a.addPreSorting(node,2);
  const edge=node.edges[0],before=node.preSorting[edge.id].right;
  a.resizePreSorting(node,edge,'left',1e6);
  assert.equal(node.preSorting[edge.id].right,before);
  assert.ok(node.preSorting[edge.id].left<edge.centre.length-node.r);
  const saved=a.captureCity();a.restoreCity(saved);
  const restored=a.NET.nodes.find(n=>n.id===node.id);
  assert.equal(restored.preSorting[edge.id].left,node.preSorting[edge.id].left);
  assert.ok(restored.lanesIn.some(l=>l.pocket));
  a.removePreSorting(restored);assert.equal(restored.lanesIn.filter(l=>l.pocket).length,0);
});
test('splitting a pocket approach preserves the junction settings on its replacement arm',()=>{
  const {a,node}=fixture();a.addPreSorting(node,2);
  const edge=node.edges[0],length=node.preSorting[edge.id].left;
  a.NET.splitEdge(edge,200);
  const replacement=node.edges.find(e=>e.other(node).degree===2);
  assert.equal(node.preSorting[replacement.id]?.left,length);
  assert.ok(node.lanesIn.some(l=>l.edge===replacement&&l.pocket==='left'));
});
test('reversing a one-way arm removes pockets that no longer enter the junction',()=>{
  const {a,node}=fixture('ONEWAY_SINGLE');a.addPreSorting(node,2);
  // Initially all arms enter, so create exits first.
  a.NET.reverseOneWay(node.edges[1]);a.NET.reverseOneWay(node.edges[2]);
  a.addPreSorting(node,2);
  const edge=node.edges[0];assert.ok(node.preSorting[edge.id]);
  a.NET.reverseOneWay(edge);
  assert.equal(node.preSorting[edge.id],undefined);
  assert.doesNotThrow(()=>a.restoreCity(a.captureCity()));
});
test('pointer resize previews and cancellation preserve authored lengths',()=>{
  const {a,node,events}=fixture();
  a.CAM.x=a.CAM.tx=600;a.CAM.y=a.CAM.ty=400;a.CAM.z=a.CAM.tz=1;
  a.setTool('PRE_SORTING');
  const event=p=>({button:0,clientX:p.x,clientY:p.y,pointerId:1,shiftKey:false});
  events['cv:pointerdown'](event(node.pos));
  a.addPreSorting(node); // Selecting a crossing does not author pockets until an arm is clicked.
  const handle=a.preSortingHandles(node)[0],original=node.preSorting[handle.edge.id][handle.side];
  events['cv:pointerdown'](event(handle.pos));
  const p=handle.lane.pos(handle.lane.length-240);
  events['cv:pointermove'](event(p));
  assert.equal(node.preSorting[handle.edge.id][handle.side],original,'preview must not repeatedly rebuild active traffic');
  events['cv:pointercancel']({});
  assert.equal(node.preSorting[handle.edge.id][handle.side],original);
  events['cv:pointerdown'](event(handle.pos));events['cv:pointermove'](event(p));events['cv:pointerup'](event(p));
  assert.ok(Math.abs(node.preSorting[handle.edge.id][handle.side]-240)<1);
});
test('curved pocket lanes support drawing and safe occupied-gap checks',()=>{
  const {a,node,h}=fixture('AVENUE',35);a.addPreSorting(node,2);
  assert.doesNotThrow(()=>a.render(1));
  const pocket=node.lanesIn.find(l=>l.pocket==='right'),lane=pocket.siblings[0];
  const conn=node.connectors.find(c=>c.fromLane===pocket),dest={x:0,y:0,lane:conn.toLane,s:100};
  const car=new h.Car({x:0,y:0,lane,s:0},dest);
  car.setRoute([lane,conn,conn.toLane],dest.lane,100);car.s=lane.length-65;car.changeCd=0;
  const block=new h.Car({x:0,y:0,lane:pocket,s:0},dest);
  block.setRoute([pocket,conn,conn.toLane],dest.lane,100);block.s=car.s*pocket.length/lane.length;
  pocket.vehicles.push(block);h.considerLaneChange(car,1/60);assert.ok(car.track===lane);
});
test('invalid pocket records are rejected without replacing the live city',()=>{
  const {a,node}=fixture();a.addPreSorting(node,2);
  for(const value of [NaN,-1,10000,'140']) {
    const save=a.captureCity();save.nodes.find(n=>n.id===node.id).preSorting[node.edges[0].id].left=value;
    assert.throws(()=>a.restoreCity(save),/Invalid city save/);
    assert.ok(a.NET.nodes.includes(node));
  }
});
test('a routed car enters a short pocket and completes its intended turn',()=>{
  const {a,node,h}=fixture('AVENUE');a.addPreSorting(node,2);
  const pocket=node.lanesIn.find(l=>l.pocket==='left'),lane=pocket.siblings[0];
  const conn=node.connectors.find(c=>c.fromLane===pocket),dest={x:0,y:0,lane:conn.toLane,s:200};
  const car=new h.Car({x:0,y:0,lane,s:0},dest);
  const route=h.routeBetween(lane,0,dest.lane,dest.s);
  assert.ok(route?.some(t=>t.kind==='CONN' && t.fromLane===pocket));
  car.setRoute(route,dest.lane,dest.s);car.v0=80;
  let entered=false,turned=false;
  for(let i=0;i<1200;i++) {
    for(const e of a.NET.edges) for(const l of e.lanes) l.vehicles=[];
    for(const n of a.NET.nodes) for(const c of n.connectors) c.vehicles=[];
    car.track.vehicles.push(car);
    h.arbitrate([car]);h.considerLaneChange(car,1/60);car.step(1/60);
    if(car.track===pocket) { entered=true;assert.ok(car.s>=pocket.startS); }
    if(car.track===conn) turned=true;
    if(car.phase==='VISIT' || car.phase==='ENTER') break;
  }
  assert.ok(entered);assert.ok(turned);assert.ok(car.phase==='ENTER' || car.phase==='VISIT');
});
test('buildings cannot occupy the extra pavement of a turning pocket',()=>{
  const {a,node}=fixture();a.addPreSorting(node,2);
  const lane=node.lanesIn.find(l=>l.pocket==='right'),p=lane.pos(lane.length-45);
  assert.equal(a.CITY.overlapsRoad({x:p.x,y:p.y,size:4,seed:.5,type:'R',angle:0}),true);
});
test('turning pockets meet adjacent through lanes at one lane width at their entry',()=>{
  const {a,node}=fixture();a.addPreSorting(node,2);
  for(const pocket of node.lanesIn.filter(l=>l.pocket)) {
    const group=pocket.siblings,normal=pocket.pocket==='right'?group[0]:group[group[0].edge.spec.lanes-1];
    const s=pocket.startS;
    const p=pocket.pos(s),q=normal.pos(s*normal.length/pocket.length);
    assert.ok(Math.abs(Math.hypot(p.x-q.x,p.y-q.y)-a.CFG.LANE_W)<.5,'pocket must attach beside through lane at its mouth');
  }
});
test('an intersection too cramped for pockets retains its original road geometry',()=>{
  const {a,node}=fixture();
  for(const edge of node.edges) {
    const other=edge.other(node),dx=other.x-node.x,dy=other.y-node.y,d=Math.hypot(dx,dy);
    other.x=node.x+dx/d*125;other.y=node.y+dy/d*125;
  }
  a.NET.rebuildAll();const radius=node.r;
  assert.equal(a.addPreSorting(node,2),false);
  assert.equal(node.r,radius);
});
test('curved lane centres stay on the continuous widened road surface',()=>{
  const {a,node}=fixture('AVENUE',65);a.addPreSorting(node,2);
  function inside(p,polygon) {
    let result=false;
    for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
      const u=polygon[i],v=polygon[j];
      if((u.y>p.y)!==(v.y>p.y) && p.x<(v.x-u.x)*(p.y-u.y)/(v.y-u.y)+u.x)result=!result;
    }
    return result;
  }
  for(const lane of node.lanesIn) for(let i=0;i<=20;i++) {
    const start=lane.startS||0,s=start+(lane.length-start)*i/20;
    assert.ok(inside(lane.pos(s),lane.edge.pocketSurface),'every drivable lane must have pavement beneath it');
  }
});
test('the default adds one left-turn pocket and retains right turns on the ordinary lane',()=>{
  const {a,node}=fixture();
  assert.equal(a.W.preSortingCount,1);
  a.addPreSorting(node);
  assert.equal(node.lanesIn.filter(l=>l.pocket).length,4);
  assert.ok(node.lanesIn.filter(l=>l.pocket).every(l=>l.pocket==='left'));
  for(const lane of node.lanesIn.filter(l=>!l.pocket)) {
    assert.ok(node.connectors.some(c=>c.fromLane===lane && c.turn>.45));
    assert.ok(node.connectors.some(c=>c.fromLane===lane && Math.abs(c.turn)<=.45));
  }
});
test('box choice affects new placements without changing existing arms',()=>{
  const {a,node,el}=fixture();a.addPreSorting(node);a.W.preSortingNode=node;a.setTool('PRE_SORTING');a.W.preSortingNode=node;
  const edge=node.edges[0];a.resizePreSorting(node,edge,'left',220);
  el('btn-presort-two').onclick();
  assert.equal(a.W.preSortingCount,2);
  assert.equal(node.lanesIn.filter(l=>l.pocket).length,4);
  assert.equal(node.preSorting[edge.id].left,220);
  assert.equal(node.preSorting[edge.id].right,undefined);
  el('btn-presort-one').onclick();
  assert.equal(a.W.preSortingCount,1);
  assert.equal(node.lanesIn.filter(l=>l.pocket).length,4);
  assert.equal(node.preSorting[edge.id].left,220);
  assert.equal(node.preSorting[edge.id].right,undefined);
});
test('one-box placement falls back to a right pocket where only a right turn exists',()=>{
  const {a,node}=fixture('ONEWAY_SINGLE');
  // Keep a single departing arm and an approach that can only turn right into it.
  a.NET.reverseOneWay(node.edges[1]);
  const incoming=node.lanesIn.find(l=>node.connectors.some(c=>c.fromLane===l && c.turn>.45));
  a.addPreSorting(node);
  const record=node.preSorting[incoming.edge.id];
  assert.ok(record?.right);
  assert.equal(record.left,undefined);
});

test('minimum pockets warn when free-flow speed cannot finish the merge',()=>{
  const {a,node,context}=fixture();a.addPreSorting(node,2);
  const lane=node.lanesIn.find(l=>l.pocket==='left');
  vm.runInContext('globalThis.pocketWarning=pocketUsability',context);
  const short=context.pocketWarning(lane,45);
  assert.ok(short.requiresSlowing);
  assert.ok(short.mergeSpeed<lane.speedLimit);
  assert.equal(a.CFG.WORLD_UNITS_PER_METRE,3);
});
