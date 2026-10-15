const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const editor = fs.existsSync('road-editor.js') ? require('../road-editor.js') : {};
test('grid rounds negative coordinates', () => {
  assert.deepEqual(editor.snapPoint({x:-126,y:74}), {x:-150,y:50});
});
test('locked straight road chooses east-west axis', () => {
  assert.deepEqual(editor.endpoint({x:100,y:100},{x:330,y:144},{grid:true,straight:true}), {x:350,y:100,node:null});
});
test('locked straight road chooses north-south axis from off-grid junction', () => {
  assert.deepEqual(editor.endpoint({x:123,y:107},{x:141,y:-135},{grid:true,straight:true}), {x:123,y:-150,node:null});
});
test('free straight roads retain diagonal angles', () => {
  assert.deepEqual(editor.endpoint({x:0,y:0},{x:123,y:87},{grid:false,straight:true}), {x:123,y:87,node:null});
});
test('locked straight road rejects off-axis junction', () => {
  const nodes=[{x:350,y:110}];
  assert.deepEqual(editor.endpoint({x:100,y:100},{x:345,y:112},{grid:true,straight:true,nodes}), {x:350,y:100,node:null});
});
test('locked straight road snaps to aligned junction', () => {
  const n={x:343,y:100};
  assert.deepEqual(editor.endpoint({x:100,y:100},{x:345,y:108},{grid:true,straight:true,nodes:[n]}), {x:343,y:100,node:n});
});
test('free and curved modes snap to nearest junction without mutating inputs', () => {
  const pointer=Object.freeze({x:123,y:87}), start=Object.freeze({x:0,y:0}), n={x:120,y:80};
  assert.deepEqual(editor.endpoint(start,pointer,{grid:false,straight:false,nodes:[n]}), {x:120,y:80,node:n});
  assert.deepEqual(editor.endpoint(start,pointer,{grid:true,straight:false}), {x:100,y:100,node:null});
});
