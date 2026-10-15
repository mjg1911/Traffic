# Connector-clearance merge deadlock recovery

## Problem

A vehicle can enter an outgoing lane while its rear still occupies the junction connector. `claimClearing` retains the connector reservation until the vehicle advances by half its length. During that period, `considerLaneChange()` skips lane changes. If the vehicle's route requires a different lane and `laneMergeStopS()` holds it before it has moved far enough to clear the connector, it cannot move forward or begin the required lane change.

The selected-vehicle panel showed this state: road 55 lane 1, target lane 0 at `s 23.8`, no route leader, a live claim for connector road 62 lane 1 to road 55 lane 1, and a lane-merge hold with zero gap. The general no-progress recovery waits 120 seconds before trying an alternate route; this accounts for the car disappearing after roughly 125–130 simulated seconds.

## Behavior

- Despawn a road-traffic vehicle after five simulated seconds with no actual forward progress only when all of these are true:
  - The vehicle is on an outgoing lane and `claimClearing` is still active.
  - The vehicle still needs a different lane.
  - Its last motion constraint is `lane-merge-hold`.
  - It has not advanced far enough for its rear to clear the connector.
- Record the failed trip with a specific connector-clearance merge-deadlock reason, then use the normal vehicle cleanup path so lane occupancy and junction reservations are released.
- Do not attempt another route for this exact deadlock; the approved behavior is to remove the trapped vehicle after the short timeout.
- Keep the existing 120-second no-progress recovery for all other road-traffic stalls.
- Do not despawn vehicles merely for waiting at signals, stop lines, or behind other traffic. Those states do not satisfy the specific clearance and lane-merge conditions above.

## Diagnostics and validation

The removal should use the existing trip-failure diagnostics and include the vehicle ID, simulation time, destination, current track and position, and a stable reason code. Review the motion-diagnostic limiter selection and claim-clearing lifecycle to ensure the trigger matches only the described deadlock. The implementation should receive a focused code review and a JavaScript syntax check; do not alter saves or trip-completion counts.

## Scope

This change is limited to stranded-vehicle handling in `game.js`. It does not change signal timing, general no-progress thresholds, routing costs, save data, or traffic behavior for ordinary queues.
