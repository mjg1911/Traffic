# Just-in-time Junction Reservations Implementation Plan

> **For agentic workers:** Use inline execution in this session. Keep the current workspace because it contains existing user edits that must be preserved.

**Goal:** Stop queued vehicles from reserving conflicting junction movements before they can enter.

**Architecture:** Keep the current signal and junction arbiter. Narrow its request eligibility so only the lead car on an inbound lane may reserve, and only within a speed-aware stopping distance of the stop line. Preserve conflict arbitration, downstream clearance, and stop-line braking.

**Tech Stack:** Vanilla JavaScript, Canvas simulation, existing Node-based harness (not used unless the user asks for test or verification work).

## Global Constraints

- Preserve the user's uncommitted UI edits in `README.md`, `game.js`, `index.html`, and `styles.css`.
- Do not change signal timing, turn phases, traffic spawning, lane routing, or save data.
- Keep conflict and outbound-lane clearance checks in the junction arbiter.
- Do not add or run automated tests unless the user requests test or verification work.

---

### Task 1: Restrict junction reservations to vehicles ready to enter

**Files:**
- Modify: `game.js`, inside `arbitrate(cars)` near the 130-pixel approach-distance check.

**Interfaces:**
- Consume each car's existing `track`, `s`, `v`, `len`, `toEnd`, and its lane's `leaderAfter(s, skip)` method.
- Preserve the existing `car.claim` connector reservation and `node.occ` accounting.

- [x] **Step 1: Confirm the approach lane is clear ahead of the requester.** After confirming the car is on `nt.fromLane`, skip it when `c.track.leaderAfter(c.s, c)` returns a vehicle. The track's vehicle list is rebuilt in ascending `s` order before `arbitrate`, so this leaves only the lead vehicle on that inbound lane eligible to request.

- [x] **Step 2: Replace the fixed 130-pixel request window with a speed-aware stopping range.** Calculate:

  ```js
  const stoppingRange = Math.max(
    CFG.STOPLINE + c.len + CFG.IDM_S0,
    (c.v * c.v) / (2 * CFG.IDM_B) + c.len / 2 + CFG.STOPLINE + CFG.IDM_S0
  );
  ```

  Skip the request when `dist > stoppingRange`. This uses the vehicle's current speed and braking limit, and keeps a minimum range so a stopped vehicle at the line can still request.

- [x] **Step 3: Review the surrounding arbiter flow.** Confirm the signal permission, conflict occupancy, outbound-lane clearance, connector occupancy, and claim accounting checks still run unchanged after eligibility filtering. Confirm the stop-line brake in `Car.step` still holds cars without a claim.

**Completion check:** Review the final diff and `git diff --check`. Do not run the automated test suite unless the user requests verification.
