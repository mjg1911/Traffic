const {test} = require('node:test');
const assert = require('node:assert/strict');
const loadGame = require('./harness.cjs');
test('starter city contains buildings and moving traffic',()=>{
  const {api:a}=loadGame();
  assert.ok(a.CITY.buildings.length>20);
  assert.ok(a.W.cars.length>0);
});
test('straight construction creates zero bend geometry',()=>{
  const {api:a}=loadGame();
  const result=a.buildRoad({x:200,y:200},{x:600,y:200},0);
  assert.equal(result.ok,true);
  assert.equal(a.NET.edges.at(-1).bend,0);
});
test('starting on a road splits it into a connected junction',()=>{
  const {api:a}=loadGame();
  a.buildRoad({x:200,y:200},{x:600,y:200},0);
  const result=a.buildRoad({x:400,y:200},{x:400,y:500},0);
  assert.equal(result.ok,true);
  assert.ok(a.NET.nodes.some(n=>n.x===400&&n.y===200&&n.degree===3));
});
test('crossing a road creates a four-way junction',()=>{
  const {api:a}=loadGame();
  a.buildRoad({x:200,y:200},{x:600,y:200},0);
  const result=a.buildRoad({x:400,y:80},{x:400,y:450},0);
  assert.equal(result.ok,true);
  assert.ok(a.NET.nodes.some(n=>Math.abs(n.x-400)<.1&&Math.abs(n.y-200)<.1&&n.degree===4));
});
test('parallel through lanes on an avenue do not conflict at a signal',()=>{
  const {api:a}=loadGame();
  const node=a.NET.nodes.find(n=>n.degree===4&&n.connectors.some(c=>c.fromLane.edge.type==='AVENUE'));
  assert.ok(node,'starter city has a four-way avenue junction');
  const through=node.connectors.filter(c=>c.fromLane.edge.type==='AVENUE'&&c.toLane.edge.type==='AVENUE'&&Math.abs(c.turn)<.15);
  let pair=null;
  for(let i=0;i<through.length&&!pair;i++) for(let j=i+1;j<through.length;j++){
    const first=through[i],second=through[j];
    if(first.fromLane.edge===second.fromLane.edge&&first.fromLane.forward===second.fromLane.forward&&
       first.toLane.edge===second.toLane.edge&&first.toLane.forward===second.toLane.forward&&
       first.fromLane!==second.fromLane&&first.toLane!==second.toLane){pair=[first,second];break;}
  }
  assert.ok(pair,'junction has a pair of parallel lane-to-lane through movements');
  assert.equal(pair[0].conflicts.includes(pair[1]),false);
});
test('curve construction retains chosen bend',()=>{
  const {api:a}=loadGame();
  assert.equal(a.buildRoad({x:200,y:200},{x:600,y:200},75).ok,true);
  assert.equal(a.NET.edges.at(-1).bend,75);
});
test('Escape cancels without mutating the road network',()=>{
  const {api:a,events}=loadGame();
  const count=a.NET.edges.length;
  a.IN.mode='curve'; a.IN.startPt={x:200,y:200}; a.IN.endPt={x:500,y:200};
  events['window:keydown']({key:'Escape',code:'Escape',target:{tagName:'CANVAS'},preventDefault(){}});
  assert.equal(a.IN.mode,'idle');
  assert.equal(a.NET.edges.length,count);
});
test('invalid too-short roads leave network unchanged',()=>{
  const {api:a}=loadGame();
  const count=a.NET.edges.length;
  assert.equal(a.buildRoad({x:200,y:200},{x:210,y:200},0).ok,false);
  assert.equal(a.NET.edges.length,count);
});
test('city save/load round trip preserves roads buildings zoning settings and camera',()=>{
  const {api:a}=loadGame();
  a.EDIT.grid=true;a.EDIT.drawMode='curve';
  a.CAM.x=a.CAM.tx=1250;a.CAM.y=a.CAM.ty=875;a.CAM.z=a.CAM.tz=.8;
  const saved=JSON.parse(JSON.stringify(a.captureCity()));
  a.buildRoad({x:200,y:200},{x:600,y:200},50);
  a.restoreCity(saved);
  const result=JSON.parse(JSON.stringify(a.captureCity()));
  assert.deepEqual(result,saved);
  assert.equal(a.W.cars.length,0);
  for(const e of a.NET.edges) {assert.ok(a.NET.nodes.includes(e.n1));assert.ok(a.NET.nodes.includes(e.n2));}
});
test('malformed import retains live network and traffic',()=>{
  const {api:a}=loadGame();
  const saved=a.captureCity(), nodes=a.NET.nodes,cars=a.W.cars;
  saved.edges[0].n2=999999;
  assert.throws(()=>a.restoreCity(saved),/Invalid city save/);
  assert.equal(a.NET.nodes,nodes);assert.equal(a.W.cars,cars);
});
test('roundabout topology survives save/load and traffic resumes',()=>{
  const {api:a}=loadGame();
  const n=a.NET.nodes.find(n=>n.degree>=3);
  assert.equal(a.NET.makeRoundabout(n,60),true);
  const saved=JSON.parse(JSON.stringify(a.captureCity()));
  a.restoreCity(saved);
  assert.equal(a.W.rings.size,1);
  const ring=[...a.W.rings.values()][0];
  assert.ok(ring.nodes.every(n=>a.NET.nodes.includes(n)));
  for(let i=0;i<900;i++) a.simStep(1/60);
  assert.ok(a.W.cars.length>0);
});
test('grid placement preview and pointer commit stay on cardinal axis',()=>{
  const {api:a,events}=loadGame();
  a.EDIT.grid=true;
  a.CAM.x=a.CAM.tx=600;a.CAM.y=a.CAM.ty=400;a.CAM.z=a.CAM.tz=1;
  const event=(x,y)=>({button:0,clientX:x,clientY:y,pointerId:1,shiftKey:false});
  events['cv:pointerdown'](event(200,200));
  events['cv:pointermove'](event(600,240));
  assert.equal(a.IN.endPt.x,600);assert.equal(a.IN.endPt.y,200);
  events['cv:pointerup'](event(600,240));
  const e=a.NET.edges.at(-1);assert.equal(e.n1.y,200);assert.equal(e.n2.y,200);assert.equal(e.bend,0);
});
test('drawing across two roads leaves every edge endpoint in the live graph',()=>{
  const {api:a}=loadGame();
  a.buildRoad({x:200,y:150},{x:600,y:150},0);
  a.buildRoad({x:200,y:350},{x:600,y:350},0);
  assert.equal(a.buildRoad({x:400,y:20},{x:400,y:500},0).ok,true);
  for(const e of a.NET.edges) {assert.ok(a.NET.nodes.includes(e.n1));assert.ok(a.NET.nodes.includes(e.n2));}
});
test('rejected road overlap leaves network and active traffic untouched',()=>{
  const {api:a}=loadGame();
  const edge=a.NET.edges.find(e=>e.type==='AVENUE'&&e.bend===0);
  const before=a.captureCity(), cars=a.W.cars.map(c=>({id:c.id,dead:c.dead}));
  const p=edge.centre.point(.25),q=edge.centre.point(.75);
  assert.equal(a.buildRoad(p,q,0).ok,false);
  assert.deepEqual(a.captureCity(),before);
  assert.deepEqual(a.W.cars.map(c=>({id:c.id,dead:c.dead})),cars);
});
test('reshaping rejects new unconnected road crossings without changing geometry',()=>{
  const {api:a}=loadGame();
  a.buildRoad({x:200,y:200},{x:800,y:200},0);
  a.buildRoad({x:200,y:400},{x:800,y:400},0);
  const edge=a.NET.edges.find(e=>e.n1.x===200&&e.n1.y===200&&e.n2.x===800);
  assert.equal(a.reshapeRoad(edge,250).ok,false);
  assert.equal(edge.bend,0);
});
test('reshaping an isolated road accepts safe curvature',()=>{
  const {api:a}=loadGame();
  a.buildRoad({x:200,y:200},{x:800,y:200},0);
  const edge=a.NET.edges.at(-1);
  assert.equal(a.reshapeRoad(edge,75).ok,true);
  assert.equal(edge.bend,75);
});
test('branching from a long curved road produces a real connected junction',()=>{
  const {api:a}=loadGame();
  assert.equal(a.buildRoad({x:200,y:200},{x:2400,y:200},200).ok,true);
  const t=.371,p={x:200+2200*t,y:200+800*t*(1-t)};
  assert.equal(a.buildRoad(p,{x:p.x,y:20},0).ok,true);
  const junction=a.NET.nodes.find(n=>Math.hypot(n.x-p.x,n.y-p.y)<1);
  assert.ok(junction);assert.equal(junction.degree,3);
});
test('upgrades demolition and roundabout removal remain safe during traffic',()=>{
  const {api:a}=loadGame();
  const n=a.NET.nodes.find(n=>n.degree>=3);
  a.NET.setType(a.NET.edges[0],'AVENUE');
  assert.equal(a.NET.makeRoundabout(n,60),true);
  const id=[...a.W.rings.keys()][0];
  assert.equal(a.NET.removeRoundabout(id),true);
  a.NET.removeEdge(a.NET.edges.at(-1));
  for(let i=0;i<120;i++) a.simStep(1/60);
  assert.ok(a.W.cars.every(c=>Number.isFinite(c.px)&&Number.isFinite(c.py)));
  const data=JSON.parse(JSON.stringify(a.captureCity()));
  a.restoreCity(data);
  assert.equal(a.W.rings.size,0);
});
test('malformed file import retains live city without prompting to replace it',async()=>{
  const {api:a,context}=loadGame();
  const nodes=a.NET.nodes;let confirmations=0;
  context.confirm=()=>{confirmations++;return true;};
  await a.importCity({size:15,text:async()=>'{"bad":true}'});
  assert.equal(a.NET.nodes,nodes);assert.equal(confirmations,0);
});
test('a shallow-angle crossing connects instead of being mistaken for duplicate pavement',()=>{
  const {api:a}=loadGame();
  assert.equal(a.buildRoad({x:200,y:200},{x:800,y:200},0).ok,true);
  const offset=300*Math.tan(5*Math.PI/180);
  const result=a.buildRoad({x:200,y:200-offset},{x:800,y:200+offset},0);
  assert.equal(result.ok,true);
  assert.ok(a.NET.nodes.some(n=>Math.hypot(n.x-500,n.y-200)<1&&n.degree===4));
});
test('a rejected duplicate subsegment of a long road never changes the graph',()=>{
  const {api:a}=loadGame();
  assert.equal(a.buildRoad({x:-100,y:100},{x:7300,y:100},0).ok,true);
  const before=JSON.stringify(a.captureCity());
  assert.equal(a.buildRoad({x:1750,y:100},{x:5450,y:100},0).ok,false);
  assert.equal(JSON.stringify(a.captureCity()),before);
});
test('newly developed buildings stay outside road pavement at junctions',()=>{
  const {api:a}=loadGame();
  const junction=a.NET.nodes.find(n=>n.degree>=3);
  assert.ok(junction);
  a.CITY.zone.fill(0);
  a.CITY.used.fill(0);
  a.CITY.buildings=[];
  a.CITY.paint({x:junction.x,y:junction.y},250,1);
  a.CITY.demand={R:1,C:0,I:0};
  a.CITY.rebuildCandidates();
  const before=new Set(a.CITY.buildings);
  for(let i=0;i<300;i++)a.CITY.develop();
  const developed=a.CITY.buildings.filter(b=>!before.has(b));
  assert.ok(developed.length>0);
  for(const b of developed){
    assert.ok(b.edge&&b.lane);
    for(const e of a.NET.edges){
      if(!e.centre)continue;
      const near=e.centre.nearest({x:b.x,y:b.y});
      const tangent=e.centre.dir(near.s);
      const normal={x:-tangent.y,y:tangent.x};
      const wob=.82+.36*b.seed;
      const width=b.size*wob;
      const height=b.size*(b.type==='I'?.86:.95)/wob;
      const u={x:Math.cos(b.angle),y:Math.sin(b.angle)};
      const v={x:-u.y,y:u.x};
      const support=Math.abs(normal.x*u.x+normal.y*u.y)*width/2+
        Math.abs(normal.x*v.x+normal.y*v.y)*height/2;
      assert.ok(near.d>=e.halfWidth+support,
        `building at (${b.x.toFixed(1)}, ${b.y.toFixed(1)}) overlaps a road`);
    }
  }
});
