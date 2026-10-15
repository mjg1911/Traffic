const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const loadGame=require('./harness.cjs');

function routingHooks(f) {
  vm.runInContext('globalThis.routingHooks={routeBetween,routeTravelTime}',f.context);
  return f.context.routingHooks;
}

function emptyCity() {
  const f=loadGame({blank:true}),a=f.api;
  a.W.cars=[];a.NET.nodes=[];a.NET.edges=[];
  return {a,h:routingHooks(f)};
}

test('route cost prefers a longer high-speed corridor over slower streets',()=>{
  const {a,h}=emptyCity();
  const source=a.NET.addNode(0,0),split=a.NET.addNode(200,0),
    target=a.NET.addNode(1000,0),detour=a.NET.addNode(600,80),dest=a.NET.addNode(1200,0);
  a.NET.addEdge(source,split,'ONEWAY_SINGLE');
  const short=a.NET.addEdge(split,target,'STREET');
  const fastFirst=a.NET.addEdge(split,detour,'HIGHWAY');
  const fastSecond=a.NET.addEdge(detour,target,'HIGHWAY');
  const finish=a.NET.addEdge(target,dest,'ONEWAY_SINGLE');

  assert.ok(fastFirst.centre.length+fastSecond.centre.length>short.centre.length,
    'the high-speed alternative must be geometrically longer');
  const route=h.routeBetween(a.NET.edges[0].fwd[0],0,finish.fwd[0],finish.fwd[0].length-20);
  assert.ok(route?.some(t=>t.kind==='CONN'&&t.node===split&&t.toLane.edge===fastFirst),
    'the route should choose the longer branch with lower expected travel time');
  for(const lane of fastFirst.fwd) lane.observedTravelTime=1000;
  const observedRoute=h.routeBetween(a.NET.edges[0].fwd[0],0,finish.fwd[0],finish.fwd[0].length-20);
  assert.ok(observedRoute?.some(t=>t.kind==='CONN'&&t.node===split&&t.toLane.edge===short),
    'a slow observed track traversal should raise the corridor cost');
  for(const lane of [...fastFirst.fwd,...fastSecond.fwd]) {
    lane.observedTravelTime=undefined;lane.load=1;
  }
  const loadedRoute=h.routeBetween(a.NET.edges[0].fwd[0],0,finish.fwd[0],finish.fwd[0].length-20);
  assert.ok(loadedRoute?.some(t=>t.kind==='CONN'&&t.node===split&&t.toLane.edge===short),
    'heavy lane occupancy should raise the corridor cost');
});

test('route feasibility counts adjacent lane changes and permits a reachable turn pocket',()=>{
  const {a,h}=emptyCity(),node=a.NET.addNode(600,600);
  for(const [x,y] of [[600,100],[1100,600],[600,1100],[100,600]])
    a.NET.addEdge(a.NET.addNode(x,y),node,'AVENUE');
  a.addPreSorting(node,2);
  const pocket=node.lanesIn.find(l=>l.pocket==='left');
  const from=pocket.siblings.find(l=>l.order===0);
  const turn=node.connectors.find(c=>c.fromLane===pocket);

  const route=h.routeBetween(from,0,turn.toLane,turn.toLane.length-20);
  assert.ok(route?.some(t=>t.kind==='CONN'&&t.fromLane===pocket),
    'a route with enough approach distance should use the pocket after adjacent merges');
});

test('route feasibility avoids a turn pocket after its usable approach has passed',()=>{
  const {a,h}=emptyCity(),node=a.NET.addNode(600,600);
  for(const [x,y] of [[600,100],[1100,600],[600,1100],[100,600]])
    a.NET.addEdge(a.NET.addNode(x,y),node,'AVENUE');
  a.addPreSorting(node,2);
  const pocket=node.lanesIn.find(l=>l.pocket==='left');
  const from=pocket.siblings.find(l=>l.order===0);
  const turn=node.connectors.find(c=>c.fromLane===pocket);

  const route=h.routeBetween(from,from.length-6,turn.toLane,turn.toLane.length-20);
  assert.ok(route===null || !route.includes(turn),
    'a route must not demand the unreachable pocket connector from the current approach');
});

test('a 45-unit pocket is reachable for a car but too short for a truck',()=>{
  const {a,h}=emptyCity(),node=a.NET.addNode(600,600);
  for(const [x,y] of [[600,100],[1100,600],[600,1100],[100,600]])
    a.NET.addEdge(a.NET.addNode(x,y),node,'AVENUE');
  a.addPreSorting(node,2);
  const pocket=node.lanesIn.find(l=>l.pocket==='left');
  a.resizePreSorting(node,pocket.edge,'left',45);
  const shortPocket=node.lanesIn.find(l=>l.pocket==='left');
  const from=shortPocket.siblings.find(l=>l.order===0);
  const turn=node.connectors.find(c=>c.fromLane===shortPocket);

  const carRoute=h.routeBetween(from,0,turn.toLane,turn.toLane.length-20,false,a.CFG.CAR_L);
  const truckRoute=h.routeBetween(from,0,turn.toLane,turn.toLane.length-20,false,a.CFG.TRUCK_L);
  assert.ok(carRoute?.some(t=>t.kind==='CONN'&&t.fromLane===shortPocket),
    'slowing must keep a short but physically usable pocket in the route graph');
  assert.ok(!truckRoute?.some(t=>t.kind==='CONN'&&t.fromLane===shortPocket),
    'a truck must not be routed into a pocket that cannot fit its stopping clearance and merge');
});

test('every adjacent lane change fits after an intermediate pocket mouth',()=>{
  const {a,h}=emptyCity();
  const fromNode=a.NET.addNode(0,0),toNode=a.NET.addNode(900,0);
  const edge=a.NET.addEdge(fromNode,toNode,'HIGHWAY');
  const [from,middle,to]=edge.fwd;
  middle.pocket='test-intermediate';
  middle.startS=middle.length*.95-(a.CFG.CAR_L/2+3);
  const targetS=to.length-20;

  assert.ok(!h.routeBetween(from,0,to,targetS,false),
    'the route must leave enough distance after entering a pocket to complete later adjacent changes');

  middle.startS=middle.length*.78-(a.CFG.CAR_L/2+3);
  assert.ok(!!h.routeBetween(from,0,to,targetS,false),
    'the same adjacent path is feasible when every merge fits after the pocket mouth');
});

test('lane changes preserve two units before a goal position and the maneuver minimum',()=>{
  const {a,h}=emptyCity();
  const fromNode=a.NET.addNode(0,0),toNode=a.NET.addNode(300,0);
  const edge=a.NET.addEdge(fromNode,toNode,'AVENUE');
  const [from,to]=edge.fwd;

  assert.ok(!h.routeBetween(from,0,to,17,false),
    'a 15-unit goal approach cannot fit the 15.5-unit maneuver after goal clearance');
  assert.ok(!!h.routeBetween(from,0,to,30,false),
    'a sufficiently long goal approach remains routable');
});

test('cached outgoing movements refresh after a lane-rule rebuild',()=>{
  const {a,h}=emptyCity();
  const node=a.NET.addNode(500,500);
  const from=a.NET.addEdge(a.NET.addNode(500,100),node,'AVENUE');
  const east=a.NET.addEdge(node,a.NET.addNode(1000,500),'AVENUE');
  a.NET.addEdge(node,a.NET.addNode(500,1000),'AVENUE');
  const candidate=node.connectors.find(c=>c.fromLane.edge===from && c.toLane.edge===east);
  assert.ok(candidate,'test junction should have an automatic movement to the selected exit');
  const incoming=candidate.fromLane;
  assert.ok(h.routeBetween(incoming,0,candidate.toLane,candidate.toLane.length-20,false)?.includes(candidate),
    'initial routing should use the cached movement');

  const changed=a.NET.toggleLaneConnection(node,incoming,candidate.toLane);
  assert.ok(changed.ok);
  const rebuiltRoute=h.routeBetween(incoming,0,candidate.toLane,candidate.toLane.length-20,false);
  assert.ok(!rebuiltRoute?.includes(candidate),
    'a lane-rule rebuild must invalidate cached outgoing movements');
});
