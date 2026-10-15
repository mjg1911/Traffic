// Headless seed-42 benchmark. --baseline reads HEAD without changing the checkout.
const {execFileSync}=require('node:child_process');
const {performance}=require('node:perf_hooks');
const vm=require('node:vm');
const loadGame=require('./harness.cjs');
const diagnostic=require('../traffic-diagnostics.js');

function runBenchmark({baseline=false,seconds=60,capacity=0}={}) {
  const source=baseline ? execFileSync('git',['show','HEAD:game.js'],{encoding:'utf8',maxBuffer:4e6}) : undefined;
  const fixture=loadGame({gameSource:source}),a=fixture.api;
  a.W.safetyChecks=false;
  if(capacity) {
    vm.runInContext('globalThis.benchmarkCar=Car',fixture.context);
    a.W.cars=[];a.NET.nodes=[];a.NET.edges=[];a.CITY.buildings=[];
    a.CITY.buildT=a.CITY.candT=Infinity;
    const edge=a.NET.addEdge(a.NET.addNode(100,1000),a.NET.addNode(4700,1000),'HIGHWAY');
    for(let i=0;i<capacity;i++) {
      const lane=edge.lanes[i%edge.lanes.length],s=30+Math.floor(i/edge.lanes.length)*90;
      const origin={x:lane.pos(s).x,y:lane.pos(s).y,lane,s},goalS=lane.length-30;
      const dest={x:lane.pos(goalS).x,y:lane.pos(goalS).y,lane,s:goalS};
      const car=new fixture.context.benchmarkCar(origin,dest,i%4===0?'TRUCK':'CAR');
      car.setRoute([lane],lane,goalS);car.s=s;car.v=40;car.changeCd=1e6;
      car.pose();car.ppx=car.px;car.ppy=car.py;car.pang=car.ang;a.W.cars.push(car);
    }
  }
  const record=diagnostic.createRecorder(),unique=new Set(),examples=[];
  const startTime=a.W.time,served=a.CITY.served,changes=a.W.laneChanges;
  let peak=0,illegal=0,scans=0,truncated=0,peakReservations=0;
  for(let i=0;i<seconds*60;i++) {
    const before=new Map(a.W.cars.map(c=>[c.id,{kind:c.track?.kind,claim:c.claim}]));
    const tripsBefore=a.CITY.served,t=performance.now();a.simStep(1/60);
    record.recordPerformance({frameMs:performance.now()-t,vehicleCount:a.W.cars.length,simulatedSeconds:1/60});
    const completed=a.CITY.served-tripsBefore;
    if(completed>0)for(const duration of a.W.trips.slice(-completed))record.recordTrip({duration});
    const scan=diagnostic.detectSweptOverlaps(a.W.cars.filter(c=>c.born<a.W.time-1/60),{maxVehicles:Math.max(240,a.W.cars.length)});
    record.recordSafety(scan);scans++;if(scan.stats.truncated)truncated++;
    for(const overlap of scan.overlaps) {
      const key=overlap.ids.slice().sort((x,y)=>x-y).join(':');
      if(!unique.has(key)&&examples.length<8)examples.push({ids:overlap.ids,time:a.W.time,
        cars:overlap.ids.map(id=>{const c=a.W.cars.find(x=>x.id===id);return c&&{kind:c.track?.kind,s:c.s,v:c.v,state:c.laneState,track:c.track?.id,change:!!c.manoeuvre};})});
      unique.add(key);
    }
    for(const c of a.W.cars){const prev=before.get(c.id);if(prev?.kind==='LANE'&&c.track?.kind==='CONN'&&prev.claim!==c.track)illegal++;}
    peak=Math.max(peak,a.W.cars.length);peakReservations=Math.max(peakReservations,a.W.cars.filter(c=>c.claim).length);
  }
  return {baseline,seed:a.seed,seconds:a.W.time-startTime,trips:a.CITY.served-served,
    tripsPerMinute:(a.CITY.served-served)*60/seconds,laneChanges:a.W.laneChanges-changes,peak,peakReservations,
    uniqueOverlapPairs:unique.size,illegalEntries:illegal,scans,truncated,summary:record.summary(),examples};
}
if(require.main===module)console.log(JSON.stringify(runBenchmark({baseline:process.argv.includes('--baseline'),
  seconds:Number(process.env.TRAFFIC_BENCH_SECONDS || 60),capacity:Number(process.env.TRAFFIC_BENCH_CARS || 0)}),null,2));
module.exports={runBenchmark};
