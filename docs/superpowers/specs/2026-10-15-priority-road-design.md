# Priority road junction design

## Goal

Add a junction option that lets the player choose which road approaches have right of way.

## Approved interaction

Add a **Priority road** tool to the Junctions panel. With it selected, the player clicks an incident road arm near a junction with three or more arms. Each selected arm has priority; the player can select multiple arms, including both sides of a through road. Clicking a selected arm removes its priority. If the last selected arm is removed, the junction returns to yield control.

The existing **Traffic signals** tool remains the way to cycle signal, stop, and yield control. Using it on a priority junction clears the selected arms and switches the junction to signals. Roundabouts keep their existing behavior.

## Traffic behavior

At a priority junction, selected approaches rank above every unselected approach. Selected approaches have equal priority with one another. Unselected approaches yield when a conflicting selected approach is approaching. Existing connector conflict reservations, stop-line handling, and outbound-lane clearance remain in force. The current lane-count-based priority at ordinary yield junctions and roundabout ring priority stay unchanged.

Show a priority-road marker on selected approaches and yield markers on the others. Hovering with the Priority road tool highlights the road arm and junction that will be changed. Invalid clicks explain that the player should click a road arm near a junction.

## Data and persistence

Store the selected incident edge IDs on each node. Save format version 3 includes this list and permits the `PRIORITY` control. Migrate version 2 saves by adding an empty list, and preserve the existing version 1 migration to the current map dimensions while also adding the list. Validate that selected IDs are unique, reference existing non-ring edges incident to the node, and are present only for a priority-controlled junction.

Removing a selected road removes its ID; an empty selection returns to yield. Splitting a selected road transfers its priority designation to the replacement arm at each original endpoint.

## Scope and constraints

- Keep the feature in the existing vanilla JavaScript and Canvas architecture.
- Preserve the current signals, stop, yield, roundabout, and reservation behavior.
- Update the Junctions panel, usage hint, README, and save migration.
- Do not add or run automated tests for this request.
