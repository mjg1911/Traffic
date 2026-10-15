# Selected car diagnostics design

## Problem

The lane debug overlay combines lane intent, junction reservation, and wait status in one short label. When a car is stationary but holds a connector claim, the fallback label says `reserved`; it does not identify the movement constraint that is actually keeping the car still. This makes a car with no visible traffic ahead difficult to diagnose.

## Goal

Let a player inspect one live vehicle and see the simulation state that explains its movement, especially the constraint that limited its movement on the most recent simulation step.

## Interaction

- Vehicle selection is available only while the City category is active. This category currently uses the bulldoze tool.
- A left click on a vehicle selects it before bulldoze handling. Clicking a different vehicle changes the selection.
- A left click on empty map clears the selection and continues through the existing City-tool behavior.
- Clicks in other categories retain their current behavior.
- The selected vehicle is highlighted on the map. The selection follows that vehicle as it moves.
- If the selected vehicle leaves the live vehicle list, clear the selection and hide its inspector.
- The inspector is read-only in this version. It has no replan, reservation-release, or simulation-control actions.

## Inspector contents

Show a compact card in the City panel only while a vehicle is selected. Update it with live simulation state and include:

- Vehicle identity, type, simulation phase, current speed, and time continuously stopped.
- Current track/lane, route target, intended lane, and next connector/movement.
- The nearest route leader, if any: vehicle identity, current track, gap, and speed.
- Current junction claim, connector identity, claim age, and how often the claim has been granted again while the vehicle remains stopped.
- The arbiter's wait reason, kept separate from the vehicle's motion constraint.
- The movement constraint that most limited acceleration or advance on the last simulation step. Record the actual active candidates in `Car.step`, including leader following, an unclaimed stop line, a junction conflict hold, a lane-merge hold, a destination stop, yielding, and a speed target cap such as a curve or lane-preparation limit. Show ties when multiple constraints clamp movement equally; show `No stop constraint` when no active constraint holds or slows the vehicle.

The selected vehicle's computed movement constraint is the primary diagnostic. The panel must not infer that `reserved` is the reason for stopping merely because the vehicle has a claim.

## Implementation shape

- Store the selected vehicle by object identity in the world state and perform a small-radius hit test against interpolated vehicle positions when City-tool clicks occur.
- Capture the last-step movement diagnostics during the existing movement calculation, rather than recomputing a simplified explanation in the panel. Preserve the leader reference and gap used by the controller.
- Track continuous stopped time and claim re-grants while stopped as transient vehicle diagnostics; do not add them to city save data.
- Render the selection highlight on the canvas and render the inspector in the existing City panel. Keep the aggregate city statistics available.

## Acceptance criteria

1. In City mode, clicking a visible car selects and highlights it without bulldozing anything; its inspector updates as it moves.
2. Clicking empty map clears the inspector. Existing bulldoze behavior for roads and buildings remains available in City mode.
3. Clicking a car in any other category does not change the existing tool behavior.
4. A stationary selected car reports continuous stopped time, current route and claim state, and the actual active movement constraint from its latest simulation step.
5. A car can show both an active connector claim and a different movement constraint, such as a downstream leader or destination stop.
6. The inspector distinguishes arbiter wait reason from movement constraint and reports no leader when the route scan finds none.
7. Selection and diagnostic counters are transient and do not affect city save files or vehicle behavior.

## Out of scope

- Controls that change a vehicle's route, reservation, speed, or lifecycle.
- A global vehicle-selection mode or selection in other tool categories.
- Replacing the existing lane-routing overlay or adding dense labels for every vehicle.
