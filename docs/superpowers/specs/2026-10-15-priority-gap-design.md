# Priority-junction arrival-gap design

## Goal

Let a car on a yielding approach turn as soon as its crossing can fit safely between higher-priority traffic. Avoid making it wait just because a higher-priority car is nearby when their paths will not be occupied at the same time.

## Approved approach

Replace the fixed 78-pixel approach-distance gate in `arbitrate()` with an arrival and clearance comparison for the actual conflicting connector movement. Use the existing connector conflict geometry to identify the shared part of each pair of paths, then estimate when each vehicle will occupy that part from its distance, speed, and vehicle length. A higher-priority approach blocks a new request only when its predicted occupancy overlaps the requester’s predicted occupancy, with a conservative safety margin.

Keep active connector claims as hard blockers. Preserve the current priority ranking, exact-route check, signal and stop permissions, exit-lane clearance, and don't-block-the-box checks. Keep the existing deterministic wait-time ordering for equal-priority requests. Do not change traffic signals, route selection, lane sorting, spawning, saves, or interface controls.

## Behavior requirements

- A nearby higher-priority vehicle on a geometrically conflicting route does not block a request when its predicted crossing time leaves a safe gap.
- A higher-priority vehicle predicted to occupy the shared path at the same time continues to block the request.
- A vehicle already claiming a conflicting connector always blocks, regardless of an estimated time window.
- The comparison uses the vehicle's actual next connector, not other possible turns from its lane.
- Shared exit-lane conflicts remain protected through their merge area.
- The requester still needs an open exit lane and must satisfy existing signal, stop, and junction-clearance rules.

## Scope

Modify connector conflict data and the priority/yield portion of `arbitrate()` in `game.js`. Keep movement priority and UI behavior unchanged. Do not add a general fairness scheduler or expose debug controls as part of this fix.

## Validation

Review the conflict intervals and occupancy-time estimate against existing connector construction, vehicle movement, and claim release. Preserve current intersection behavior where an imminent conflicting priority car is present. The existing project plan says automated tests should not be added or run unless the user requests test or verification work.
