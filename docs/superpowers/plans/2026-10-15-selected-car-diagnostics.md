# Selected Car Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a player select one vehicle in the City tab and inspect the actual movement constraint that is keeping it still.

**Architecture:** Capture a transient movement snapshot inside `Car.step`, where the controller already applies its speed and distance limits. Store the selected `Car` in world state, select it from City-tool clicks before bulldozing, and show its live snapshot in a small City-panel card while highlighting it on the map.

**Tech Stack:** Existing vanilla JavaScript simulation, HTML Canvas, and CSS. No new dependencies.

## Global Constraints

- Vehicle selection is available only while the City category is active.
- The inspector is read-only; it has no replan, reservation-release, or simulation-control actions.
- Selection and diagnostic counters are transient and do not affect city save files or vehicle behavior.
- Do not add or run tests unless the user asks to test or verify implementation.

---

## File map

- `game.js`: transient selection, vehicle hit testing, movement diagnostics, stationary and claim-renewal counters, selection lifetime, highlight, and inspector rendering.
- `index.html`: the selected-car card in the existing City panel.
- `styles.css`: card layout, diagnostic emphasis, and narrow-screen behavior.
- No save-format or test files change in this plan.

## Task 1: Capture the vehicle's movement constraints

**Files:**
- Modify: `game.js` (`Car` constructor, `findLeader`, `step`, `releaseClaim`, and `arbitrate`)

**Interfaces:**
- Consumes: the existing leader, acceleration, stop-line, destination, junction-region, merge-stop, yield, and claim calculations in `Car.step` and `arbitrate`.
- Produces: `car.lastMotionDiagnostic`, `car.stationarySeconds`, and `car.claimRenewalsWhileStopped`, all transient values.

- [x] **Step 1: Initialize transient fields on `Car`.**

Add these fields beside the existing `waitReason` and `claimT` fields in the constructor:

```js
this.lastMotionDiagnostic = {
  limiter: 'No stop constraint',
  limiters: [],
  leader: null,
  desiredSpeed: 0,
  speedCaps: [],
  acceleration: 0,
  advance: 0,
};
this.stationarySeconds = 0;
this.claimRenewalsWhileStopped = 0;
this.hadClaimDuringStop = false;
```

- [x] **Step 2: Preserve the actual leader in `findLeader`.**

Return the leader reference and measured track with the already-computed gap and relative speed. Normalize lane-change ghosts with `lead.owner || lead`, so the inspector reports the real vehicle while retaining the target lane where its gap was measured. Keep the existing nearest-leader selection for lane changes and route lookahead. For example, the ordinary-track result becomes:

```js
return {
  vehicle: lead,
  gap: gapBetween(this, lead),
  dv: this.v - lead.v,
};
```

Update the lane-change candidate records to carry `vehicle` too. No other caller depends on this return value.

- [x] **Step 3: Record the limits actually applied in `Car.step`.**

At the start of the longitudinal controller, keep the free-speed acceleration as the baseline and collect named candidates as each existing `Math.min` constraint is applied. Use a local helper that preserves the current order and arithmetic:

```js
const accelerationLimits = [];
const constrainAcceleration = (name, value, details = {}) => {
  accelerationLimits.push({ name, kind: 'acceleration', value, ...details });
  a = Math.min(a, value);
};
```

Replace only the existing `a = Math.min(a, candidate)` statements with calls to this helper. Name the candidates `connector-entry-speed`, `leader-following`, `junction-region`, `lane-merge-hold`, `yield`, `unclaimed-stop-line`, and `destination-stop` at their current calculation sites. Keep each candidate's numeric acceleration and any relevant gap, stop position, or target speed. If the free-speed baseline itself is negative because the car exceeds a desired speed, include `speed-target` with that desired speed. After the final acceleration clamp, include every candidate equal to the applied minimum within `1e-6` in `limiters`; report the hard braking clamp if it changes the applied acceleration. Record the physical unclaimed stop-line correction when it clamps position after integration.

Also record the independent `advance` clamp candidates for leader gap, junction-region stop, and lane-merge hold. Mark these records with `kind: 'advance'`, compare only distance values with other advance values, and include all ties within `1e-6` when they clamp the car's per-step advance. Keep the desired speed and final acceleration in the snapshot. Capture speed-target caps such as vehicle/track speed, connector speed, curve speed, pocket approach, and lane preparation in `desiredSpeed` and a separate `speedCaps` list. Include a speed-target limiter only when its acceleration is negative. If no named candidate reduces acceleration or clamps advance, set `limiter` to `No stop constraint`. Preserve the existing candidate order and formulas so recording diagnostics does not alter car movement.

Use a snapshot shaped like:

```js
car.lastMotionDiagnostic = {
  limiter: limiters.length ? limiters.map(x => x.name).join(', ') : 'No stop constraint',
  limiters,
  leader: lead ? {
    id: lead.vehicle.id,
    trackId: lead.vehicle.track.id,
    speed: lead.vehicle.v,
    gap: lead.gap,
  } : null,
  desiredSpeed: vDes,
  speedCaps,
  acceleration: a,
  advance,
};
```

Store a copy of the leader details and candidate values for the last step; do not recompute an explanation later from the current position.

- [x] **Step 4: Track continuous stops and claim renewals.**

At the end of normal movement integration, increment `stationarySeconds` by `dt` while `v < 0.5`; reset it and `claimRenewalsWhileStopped` when the vehicle moves at or above that threshold. In `arbitrate`, when a stopped vehicle receives a claim, count it as a renewal only if `hadClaimDuringStop` is already true; then set `hadClaimDuringStop = true`. Reset `hadClaimDuringStop` when movement resumes. Do not add these properties to `captureCity` or save data.

## Task 2: Select and highlight a vehicle in City mode

**Files:**
- Modify: `game.js` (`W`, `pointerdown`, `drawCars`, world reset/load, and removal cleanup)

**Interfaces:**
- Consumes: `W.tool`, `CAM.toWorld`, live car positions and dimensions, and Task 1 diagnostics.
- Produces: `W.selectedCar`, the selected vehicle's map outline, and a selection lifecycle cleared when the vehicle is removed.

- [x] **Step 1: Add transient selection state.**

Initialize `selectedCar: null` in `W`. Clear it whenever a new city is initialized or loaded, and after dead cars are removed if the selected object is no longer present in `W.cars`.

- [x] **Step 2: Add oriented vehicle hit testing.**

Create `carAtPoint(p)` beside other map hit-test helpers. Skip dead cars and `VISIT` cars, which are not drawn. For each other live car, transform `p - (car.px, car.py)` into the car's local frame using `car.ang`; accept points inside its half-length/half-width expanded by a small screen-space padding (`8 / CAM.z`). If hitboxes overlap, return the nearest car center. This includes visible `ENTER` vehicles, which have a position but no lane track yet.

- [x] **Step 3: Select before City bulldoze handling.**

In `cv`'s `pointerdown`, after pan gestures are handled and before the universal demolish and tool switch, add a left-click-only City-tool branch:

```js
if (W.tool === 'BULLDOZE' && !right) {
  W.selectedCar = carAtPoint(IN.mouse);
  syncUI();
  if (W.selectedCar) return;
}
```

An empty click clears the selection and continues through the existing bulldoze behavior. A hit on a car selects it and returns without bulldozing. Do not intercept clicks in other categories or right-click demolition.

- [x] **Step 4: Draw a clear selection outline.**

In `drawCars`, draw an accent-colored outline around `W.selectedCar` after drawing that car body. Use its rotated vehicle rectangle and a line width scaled by `1 / CAM.z`; retain the selection while it moves.

## Task 3: Show the selected-car inspector

**Files:**
- Modify: `index.html` (City panel)
- Modify: `styles.css` (City panel card)
- Modify: `game.js` (`syncUI` and `updateHUD`)

**Interfaces:**
- Consumes: `W.selectedCar`, its current route/track, `lastMotionDiagnostic`, `waitReason`, `claim`, `claimT`, `stationarySeconds`, and `claimRenewalsWhileStopped`.
- Produces: a live, read-only inspector card with separate arbiter and motion-cause fields.

- [x] **Step 1: Add a hidden card to the City panel.**

Place a section with `id="car-inspector"` below the City panel heading and before the aggregate city statistics. Give it a heading `Selected vehicle` and fixed label/value elements with these IDs: `car-debug-identity`, `car-debug-speed`, `car-debug-stopped`, `car-debug-track`, `car-debug-route`, `car-debug-leader`, `car-debug-claim`, `car-debug-wait`, `car-debug-limiter`, and `car-debug-speed-caps`. Keep the card `hidden` by default.

- [x] **Step 2: Style the card in `styles.css`.**

Match the existing console colors, compact typography, and border treatment used by `.stats` and `.panel-note`. Allow long movement IDs and route details to wrap; keep the card within the sidebar width on mobile.

- [x] **Step 3: Render values with text-only DOM updates.**

Add `renderCarInspector()` in `game.js`. Show the card only when `toolCategory(W.tool) === 'city'` and `W.selectedCar` remains in `W.cars`. Fill the fixed elements by ID with `textContent`; do not interpolate vehicle or route values into `innerHTML`. Format absent leader and claim as `None`, and show `No stop constraint` independently from the arbiter's wait reason. Include the live claim age and the stopped-episode renewal count.

Call the renderer from `syncUI` after category changes, immediately after a vehicle is selected or cleared, and from the existing HUD refresh so the values update while the simulation runs. If the selected vehicle leaves `W.cars`, clear selection and hide the card. For `ENTER` or `VISIT` phases, show the phase and `Not in road traffic` for track, leader, claim, and movement-constraint fields rather than presenting a stale road-motion snapshot as current.

## Self-review against the approved spec

- City-only selection and clear-on-empty behavior: Task 2, Steps 2–3.
- Preserve road/building bulldozing and all other tool clicks: Task 2, Step 3.
- Map highlight and selection lifetime: Task 2, Steps 1 and 4.
- Speed, stopped duration, track, route, next connector, and leader: Tasks 1 and 3.
- Claim age/renewals and separate arbiter wait reason: Tasks 1 and 3.
- Actual movement limiter, ties, no-leader, and no-stop reporting: Task 1, Step 3; Task 3, Step 3.
- Read-only behavior and transient data: Global Constraints and Task 1, Step 4.
- No test additions or runs are included unless the user requests verification.

## Plan self-review

- All files and public diagnostic fields are named consistently across tasks.
- No save-format changes are included.
- The plan contains no placeholder steps or automated test commands.
