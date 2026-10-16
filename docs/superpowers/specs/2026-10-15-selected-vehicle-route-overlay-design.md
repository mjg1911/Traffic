# Selected vehicle route overlay

## Goal

When a vehicle is selected in the City tool, make its current trip easier to understand by showing where its active leg starts, where it is going, and the route it intends to take.

## Design

- Keep the overlay limited to the currently selected vehicle, so it does not clutter the city view.
- Draw a subtle dotted line along the vehicle's remaining planned route, using the actual lane and junction connector paths from its live route. Start at the vehicle's current position and end at its active target.
- Mark the active leg's departure building and target building with visually distinct circles.
- On the outbound leg, departure is the trip origin and target is the destination. On the return leg, departure is the destination and target is the origin.
- Follow live reroutes and vehicle movement. Clear the overlay when selection is cleared or the vehicle leaves the simulation.
- During entry or visit phases, retain the endpoint circles but omit the route line when there is no active road route.
- Keep the overlay read-only and independent of saved city data.

## Acceptance criteria

1. Selecting a vehicle in the City tool shows a dotted path following its current planned lanes and junction connectors.
2. The path starts at the vehicle's current map position and ends at the active trip target.
3. Distinct circles identify the current leg's departure and target buildings, including when the vehicle is returning.
4. A live route change updates the line without requiring the user to reselect the vehicle.
5. Clearing or losing the selected vehicle removes the overlay.
6. Entry and visit phases show endpoint circles without a stale or fabricated route line.
7. Other vehicles and unselected map content remain unchanged.

## Scope

This applies to the existing selected-vehicle diagnostics in the City tool. It does not add pedestrian entities, route controls, save data, or a global route-display mode.
