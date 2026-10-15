# Larger Playfield and WASD Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand Arterial's playable world and starter city, preserve existing saved cities, and let the player pan the camera with WASD.

**Architecture:** Keep the Canvas 2D renderer, world simulation, camera, and input loop in `game.js`. Keep save-format validation and version-1 migration in `city-save.js`; update the HTML and README controls. Existing v1 saves will be validated in their original grid, migrated into the expanded v2 zoning grid, then restored through the existing candidate-before-mutation path.

**Tech Stack:** Plain JavaScript, HTML, CSS, Canvas 2D, browser local storage; no runtime dependencies.

## Global Constraints

- Target world bounds: 4,800 × 3,200 world units.
- Target starter grid: 4 columns × 5 rows of junctions, with one deliberate missing connection.
- Start new and restarted cities at 0.7 zoom minimum; Fit still frames the full city.
- Keep the current UI arrangement and visual style.
- Preserve Space-drag, middle-button drag, Shift-drag, wheel zoom, zoom buttons, and Fit.
- Reassign the lane-overlay shortcut from D to L because D is the eastward WASD movement key.
- Migrate version-1 saves and exports into the version-2 zoning layout without losing authored city state.
- Keep the game fully local and do not add runtime dependencies.
- Do not add or run tests unless the user asks for testing or verification.
- This workspace has no Git repository; do not attempt commits.

---

### Task 1: Expand the world and starter network

**Files:**
- Modify: `E:\Traffic game\game.js`

**Interfaces:**
- Keep existing `CFG.WORLD_W`, `CFG.WORLD_H`, `CAM`, `CITY`, `NET`, `initScene()`, `drawGround()`, and `frame()` interfaces.
- New world dimensions are the source of truth for terrain bounds, zoning dimensions, river generation, and camera pan limits.

- [x] **Step 1: Set expanded world dimensions and make terrain decoration use them.**

Set the config to:

```js
WORLD_W: 4800, WORLD_H: 3200,
```

In `drawGround()`, replace fixed park-placement moduli (`2700` and `1750`) with world-relative ranges:

```js
const x = 180 + (i * 647 + SEED % 487) % Math.max(1, CFG.WORLD_W - 360);
const y = 120 + (i * 479 + SEED % 331) % Math.max(1, CFG.WORLD_H - 240);
```

Keep `makeRiver()`, city-grid sizing, world fill, and camera pan bounds tied to `CFG.WORLD_W` and `CFG.WORLD_H`.

- [x] **Step 2: Center and enlarge the starter grid and zoning.**

In `initScene()`, use `columns = 4`, `rows = 5`, and `spacing = 350`. Compute the upper-left grid point from the world center and the river-facing side:

```js
const cx = CFG.WORLD_W / 2, cy = CFG.WORLD_H / 2;
const side = W.river.centre[6].x > cx ? -1 : 1;
const columns = 4, rows = 5, spacing = 350;
const centerX = cx + side * 700;
const baseX = Math.round((centerX - (columns - 1) * spacing / 2) / 50) * 50;
const baseY = Math.round((cy - (rows - 1) * spacing / 2) / 50) * 50;
```

Replace the fixed-size loops in `initScene()` with loops using those counts and this layout:

```js
const nodes = Array.from({ length: rows }, (_, y) =>
  Array.from({ length: columns }, (_, x) => NET.addNode(baseX + x * spacing, baseY + y * spacing)));
for (let y = 0; y < rows; y++) {
  for (let x = 0; x < columns - 1; x++) {
    if (y === 0 && x === 1) continue;
    NET.addEdge(nodes[y][x], nodes[y][x + 1], y === 2 ? 'AVENUE' : 'STREET');
  }
}
for (let x = 0; x < columns; x++) {
  for (let y = 0; y < rows - 1; y++) {
    NET.addEdge(nodes[y][x], nodes[y + 1][x], x === 2 ? 'AVENUE' : 'STREET');
  }
}
for (const n of NET.nodes) if (n.degree >= 3) { n.control = 'SIGNAL'; buildSignal(n); }
for (let y = 0; y < rows - 1; y++) {
  for (let x = 0; x < columns - 1; x++) {
    const zone = x === 2 ? ZONE_I : y === 1 ? ZONE_C : ZONE_R;
    const blockX = baseX + x * spacing + spacing / 2;
    const blockY = baseY + y * spacing + spacing / 2;
    CITY.paint({ x: blockX, y: blockY - 65 }, 132, zone);
    CITY.paint({ x: blockX, y: blockY + 65 }, 132, zone);
  }
}
CITY.reattachDirty = true;
```

Keep `populateStarter()` unchanged so the existing development and traffic warm-up still runs.

After `CAM.fit(cw, ch)` in both the initial boot and `restart()`, set `CAM.tz = Math.max(CAM.tz, 0.7)`. On initial boot, keep copying `tx`, `ty`, and `tz` into `x`, `y`, and `z` after applying the floor. Leave the Fit button bound directly to `CAM.fit(cw, ch)`.

- [x] **Step 3: Review world-sized loops and direct coordinate assumptions.**

Inspect each `WORLD_W`, `WORLD_H`, park, river, terrain, and starter-scene use in `game.js`. Leave code that already derives from `CFG` as-is; update remaining fixed old-world placement values so the 4,800 × 3,200 map is covered and the starter grid stays inside its bounds.

**Deliverable:** New cities use the expanded world and a 20-junction starter network with zoned blocks and active traffic.

### Task 2: Migrate version-1 saves to the expanded version-2 grid

**Files:**
- Modify: `E:\Traffic game\city-save.js`
- Modify: `E:\Traffic game\game.js`

**Interfaces:**
- `CitySave.validate(data)` continues to return a validated input save, accepting the supported v1 legacy grid and v2 expanded grid.
- Add `CitySave.migrate(data)`, which validates the input and returns a validated version-2 save without mutating the input.
- `captureCity()` writes `version: CitySave.VERSION` and the expanded zoning array.
- `restoreCity(raw)` restores only `CitySave.migrate(raw)` output.

- [x] **Step 1: Define the two supported grid sizes.**

In `city-save.js`, set `VERSION = 2`; define legacy columns and rows from `ceil(3000 / 34)` and `ceil(2000 / 34)`, and current columns and rows from `ceil(4800 / 34)` and `ceil(3200 / 34)`. The counts are 5,251 legacy cells and 13,490 current cells. Keep `ZONE_COUNT` as the version-2 count. During validation, select the expected count from `data.version` and use it for the zones array length and maximum building cell; reject all other versions and wrong-length arrays.

```js
const legacyCols = Math.ceil(3000 / 34), legacyRows = Math.ceil(2000 / 34);
const currentCols = Math.ceil(4800 / 34), currentRows = Math.ceil(3200 / 34);
const LEGACY_ZONE_COUNT = legacyCols * legacyRows;
const ZONE_COUNT = currentCols * currentRows;
const zoneCount = data.version === 1 ? LEGACY_ZONE_COUNT : data.version === VERSION ? ZONE_COUNT : 0;
if (!zoneCount) invalid('version', 'is unsupported');
const zones = array(data.zones, 'zones', zoneCount);
if (zones.length !== zoneCount) invalid('zones', 'has the wrong cell count');
```

Use `zoneCount - 1` when validating each building's `cell`.

- [x] **Step 2: Add non-mutating version-1 migration.**

Implement `migrate(data)` by validating first. For v2, return the validated data. For v1, allocate a zero-filled v2 zoning array, copy each old row-major cell at `(column, row)` into `row * currentCols + column`, and remap every building cell. The function must not mutate its argument. Use this implementation shape and export `migrate` from `CitySave`:

```js
function migrate(data) {
  validate(data);
  if (data.version === VERSION) return data;
  const migrated = {
    ...data,
    version: VERSION,
    zones: new Array(ZONE_COUNT).fill(0),
    buildings: data.buildings.map(building => ({
      ...building,
      cell: Math.floor(building.cell / legacyCols) * currentCols + (building.cell % legacyCols),
    })),
  };
  for (let oldCell = 0; oldCell < data.zones.length; oldCell++) {
    const row = Math.floor(oldCell / legacyCols), column = oldCell % legacyCols;
    migrated.zones[row * currentCols + column] = data.zones[oldCell];
  }
  return validate(migrated);
}
```

- [x] **Step 3: Write and read v2 through the existing save flow.**

In `captureCity()`, set `version: CitySave.VERSION`. In `restoreCity(raw)`, call `CitySave.migrate(raw)` before creating candidate geometry. Keep the existing local-storage key names so old browser saves remain discoverable. In `importCity()`, migrate and validate before asking to replace the current city; restore the migrated candidate after confirmation. Keep candidate construction and live-state replacement order unchanged.

**Deliverable:** Existing local and exported v1 cities load into the expanded map, new saves use v2, and invalid saves leave the active city untouched.

### Task 3: Add continuous WASD camera panning and update controls text

**Files:**
- Modify: `E:\Traffic game\game.js`
- Modify: `E:\Traffic game\index.html`
- Modify: `E:\Traffic game\README.md`

**Interfaces:**
- Add `IN.panKeys` with `w`, `a`, `s`, and `d` boolean fields.
- Add `moveCamera(dt)` in the input/camera section; call it once per animation frame before `CAM.ease(dt)`.
- Keyboard controls remain registered on `window`; they continue to ignore editable controls and modifier-key combinations.

- [x] **Step 1: Track WASD key state and clear it safely.**

Add `panKeys: { w: false, a: false, s: false, d: false }` to `IN`. After the existing editable-target and modifier guards in keydown, lower-case `e.key`; if it is one of the four directions, set it, call `preventDefault()`, and return before tool shortcuts. On keyup, clear the matching direction and retain the Space release. Clear all four directions on blur. Preserve other editing shortcuts, but move the lane-overlay shortcut from `d` to `l` so D can pan east, and update its button title from `(D)` to `(L)`.

```js
const PAN_KEYS = ['w', 'a', 's', 'd'];
function clearPanKeys() {
  for (const key of PAN_KEYS) IN.panKeys[key] = false;
}
window.addEventListener('keyup', e => {
  const key = e.key.toLowerCase();
  if (PAN_KEYS.includes(key)) IN.panKeys[key] = false;
  if (e.code === 'Space') IN.space = false;
});
window.addEventListener('blur', clearPanKeys);
```

- [x] **Step 2: Move the camera target at a zoom-adjusted, frame-based speed.**

Implement and call this before `CAM.ease(dtReal)` in `frame(now)`:

```js
function moveCamera(dt) {
  const dx = Number(IN.panKeys.d) - Number(IN.panKeys.a);
  const dy = Number(IN.panKeys.s) - Number(IN.panKeys.w);
  const length = Math.hypot(dx, dy);
  if (!length) return;
  const step = 560 * dt / length / Math.max(CAM.tz, 0.18);
  CAM.tx = clamp(CAM.tx + dx * step, -400, CFG.WORLD_W + 400);
  CAM.ty = clamp(CAM.ty + dy * step, -400, CFG.WORLD_H + 400);
}
```

- [x] **Step 3: Update visible and accessible instructions.**

Change the canvas label to mention WASD and Space-drag panning. Change the bottom navigation hint to show `WASD` pan and retain scroll zoom and Escape cancel. Change the lane button title to say `(L)`. Bump the `city-save.js` and `game.js` query versions in `index.html` to avoid loading cached versions. Add “WASD to pan” and “L toggles lane routing” to the README's controls while retaining the existing pan and zoom instructions.

**Deliverable:** Holding WASD smoothly pans at consistent screen-relative speed, diagonal travel is normalized, and all existing navigation controls remain available.

## Scope review

- World size, terrain distribution, starter network, zoning, and active traffic: Task 1.
- V1 save compatibility, v2 capture, import validation, and safe restore: Task 2.
- Smooth WASD navigation, key cleanup, existing controls, accessibility text, and README: Task 3.
- Automated test additions/runs and Git commits are excluded by the current session constraints.

## Progress

- Implementation complete. Syntax checks for `game.js` and `city-save.js` exited successfully.
- Automated tests and browser interaction checks were not run under the session constraint.
- This workspace has no Git repository, so no commit or branch integration was performed.
