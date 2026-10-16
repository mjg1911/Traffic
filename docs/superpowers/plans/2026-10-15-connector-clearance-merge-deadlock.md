# Connector-clearance merge deadlock recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove a vehicle after five seconds only when its own lane-merge hold prevents it from clearing a junction connector.

**Architecture:** Add a narrow predicate to the existing road-traffic no-progress handling. The predicate requires an active connector-clearance claim, a required lane change, the lane-merge-hold motion limiter, and a position before the vehicle can clear the connector. Record the failed trip and use the existing `kill()` cleanup; leave the 120-second fallback unchanged for other stalls.

**Tech Stack:** Browser JavaScript, Node.js syntax checker.

## Global Constraints

- Despawn a road-traffic vehicle after five simulated seconds with no actual forward progress only when all of the design's connector-clearance merge-deadlock conditions are true.
- Record the failed trip with a specific connector-clearance merge-deadlock reason, then use the normal vehicle cleanup path so lane occupancy and junction reservations are released.
- Do not attempt another route for this exact deadlock; remove the trapped vehicle after the short timeout.
- Keep the existing 120-second no-progress recovery for all other road-traffic stalls.
- Do not despawn vehicles merely for waiting at signals, stop lines, or behind other traffic.
- Do not alter saves or trip-completion counts.
- Do not add or run automated tests unless the user asks for tests or verification; perform the requested JavaScript syntax check.

---

### Task 1: Despawn only the connector-clearance merge deadlock

**Files:**
- Modify: `game.js`

**Interfaces:**
- Consumes: `Car.claimClearing`, `Car.track`, `Car.wantIdx`, `Car.s`, `Car.len`, `Car.noProgressSeconds`, and `Car.lastMotionDiagnostic.limiter`.
- Produces: `Car.despawnFromStrand(reason)`, which records one failed-trip diagnostic with `recoveryAttempted: false` and invokes `kill()` to release the claim and track occupancy.

- [x] **Step 1: Add a direct stranded-vehicle removal helper in `Car`.**

Place this method beside `recoverFromStrand()`:

```javascript
despawnFromStrand(reason) {
  if (this.dead || !this.track) return false;
  const source = this.track;
  trafficDiagnostics.recordTripFailure({
    vehicleId: this.id,
    destinationId: this.target?.id ?? null,
    simTime: W.time,
    phase: this.phase,
    reason,
    recoveryAttempted: false,
    trackId: source.id,
    trackLabel: diagnosticTrackLabel(source),
    s: this.s,
  });
  this.kill();
  return true;
}
```

Do not call `CITY.tripDone`.

- [x] **Step 2: Add the targeted five-second timeout.**

Define `CONNECTOR_MERGE_DEADLOCK_SECONDS = 5` alongside the other recovery thresholds. After `noProgressSeconds` is updated in `Car.step()`, and before the existing merge-gap and 120-second checks, evaluate this exact predicate:

```javascript
const connectorMergeDeadlock = this.claimClearing &&
  this.track?.kind === 'LANE' &&
  this.wantIdx !== null && this.wantIdx !== this.track.idx &&
  this.s < this.len / 2 &&
  this.lastMotionDiagnostic?.limiter === 'lane-merge-hold';
if (connectorMergeDeadlock &&
    this.noProgressSeconds >= CONNECTOR_MERGE_DEADLOCK_SECONDS) {
  this.despawnFromStrand('connector-clearance-merge-deadlock');
  return;
}
```

The position check means the vehicle cannot yet release its connector claim by moving forward. The limiter check excludes cars stopped by a leader, signal, stop line, or junction arbitration. Return immediately after removal so later `Car.step()` logic cannot use the removed vehicle.

- [x] **Step 3: Preserve unrelated stall handling.**

Leave `MERGE_GAP_RECOVERY_SECONDS` and `ROAD_NO_PROGRESS_RECOVERY_SECONDS` unchanged. Review the final predicate against `considerLaneChange()`, `releaseClaim()`, and `Car.step()` to confirm it cannot match a vehicle waiting before a junction or one blocked by a traffic queue.

- [x] **Step 4: Check JavaScript syntax.**

Run: `node --check game.js`

Expected: exit code 0 with no output. Do not run the automated test suite.
