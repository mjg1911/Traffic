# Larger playfield and WASD navigation

## Goal

Give the traffic workshop a substantially larger, explorable city while keeping its existing road-building workflow and saved cities usable.

## Approved direction

- Expand the playable world from 3,000 × 2,000 to approximately 4,800 × 3,200 world units.
- Expand the starter network from 12 junctions to approximately 20 junctions, retaining one missing connection as the first road-building experiment.
- Place the expanded starter town around the world center and zone its blocks so traffic and development remain visible immediately. Start new and restarted cities at no less than 0.7 zoom; the Fit control continues to frame the full network.
- Add continuous WASD camera panning. Keep Space-drag, middle-button drag, Shift-drag, wheel zoom, the zoom buttons, and Fit available.
- Keep the current UI arrangement and visual style.
- Preserve existing version-1 local saves and exported cities by expanding their zoning grid while keeping authored roads, buildings, camera, settings, and river geometry intact.

## Interaction and camera behavior

Holding W, A, S, or D moves the camera north, west, south, or east. Diagonal movement is normalized so it is not faster than a single direction. Movement is scaled by elapsed frame time and zoom so it stays smooth and usable at different zoom levels. The camera target remains within the expanded world bounds plus the current off-map margin used by drag panning.

Camera movement is ignored while a text-editing control has focus or a modifier key is held. Releasing keys or leaving the window clears the held-key state so the camera cannot become stuck moving. Since D is already the lane-overlay shortcut, move that shortcut to L so D can pan east; the Lanes button remains available. The bottom navigation hint and canvas accessibility label mention WASD alongside the existing pan and zoom controls.

## World and starter city

Increase the world bounds and update any world-sized geometry or placement logic that assumes the old dimensions, including river generation, terrain decoration, zoning dimensions, camera limits, and save validation. Generate a 4-column-by-5-row starter junction grid with road spacing scaled up from the current layout. Keep the deliberate missing road connection and distribute residential, commercial, and industrial zones across the starter blocks. Center the initial camera on the starter city at a zoom of at least 0.7; retain Fit as the way to frame the entire city.

## Save compatibility

The current version-1 save format stores a flat zoning array sized for the 3,000 × 2,000 world. Bump the save format to version 2 for the expanded map. When reading a version-1 save, map each old cell by its old `(column, row)` coordinate into the corresponding location in the new grid, leave new cells unzoned, and remap each building's cell index. Preserve the save's other authored data. Version-2 saves use the expanded zone count. Validation must reject malformed version-1 or version-2 data before live city state is changed.

## Implementation boundaries

- Keep the traffic model and road-editing geometry unchanged.
- Make world dimensions the shared source of truth for the canvas world, city zoning grid, terrain, and camera bounds.
- Keep save migration in the persistence layer and perform it before restoring live state.
- Keep keyboard state and camera movement in the existing input/render loop; do not add a dependency or a separate navigation subsystem.

## Acceptance criteria

- A new city contains a visibly larger, fully connected starter network with the familiar missing-link experiment and active traffic.
- The expanded map has usable land around the starter town, and the camera can pan through that area with WASD.
- Diagonal WASD movement is normalized, movement is smooth across frame rates and zoom levels, and blur/key release stops movement.
- Existing pan, zoom, Fit, drawing shortcuts, and text-entry behavior continue to work.
- The lane overlay remains available from its button and uses L as its keyboard shortcut so D is reserved for eastward panning.
- A version-1 save migrates to version 2 while preserving its original roads, buildings, zones, city settings, camera, and river; the expanded outer land starts unzoned.
- Version-2 saves restore and reopen using the expanded zoning layout.
- Malformed or unsupported saves are rejected without replacing the current city.
- The game remains fully local and keeps its existing visual presentation.
