# House Road Placement Implementation Plan

> **For agentic workers:** Implement this plan task-by-task inline, preserving the test-first order below.

**Goal:** Prevent newly developed buildings from overlapping road pavement, including crossing roads at junctions.

**Architecture:** Keep candidate selection and road attachment as they are. After attachment, use the building's rendered rotated rectangle and each road's centerline and half-width to reject placements whose footprints touch pavement.

**Tech Stack:** Browser JavaScript, Node.js built-in test runner, existing VM-based game test harness.

## Global Constraints

- Add no runtime dependencies.
- Preserve zoning, road access, saves, and existing building relocation behavior.
- Reject only new building placements whose footprints intersect pavement.

---

## File Structure

- `game.js`: Add a city placement check for building footprints against road geometry and use it before development commits a building.
- `tests/game.test.cjs`: Add a deterministic junction regression using the real city development path.

## Task 1: Reject building placements that overlap roads

**Files:**
- Modify: `tests/game.test.cjs`
- Modify: `game.js`

**Interfaces:**
- Add `CITY.overlapsRoad(b)`, returning `true` when the rendered footprint of `b` intersects any road pavement and `false` otherwise.
- `CITY.develop()` calls `overlapsRoad` after `attach` and before recording the new building.

- [ ] **Step 1: Add a deterministic failing junction regression**

Append this test to `tests/game.test.cjs`. Its local geometry check mirrors the rendered footprint, while exercising `CITY.develop()` to reproduce the original bug.

```js
test('newly developed buildings stay outside road pavement at junctions',()=>{
  const {api:a}=loadGame();
  a.CITY.paint({x:1000,y:950},130,0);
  a.CITY.paint({x:1000,y:950},130,1);
  a.CITY.demand={R:1,C:0,I:0};
  a.CITY.rebuildCandidates();
  const before=new Set(a.CITY.buildings);
  for(let i=0;i<100;i++)a.CITY.develop();
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
```

- [ ] **Step 2: Run the targeted test and confirm it fails for the overlap**

Run: `node --test --test-name-pattern="newly developed buildings stay outside road pavement at junctions" tests/game.test.cjs`

Expected before the fix: the test fails with `building ... overlaps a road`.

- [ ] **Step 3: Implement the minimal road-footprint check**

Add this method to the `CITY` object in `game.js`, near `overlaps()`:

```js
  overlapsRoad(b) {
    const wob = 0.82 + 0.36 * b.seed;
    const width = b.size * wob;
    const height = b.size * (b.type === 'I' ? 0.86 : 0.95) / wob;
    const u = { x: Math.cos(b.angle), y: Math.sin(b.angle) };
    const v = { x: -u.y, y: u.x };
    for (const e of NET.edges) {
      if (!e.centre) continue;
      const near = e.centre.nearest({ x: b.x, y: b.y });
      const tangent = e.centre.dir(near.s);
      const normal = { x: -tangent.y, y: tangent.x };
      const support = Math.abs(normal.x * u.x + normal.y * u.y) * width / 2 +
        Math.abs(normal.x * v.x + normal.y * v.y) * height / 2;
      if (near.d < e.halfWidth + support) return true;
    }
    return false;
  },
```

In `CITY.develop()`, immediately after `if (!this.attach(b)) continue;`, add:

```js
      if (this.overlapsRoad(b)) continue;
```

- [ ] **Step 4: Run the targeted regression and the game test file**

Run: `node --test --test-name-pattern="newly developed buildings stay outside road pavement at junctions" tests/game.test.cjs`

Expected: PASS.

Run: `node --test tests/game.test.cjs`

Expected: all game tests PASS.

## Self-review

- The regression covers the reported junction placement and confirms that safe developed buildings keep an attached lane.
- The check uses the rendered dimensions and rotation and examines every edge with road geometry, including roundabout edges.
- The implementation does not change existing building coordinates, zoning, road editing, or persistence.
- No placeholders or additional dependencies are present.
