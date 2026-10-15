# Stranded Vehicle Recovery Design

**Date:** 15 October 2026  
**Status:** Approved

## Goal

Prevent a vehicle from occupying a road forever after it misses a required lane change or otherwise makes no progress for an unexplained reason. Prefer a safe reroute; remove the vehicle when no safe route can recover the trip. Preserve ordinary queues below the hard no-progress ceiling.

## Design

### Detect a stranded vehicle

Treat a vehicle as stranded immediately when its required lane change is no longer physically feasible at its current position, such as when the remaining approach distance is below the lane-change minimum. Do not wait for a gap that can no longer be used.

When the vehicle is still inside a feasible merge window but remains stopped for a merge gap, allow up to **5 simulated seconds without progress** before starting recovery. Reset this timer after meaningful movement or route progress. This short grace allows a brief opening to appear without leaving the vehicle blocking its lane for an extended period.

Add a **120 simulated second** hard no-progress watchdog for every road-traffic phase, including vehicles with a leader or junction wait. This is the final guard against any deadlock or missed blocker classification. It does not apply during `ENTER` or `VISIT`, which are not road-traffic waiting states. The longer ceiling limits false removals during ordinary congestion while ensuring a road vehicle cannot remain stuck forever.

### Recover, then remove if necessary

1. Ask the route planner once for a safe route from the vehicle's current lane and position to the same destination.
2. Accept a route only when it is legal, feasible from the current position, and makes progress beyond the failed route. Reset the stalled episode after accepting it.
3. If no such route exists, remove the vehicle through the existing cleanup path. Do not force a lane change into an unsafe gap.

### Record the outcome

Record a separate failed-trip/despawn event with the reason, vehicle, location, and whether a recovery route was attempted. Do not count it as a completed trip, update building service as if it arrived, or include it in completed-trip duration averages. Keep the data transient; do not change the city-save format.

## Expected behavior

- A same-road destination merge that has become infeasible triggers one safe reroute attempt and then despawns if no legal detour exists.
- A feasible merge blocked by traffic gets at most five simulated seconds of no-progress waiting before the same recovery attempt if the gap does not arrive.
- A valid alternate route keeps the vehicle in the simulation and clears the stalled state.
- Ordinary leader-following and junction waits remain in place below the hard no-progress ceiling.
- A despawn releases the vehicle's lane occupancy, junction claim, and any in-progress manoeuvre through the existing cleanup path.
- Diagnostics distinguish a successful recovery from a failed trip removal.

## Scope

This change covers live road-traffic vehicles in both outbound and return phases. It does not alter routing costs, road capacity, signal timing, save compatibility, or normal trip-completion behavior.

## Acceptance criteria

- A vehicle past the minimum distance for its required destination-lane change cannot remain in the city indefinitely.
- A safe alternate route is adopted when one exists; an infeasible or unchanged route is not retried every frame.
- A vehicle removed after recovery failure no longer occupies its lane or junction and is not counted as a completed trip.
- Ordinary leader and junction waits are allowed up to the hard no-progress ceiling; if the vehicle makes no progress for 120 simulated seconds, recovery runs and it is removed if no safe route exists.
- The recovery event retains enough reason data to diagnose why the vehicle was removed.
