# Junction reservation design

## Goal

Prevent cars waiting in an approach queue from reserving conflicting junction movements before they can enter, which can leave another car stopped at a green light.

## Approved approach

Only the lead vehicle on each inbound lane may request a connector reservation. It may request one only when it is within a speed-aware stopping-distance window of the stop line. The window uses the vehicle's speed, the simulation's braking limit, and a small clearance margin, with a minimum range so a stopped car at the line can still request.

Keep the existing signal-phase permission, connector conflict checks, and downstream-lane clearance check. Keep the current stop-line behavior for cars without reservations. Do not add protected turn phases or change spawn rates as part of this fix.

## Behavior requirements

- A car with another vehicle ahead on its inbound lane cannot hold a connector reservation.
- A lead car outside its stopping-distance window cannot hold a reservation.
- A lead car inside the window can reserve only when its signal phase allows the movement, no conflicting connector is occupied, and the outbound lane has room.
- Existing conflict and don't-block-the-box safety checks remain in force.
- Existing signal timing and lane routing remain unchanged.

## Scope

Modify junction request eligibility in `game.js`. Add no interface controls, signal phases, traffic generation changes, or persistence changes.

## Validation

Review the reservation eligibility flow and the existing simulation behavior around stop lines, lane vehicle ordering, and claim release. Automated tests are not included unless the user requests test or verification work.
