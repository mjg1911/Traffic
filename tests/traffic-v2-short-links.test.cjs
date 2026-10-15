const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const loadGame=require('./harness.cjs');
function shortLink() {
  const f=loadGame({blank:true}),a=f.api;
  vm.runInContext('globalThis.shortHooks={Car,routeBetween}',f.context);
  const west=a.NET.addNode(0,500),first=a.NET.addNode(600,500),second=a.NET.addNode(800,500);
  const approach=a.NET.addEdge(west,first,'HIGHWAY');
  const link=a.NET.addEdge(first,second,'HIGHWAY');
  const exit=a.NET.addEdge(second,a.NET.addNode(800,-100),'HIGHWAY');
  a.NET.addEdge(second,a.NET.addNode(1400,500),'HIGHWAY');
  const incoming=approach.fwd[0],landing=link.fwd[0];
  const entry=first.connectors.find(c=>c.fromLane===incoming && c.toLane===landing);
  const turn=second.connectors.find(c=>c.fromLane===link.fwd[2] && c.toLane.edge===exit);
  assert.ok(entry && turn);
  const goal={x:800,y:-80,lane:turn.toLane,s:turn.toLane.length-35};
  const c=new f.context.shortHooks.Car({x:0,y:500,lane:incoming,s:0},goal);
  c.setRoute([incoming,entry,landing,turn,turn.toLane],goal.lane,goal.s);
  c.s=incoming.length-160;c.v=110;c.v0=140;c.changeCd=0;c.pose();
  a.W.cars=[c];a.CITY.spawn=()=>{};a.CITY.develop=()=>{};
  return {...f,a,c,entry,link,turn};
}
test('a fast approach slows before a short link and completes two adjacent merges for its turn',()=>{
  const {a,c,entry,link,turn}=shortLink();
  let entered=false,tookTurn=false,entrySpeed=null;
  for(let i=0;i<1800;i++) {
    a.simStep(1/60);
    if(c.track===link.fwd[0] && !entered){entered=true;entrySpeed=c.v;}
    if(c.track===turn){tookTurn=true;break;}
    if(c.dead || c.phase==='ENTER')break;
  }
  assert.ok(entered);
  assert.ok(tookTurn,`the planned turn must be reachable after a ${entrySpeed?.toFixed(1)} unit/s link entry`);
  assert.equal(c.missedTurns,0);
});
module.exports={shortLink};
