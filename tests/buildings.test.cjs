const {test}=require('node:test');
const assert=require('node:assert/strict');
const loadGame=require('./harness.cjs');
const vm=require('node:vm');

function fixture(type='STREET',bend=0) {
  const h=loadGame({blank:true}),a=h.api;
  a.W.river={centre:[{x:4500,y:0},{x:4500,y:3200}],poly:[{x:4400,y:0},{x:4600,y:0},{x:4600,y:3200},{x:4400,y:3200}]};
  a.W.roadType=type;
  assert.equal(a.buildRoad({x:200,y:500},{x:1600,y:500},bend).ok,true);
  return {...h,a,edge:a.NET.edges[0]};
}
function place(a,x,type='R',size='S',y=550) {
  const preview=a.CITY.previewBuilding({x,y},type,size);
  assert.equal(preview.ok,true,preview.msg);
  const result=a.CITY.placeBuilding(preview);
  assert.equal(result.ok,true,result.msg);
  return result.building;
}

test('place fixed lots including parking; overlapping lot is rejected',()=>{
  const {a}=fixture();
  assert.equal(typeof a.CITY.previewBuilding,'function');
  const b=place(a,500);
  assert.equal(b.width,60);assert.equal(b.depth,45);assert.equal(b.parking,1);
  assert.equal(b.people,9);assert.ok(b.lane);assert.equal(b.lane.idx,0);
  assert.equal(a.CITY.previewBuilding({x:500,y:550},'C','S').ok,false);
  assert.equal(a.CITY.buildingAt({x:b.x+28,y:b.y-20}),b);
  assert.equal(a.CITY.buildingAt({x:b.x+34,y:b.y}),null);
});
test('sizes affect capacity and footprints stay fixed during poor service',()=>{
  const {a}=fixture();const b=place(a,500,'I','L');
  assert.equal(b.jobs,104);assert.equal(b.parking,16);
  const geometry=[b.x,b.y,b.width,b.depth,b.angle];
  b.service=0;b.starve=500;a.CITY.tickBuildings(60);
  assert.ok(a.CITY.buildings.includes(b));
  assert.deepEqual([b.x,b.y,b.width,b.depth,b.angle],geometry);
  const n=a.CITY.buildings.length;
  for(let i=0;i<60;i++)a.simStep(1/60);
  assert.equal(a.CITY.buildings.length,n);
});
test('both one-way kerbs connect to adjacent lanes and reversal preserves lots',()=>{
  const {a,edge}=fixture('ONEWAY');
  const right=place(a,500,'R','S',560),left=place(a,700,'C','M',440);
  assert.equal(right.lane.idx,0);assert.equal(left.lane.idx,1);
  assert.equal(right.forward,true);assert.equal(left.forward,true);
  const original=[left.x,left.y,left.angle];
  a.NET.reverseOneWay(edge);a.simStep(1/60);
  assert.deepEqual([left.x,left.y,left.angle],original);assert.ok(left.lane);
});
test('road split reconnects driveway without moving the lot; road deletion disconnects it',()=>{
  const {a}=fixture();const b=place(a,500),original=[b.x,b.y,b.angle];
  assert.equal(a.buildRoad({x:1100,y:500},{x:1100,y:800}).ok,true);
  a.simStep(1/60);assert.ok(b.lane);assert.deepEqual([b.x,b.y,b.angle],original);
  a.NET.removeEdge(b.edge);a.simStep(1/60);assert.equal(b.lane,null);
  assert.ok(a.CITY.buildings.includes(b));assert.deepEqual([b.x,b.y,b.angle],original);
});
test('curved roads align lots to the tangent and retain full road clearance',()=>{
  const {a,edge}=fixture('STREET',160);
  const s=edge.centre.length*.45,p=edge.centre.pos(s),d=edge.centre.dir(s);
  const b=place(a,p.x-d.y*70,'C','M',p.y+d.x*70);
  assert.ok(Math.abs(b.angle-Math.atan2(d.y,d.x))<.06);
  assert.equal(a.CITY.overlapsRoad(b),false);
});
test('road edits cannot consume parking or demolish fixed buildings',()=>{
  const {a,edge}=fixture();const b=place(a,700),cars=a.W.cars,roads=a.NET.edges.slice();
  const result=a.buildRoad({x:700,y:700},{x:700,y:520});
  assert.equal(result.ok,false);assert.match(result.msg,/building|lot/i);
  assert.equal(a.W.cars,cars);assert.deepEqual(a.NET.edges,roads);assert.ok(a.CITY.buildings.includes(b));
  assert.equal(a.NET.setType(edge,'HIGHWAY'),false);assert.equal(edge.type,'STREET');
  assert.equal(a.reshapeRoad(edge,40).ok,false);assert.equal(edge.bend,0);
});
test('row previews use road distance, reject occupied positions, and commit once',()=>{
  const {a,edge}=fixture();
  const first=a.CITY.previewBuilding({x:500,y:550},'R','S');
  const row=a.CITY.previewRow(first,{x:760,y:550});
  assert.ok(row.length>=4);assert.ok(row.every(p=>p.edge===edge&&p.side===first.side));
  const placed=row.map(p=>a.CITY.placeBuilding(p)).filter(r=>r.ok);
  assert.equal(placed.length,row.length);
  assert.equal(a.CITY.placeBuilding(row[0]).ok,false);
});
test('version 5 save restores exact lot geometry and entrance',()=>{
  const {a}=fixture();const b=place(a,700,'C','M');const data=a.captureCity();
  assert.equal(data.version,5);
  const expected=[b.x,b.y,b.width,b.depth,b.angle,b.entrance.x,b.entrance.y,b.jobs];
  a.restoreCity(JSON.parse(JSON.stringify(data)));
  const r=a.CITY.buildings[0];
  assert.deepEqual([r.x,r.y,r.width,r.depth,r.angle,r.entrance.x,r.entrance.y,r.jobs],expected);
  assert.ok(r.lane);
  const bad=JSON.parse(JSON.stringify(data));bad.buildings[0].width=999;
  const live=a.CITY.buildings;assert.throws(()=>a.restoreCity(bad));assert.equal(a.CITY.buildings,live);
});

test('pointer placement previews until release; Escape and tool changes cancel',()=>{
  const {a,events}=fixture();a.CAM.x=a.CAM.tx=900;a.CAM.y=a.CAM.ty=500;a.CAM.z=a.CAM.tz=1;
  const pointer=(name,x,y=550)=>events['cv:'+name]({clientX:x-300,clientY:y-100,button:0,pointerId:1,preventDefault(){}});
  a.setTool('BUILDING');pointer('pointerdown',500);pointer('pointermove',760);
  assert.equal(a.CITY.buildings.length,0);
  pointer('pointerup',760);assert.equal(a.CITY.buildings.length,5);
  pointer('pointerdown',1000);a.cancelDrawing();pointer('pointerup',1000);
  assert.equal(a.CITY.buildings.length,5);
  pointer('pointerdown',1000);a.setTool('ROAD');pointer('pointerup',1000);
  assert.equal(a.CITY.buildings.length,5);
});
test('residential and industrial lots create routable traffic with size-scaled demand',()=>{
  const {a}=fixture();
  const small=place(a,400),large=place(a,650,'R','L'),shop=place(a,1100,'C','M');
  small.outTimer=large.outTimer=100;
  a.CITY.spawn(1,8);
  assert.ok(large.outTimer<small.outTimer);
  small.outTimer=0;large.outTimer=0;a.CITY.spawn(.01,8);
  assert.ok(a.W.cars.some(c=>c.origin===small&&c.dest===shop));
  assert.ok(a.W.cars.some(c=>c.origin===large&&c.dest===shop));
});
test('arrival animation supports existing traffic fixtures without an explicit driveway',()=>{
  const h=fixture();vm.runInContext('globalThis.BuildingCar=Car',h.context);
  const lane=h.edge.fwd[0],dest={x:700,y:500,lane,s:400};
  const c=new h.context.BuildingCar({x:300,y:500,lane,s:100},dest);
  c.phase='ENTER';c.enterT=.4;c.enterFromX=650;c.enterFromY=500;
  assert.doesNotThrow(()=>c.step(.1));assert.equal(c.py,500);
});
test('turning lanes cannot expand through a fixed lot',()=>{
  const {a,edge}=fixture();
  assert.equal(a.buildRoad({x:1600,y:500},{x:1600,y:1000}).ok,true);
  assert.equal(a.buildRoad({x:1600,y:500},{x:1900,y:500}).ok,true);
  place(a,1450);
  const node=edge.n2,original=node.preSorting;
  assert.equal(a.addPreSorting(node,2),false);
  assert.equal(node.preSorting,original);
});
test('a visit completes its outbound and return trips through parking entrances',()=>{
  const {a}=fixture();
  for(const [p,q] of [[{x:1600,y:500},{x:1600,y:900}],[{x:1600,y:900},{x:200,y:900}],[{x:200,y:900},{x:200,y:500}]])assert.equal(a.buildRoad(p,q).ok,true);
  const home=place(a,400),shop=place(a,1550,'C','M',700);home.outTimer=0;
  a.CITY.spawn(.01,8);assert.equal(a.W.cars.length,1);
  const car=a.W.cars[0];a.CITY.spawn=()=>{};
  for(let i=0;i<6000&&!car.dead;i++)a.simStep(1/60);
  assert.equal(a.CITY.served,2);assert.ok(car.dead);
});
test('roundabout construction rejects occupied lots before changing the graph',()=>{
  const {a,edge}=fixture();
  a.buildRoad({x:1600,y:500},{x:1600,y:1000});a.buildRoad({x:1600,y:500},{x:1900,y:500});
  const lot=place(a,1480),before=a.NET.edges.slice();
  assert.equal(a.NET.makeRoundabout(edge.n2,140),false);
  assert.deepEqual(a.NET.edges,before);assert.ok(a.CITY.buildings.includes(lot));
});
test('legacy zoned saves retain geometry and capacity through a second save/load',()=>{
  const {a}=fixture();const b=place(a,700,'I','S'),old=a.captureCity();
  old.version=4;old.zones=Array(Math.ceil(4800/34)*Math.ceil(3200/34)).fill(0);
  old.zones[1]=3;old.buildings[0].cell=1;old.buildings[0].level=2;
  for(const k of ['sizeKey','width','depth','angle','parking','entrance','access'])delete old.buildings[0][k];
  a.restoreCity(old);const legacy=a.CITY.buildings[0];
  assert.equal(legacy.sizeKey,'LEGACY');assert.equal(legacy.jobs,26);
  assert.equal(legacy.x,b.x);assert.equal(legacy.y,b.y);assert.equal(legacy.parking,0);
  const geometry=[legacy.x,legacy.y,legacy.width,legacy.depth,legacy.angle];
  a.restoreCity(JSON.parse(JSON.stringify(a.captureCity())));
  const restored=a.CITY.buildings[0];
  assert.deepEqual([restored.x,restored.y,restored.width,restored.depth,restored.angle],geometry);
});
test('water touching the parking corner rejects the entire lot',()=>{
  const {a}=fixture();const good=a.CITY.previewBuilding({x:700,y:550},'R','M');
  assert.equal(good.ok,true);
  a.W.river.poly=[{x:good.x-46,y:good.y-31},{x:good.x-43,y:good.y-31},{x:good.x-43,y:good.y-28},{x:good.x-46,y:good.y-28}];
  const bad=a.CITY.previewBuilding({x:700,y:550},'R','M');
  assert.equal(bad.ok,false);assert.match(bad.msg,/water/i);
});
test('a legacy lot without roads keeps a front entrance and only connects on that frontage',()=>{
  const {a}=fixture();place(a,700);const old=a.captureCity();
  old.version=4;old.nodes=[];old.edges=[];
  old.zones=Array(Math.ceil(4800/34)*Math.ceil(3200/34)).fill(0);old.zones[1]=1;
  old.buildings[0].cell=1;
  for(const k of ['sizeKey','width','depth','angle','parking','entrance','access'])delete old.buildings[0][k];
  a.restoreCity(old);const b=a.CITY.buildings[0];
  assert.equal(b.entrance.y,b.y-b.depth/2);assert.equal(b.lane,null);
  const backY=b.y+b.depth/2+16;
  assert.equal(a.buildRoad({x:200,y:backY},{x:1600,y:backY}).ok,true);
  a.simStep(1/60);assert.equal(b.lane,null);
  const frontY=b.entrance.y-16;
  assert.equal(a.buildRoad({x:200,y:frontY},{x:1600,y:frontY}).ok,true);
  a.simStep(1/60);assert.ok(b.lane);
});
