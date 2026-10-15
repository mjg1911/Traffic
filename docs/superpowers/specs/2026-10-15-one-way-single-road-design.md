# One-Way Single Road Design

Date: 2026-10-15

## Goal

Add a one-lane road that carries traffic in one direction, while keeping the existing two-lane One-way road available.

## Player experience

Add **One-way single** to the road type palette and Q-key cycle. It has one travel lane and follows the direction in which it is drawn. Its road surface uses the existing one-way arrow markings. Its speed matches the current One-way road. The narrower width follows the existing one-way width calculation for a single lane.

In Upgrade mode, clicking a One-way single road while One-way single is selected reverses its direction. Selecting another road type upgrades it as before. The existing two-lane One-way road keeps its current behavior.

## Implementation boundaries

- Add a `ONEWAY_SINGLE` road type with one lane and one-way routing.
- Add its palette card and include it in the keyboard road-type cycle.
- Extend one-way reversal to the new type while preserving the road's shape and refreshing junctions and building access.
- Update city-save validation to accept the type, enforce its one-way lane-direction rules, and preserve it as a selected road type. Keep the current save version; existing saves remain valid.
- Use the existing lane, connector, rendering, and traffic systems. Do not add a separate simulation path.
- Update the README road controls to describe the new road and reversal behavior.

## Success criteria

- A player can draw and upgrade to a one-lane road that permits traffic only in its authored direction.
- The road width, lane routing, arrow markings, junction connections, and traffic use the existing road-type-driven systems.
- The matching Upgrade selection reverses direction without changing the drawn curve.
- The type and direction survive save, load, import, and export; existing city saves still load.
- Automated tests are not added or run for this request.

## Validation scope

Review the road registry, tool palette and cycling, reversal handler, city-save type and lane validation, and README text. Do not run automated tests under the current project instruction.
