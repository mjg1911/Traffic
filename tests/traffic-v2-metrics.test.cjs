const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const diagnostics=require('../traffic-diagnostics.js');
const loadGame=require('./harness.cjs');

test('trip summaries include route, successful lane-change, and missed-turn counts per trip',()=>{
  const recorder=diagnostics.createRecorder();
  recorder.recordLaneChange({vehicleId:'car-1',success:true});
  recorder.recordLaneChange({vehicleId:'car-1',success:false});
  recorder.recordLaneChange({vehicleId:'car-2',success:true});
  recorder.recordTrip({vehicleId:'car-1',duration:12,routeChanges:2,missedTurns:1});
  recorder.recordTrip({vehicleId:'car-2',duration:18,routeChanges:0,missedTurns:0});

  const summary=recorder.summary();
  assert.equal(summary.perTrip.routeChanges.average,1);
  assert.equal(summary.perTrip.routeChanges.p95,1.9);
  assert.equal(summary.perTrip.laneChanges.average,1);
  assert.equal(summary.perTrip.missedTurns.average,.5);
});

test('CITY trip completion records counter deltas instead of lifetime totals',()=>{
  const {api:a}=loadGame();
  const building=()=>({x:0,y:0,service:.5,dead:false});
  const car={id:9001,origin:building(),dest:building(),routeChanges:3,missedTurns:2};

  a.CITY.tripDone(car,10);
  car.routeChanges=5;car.missedTurns=3;
  a.CITY.tripDone(car,12);

  const perTrip=a.trafficDiagnostics.summary().perTrip;
  assert.equal(perTrip.routeChanges.count,2);
  assert.equal(perTrip.routeChanges.average,2.5);
  assert.equal(perTrip.missedTurns.average,1.5);
});

function waitingCar(f, id=9002) {
  const a=f.api;
  a.W.cars=[];a.NET.nodes=[];a.NET.edges=[];a.CITY.buildings=[];a.CITY.candidates=[];
  a.CITY.spawn=()=>{};a.CITY.develop=()=>{};a.CITY.candT=1000;
  const edge=a.NET.addEdge(a.NET.addNode(0,0),a.NET.addNode(700,0),'AVENUE');
  vm.runInContext('globalThis.metricHooks={Car}',f.context);
  const lane=edge.fwd[0];
  const car=new f.context.metricHooks.Car({x:0,y:0,lane,s:100},{x:680,y:0,lane,s:lane.length-30});
  car.setRoute([lane],lane,lane.length-30);car.s=100;car.v=0;car.waitReason='signal';
  car.step=function(){
    if(this.finishAs==='ENTER') {this.phase='ENTER';this.track=null;this.waitReason=null;}
    else if(this.finishAs==='DEAD') {this.dead=true;this.waitReason=null;}
    else this.waitReason='signal';
  };
  car.pose=function(){};
  car.id=id;a.W.cars=[car];
  return {a,car};
}

test('wait time is flushed on trip completion or death without counting inactive time',()=>{
  const f=loadGame(),{a,car}=waitingCar(f);
  a.simStep(.25);
  car.finishAs='ENTER';
  a.simStep(.25);

  let waits=a.trafficDiagnostics.getEvents().filter(e=>e.type==='wait'&&e.vehicleId===car.id);
  assert.equal(waits.length,1);
  assert.equal(waits[0].reason,'signal');
  assert.equal(waits[0].seconds,.25);
  assert.equal(car.diagnosticWaitSeconds,0);

  car.finishAs=null;car.phase='OUT';car.track=car.route[0];car.s=100;car.dead=false;
  car.diagnosticWaitReason=null;car.diagnosticWaitSeconds=0;a.W.cars=[car];
  a.simStep(.25);
  car.finishAs='DEAD';
  a.simStep(.25);

  waits=a.trafficDiagnostics.getEvents().filter(e=>e.type==='wait'&&e.vehicleId===car.id);
  assert.equal(waits.length,2);
  assert.equal(waits[1].reason,'signal');
  assert.equal(waits[1].seconds,.25);
});

test('route cost uses the expected red delay for a fixed multi-phase signal cycle',()=>{
  const f=loadGame();
  vm.runInContext('globalThis.metricHooks={routeJunctionDelay}',f.context);
  const h=f.context.metricHooks;
  const node={control:'SIGNAL',signal:{phases:3}};
  const conn={node,load:0,turn:0};
  const delay=h.routeJunctionDelay(conn);
  assert.equal(delay,f.api.CFG.GREEN_TIME*4/6);
});
