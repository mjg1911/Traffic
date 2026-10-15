# Priority-junction arrival-gap design

## Goal

Let a car on a yielding approach turn as soon as its crossing can fit safely between higher-priority traffic. Avoid making it wait just because a higher-priority car is nearby when their paths will not be occupied at the same time.

## Approved approach

Record the current junction-wait reason on each car so the exact rejection is inspectable through the existing `ARTERIAL` state. Replace the fixed 78-pixel approach-distance gate in `arbitrate()` with an arrival and clearance comparison for the actual conflicting connector movement. Use connector geometry to identify the shared parts of each pair of paths, then estimate when each vehicle will occupy those parts from its distance, speed, and vehicle length. A higher-priority approach blocks a new request only when its predicted occupancy overlaps the requester’s predicted occupancy, with a conservative safety margin.

Keep active claims in the existing reservation lifecycle, but use the car's position and rear clearance against the shared path interval when deciding whether another movement is blocked. This lets a car release a crossing area after its rear has passed that area, even while it finishes the rest of the connector. Preserve the current priority ranking, exact-route check, signal and stop permissions, exit-lane clearance, and don't-block-the-box checks. Keep the existing deterministic wait-time ordering for equal-priority requests. Do not change traffic signals, route selection, lane sorting, spawning, saves, or interface controls.

## Behavior requirements

- A nearby higher-priority vehicle on a geometrically conflicting route does not block a request when its predicted crossing time leaves a safe gap.
- A higher-priority vehicle predicted to occupy the shared path at the same time continues to block the request.
- A vehicle blocks while its body or predicted reservation occupies the shared path interval; it stops blocking after its rear clears that interval.
- The comparison uses the vehicle's actual next connector, not other possible turns from its lane.
- Shared exit-lane conflicts remain protected through their merge area.
- The requester still needs an open exit lane and must satisfy existing signal, stop, and junction-clearance rules.
- Each car exposes a concise junction-wait reason, including priority traffic, an active conflict, a blocked exit, a lane mismatch, or a request that is too early.

## Scope

Modify connector conflict data, per-car wait diagnostics, and the priority/yield portion of `arbitrate()` in `game.js`. Keep movement priority and UI behavior unchanged. Do not add a general fairness scheduler or new interface controls as part of this fix.

## Validation

Add regression coverage for a safe priority gap, an imminent conflicting movement, and a car whose rear has cleared the shared path interval. Review the conflict intervals and occupancy-time estimate against connector construction, vehicle movement, and claim release. Preserve existing signal, stop, and exit-clearance behavior.
