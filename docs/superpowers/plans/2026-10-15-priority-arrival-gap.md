# Priority-junction arrival-gap Implementation Plan

> **For agentic workers:** Use inline execution in this session. Complete each task in order and review the diff before committing.

**Goal:** Let yielding traffic use safe gaps on priority roads and stop blocking a movement once the conflicting path segment is clear.

**Architecture:** Extend each connector's existing conflict matrix with one or more paired arc-length intervals for the physical overlap. The arbiter will compare predicted occupancy intervals for approaching and claimed movements, retain the current safety checks, and record a reason on each waiting car for inspection through `ARTERIAL`.

**Tech Stack:** Vanilla JavaScript, Node.js built-in test runner, existing VM-based game harness.

## Global Constraints

- Preserve priority ranking, signal phases, stop rules, route selection, exit clearance, save format, traffic generation, and UI behavior.
- Preserve the existing claim lifecycle for the car's own connector; shorten only the time a conflicting connector is held by physical overlap.
- Keep shared exit-lane conflicts protected through the merge area.
- Add no new dependencies.

---

### Task 1: Store physical conflict intervals

**Files:**
- Modify: `game.js` (`Connector` and `computeConflicts`)
- Test: `tests/intersections.test.cjs`

**Interfaces:**
- Each connector exposes `conflictZones`, a `Map` from another conflicting connector to an array of paired arc intervals: `{ start, end, otherStart, otherEnd }`.
- Recompute the map whenever `computeConflicts(node)` rebuilds the existing boolean conflict matrix.

- [ ] Add a failing geometry test that confirms a crossing pair has paired intervals in both directions and a non-conflicting pair has none.
- [ ] Run `node --test --test-name-pattern="conflict zone intervals" tests/intersections.test.cjs`; confirm the new assertion fails before implementation.
- [ ] Derive connected overlap intervals from the existing path samples and `CFG.CONFLICT_R`; expand each interval by half a sample step and keep separate zones when two paths cross more than once.
- [ ] Keep `Connector.conflicts` unchanged so signal phase construction and existing route checks retain their current inputs.
- [ ] Run the geometry test and the existing crossing/clearance geometry tests.

### Task 2: Compare predicted occupancy and expose wait reasons

**Files:**
- Modify: `game.js` (`Car` diagnostics and `arbitrate`)
- Test: `tests/intersections.test.cjs`

**Interfaces:**
- Each car exposes `junctionWaitReason`, reset each arbitration pass and set to a stable code when a request is denied.
- Add helpers that predict a vehicle's entry and rear-clear times for one conflict interval using its current position, speed, speed limit, and length.

- [ ] Add failing tests for a priority car inside the old 78-pixel window that arrives after the requester clears, and for an imminent higher-priority car whose predicted occupancy overlaps.
- [ ] Add a failing test that places a claimed car beyond the rear-clear point of a conflict interval and confirms it no longer blocks that movement; retain a case where the car still overlaps the interval and blocks.
- [ ] Run the targeted priority-gap and occupancy tests and confirm they fail for the current fixed-distance/full-connector rules.
- [ ] Replace the fixed `YIELD_LOOK` rejection with time-window overlap checks for the actual next connector of the lead car on each conflicting approach.
- [ ] For claimed or active connector traffic, compare current body overlap or predicted reservation occupancy against the paired conflict interval; keep `node.occ` accounting for each car's own connector claim.
- [ ] Set clear wait reasons for lane mismatch, lane movement, queued lead, request too early, signal/stop denial, draining connector, conflicting claim, priority traffic, blocked exit, and same-connector occupancy.
- [ ] Run the focused tests, then `node --test tests/intersections.test.cjs`.

### Task 3: Review and publish

**Files:**
- Review: `game.js`, `tests/intersections.test.cjs`, and this plan/spec

- [ ] Run `node --test tests/*.test.cjs`; compare failures with the 10 failures observed before changes (8 intersection tests and 2 city-save tests).
- [ ] Run `git diff --check` and inspect the complete diff for unrelated changes.
- [ ] Commit the implementation and regression coverage on `codex/priority-arrival-gap`.
- [ ] Push that branch to `origin` and report the branch and commit.
