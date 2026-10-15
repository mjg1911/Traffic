const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runBenchmark}=require('./traffic-benchmark.cjs');
test('seed 42 mixed-city traffic completes trips without swept overlaps or illegal entries',()=>{
  const result=runBenchmark({seconds:60});
  assert.equal(result.uniqueOverlapPairs,0,JSON.stringify(result.examples));
  assert.equal(result.illegalEntries,0);
  assert.equal(result.truncated,0,'a safety scan must prove clearance or report its limits');
  assert.ok(result.trips>0,'traffic must continue to complete trips');
});
