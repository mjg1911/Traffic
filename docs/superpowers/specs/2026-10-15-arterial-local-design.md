# Arterial local traffic game

Approved direction: build an offline traffic city-management game for Windows, with Trafficity-inspired visuals and road editing as the primary interaction.

## Local play

- Store the playable game and all required assets in `E:\Traffic game`.
- Provide a double-click Windows launcher that opens the game in the default browser without requiring an installation or Internet connection.
- Preserve `arterial-original.html` as an unmodified archival reference source.

## Road editing

- Place the road controls ahead of city zoning and simulation details.
- Provide separate Straight and Curve drawing modes. Straight mode creates a line between its endpoints. Curve mode retains the original curved-road workflow.
- Preserve junction snapping, connecting endpoints to existing roads by splitting them, road upgrades, signals, roundabouts, and demolition.
- Allow existing curved roads to be reshaped with an explicit bend interaction, avoiding ambiguity between starting a connection and bending a road.
- Provide a visible Grid lock toggle. While enabled, display a world-space grid with 50 world-unit spacing; snap new free endpoints to its intersections and constrain newly drawn straight roads to horizontal or vertical alignment according to the dominant pointer displacement.
- In locked straight mode, snap to an existing junction only when it lies on the constrained axis within the normal snap tolerance. Otherwise retain the constrained endpoint. This prevents snapping from unexpectedly producing diagonal roads.
- Grid lock is optional and independent of the visual theme. Disabling it restores unrestricted road angles and ordinary junction snapping.
- Show the prospective road before committing it, including clear feedback for roads too short to build. Escape cancels the current drawing operation.

## Appearance

- Use the linked Trafficity trailer as visual inspiration: cream terrain, pale road surfaces, clearly visible lane markings, restrained building colours, and small coloured vehicles.
- Retain a top-down view using the existing Canvas 2D renderer.
- Provide Light and Dark theme choices affecting both the map and controls; remember the selected theme locally.
- Keep traffic and junction states legible in both themes. Theme selection is independent of simulated time of day.
- This scope changes the presentation of existing road types; it does not add a new elevated-road or interchange simulation.

## Traffic gameplay

- Preserve the original lane routing, car following, lane changes, junction reservations, zoning and demand model.
- Keep congestion, vehicle count and average trip duration prominent, together with pause and simulation speed controls.
- Offer an initial populated road network so the effect of road changes can be observed immediately, while retaining a new-city option.

## Persistence

- Save and load the authored city locally, including road geometry and types, junction controls, zoning, buildings, simulated time and camera position.
- Reconstruct derived lanes and routing structures when loading. Active vehicles may restart; exact in-flight vehicle state is outside this scope.
- Include explicit Save and Load controls, a recoverable browser-local save, and file export/import for moving or backing up a city.
- Validate imported data before replacing the current city. Invalid or incompatible files produce an understandable message and leave the current city intact.

## Implementation boundaries

- Keep simulation changes targeted. Separate new editing geometry, persistence and theme responsibilities where useful without rewriting the working engine.
- Avoid external runtime dependencies, remotely loaded fonts and remotely loaded assets so offline play remains reliable.
- Inspect the upstream repository's license before distributing any source files derived from the archived reference.

## Verification

- Check straight-road geometry, cardinal axis selection, negative-coordinate grid snapping, junction connection and cancellation.
- Exercise free drawing, road bending, upgrades, removal and roundabouts with active traffic.
- Verify save/load and file export/import round trips, plus malformed import rejection without city loss.
- Inspect light and dark modes in the browser and verify theme persistence after reopening.
- Launch the final game using its Windows launcher and confirm it requires no network resources.

## Delivery

Deliver a playable local game, a double-click launcher and short controls/instructions. Report verified behaviour and any remaining limitations.
