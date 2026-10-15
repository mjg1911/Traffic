# Stranded Vehicle Recovery Implementation Plan

**Date:** 15 October 2026

## Goal

Implement the approved recovery behavior without changing save compatibility or counting removed vehicles as completed trips.

## Steps

1. Add a shared lane-change feasibility check using the same lane length, stop-line, IDM buffer, and minimum maneuver distance rules as `executeChange`. Trigger immediate recovery when a required lane change is no longer physically possible.
2. Track no-progress time from actual longitudinal advance for road-traffic phases. Use the approved 5-second threshold for `merge-gap` and the 120-second ceiling for other stalled road-traffic states. Reset after progress or after a route is accepted.
3. Add a one-shot recovery path that asks the router for a safe, different route to the same destination. Preserve an active connector and its reservation while routing from its exit lane. If no changed, feasible route exists, call `kill()` so lane occupancy, claims, and manoeuvres are cleaned up.
4. Record successful reroutes and failed-trip removals as transient diagnostic events, including the vehicle, reason, route attempt, and location. Do not call `CITY.tripDone` or alter save data for a removal.
5. Review all changed paths and run a JavaScript syntax check. Do not add or run tests in this task.

## Review notes

- The implementation belongs in `game.js` and `traffic-diagnostics.js`.
- Existing user edits in the workspace must remain intact.
- No changes to the city JSON schema or trip-completion behavior.
