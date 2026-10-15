# Lane connection editing design

## Goal

Let players choose which outgoing lane each incoming lane may reach at a junction. The game continues to generate its current lane-routing defaults until a player edits a particular incoming lane.

## Interaction

Add a **Lane connections** tool to the Junctions panel. The player selects a regular junction to show its incoming and outgoing lanes and the connector paths currently allowed by the game.

The player drags from an incoming lane to an outgoing lane to toggle that movement. Existing automatic connectors are the starting set: dragging an existing connection removes it; dragging a currently unavailable connection adds it. The first change makes only that incoming lane manual. All other lanes at the junction, and all other junctions, retain automatic routing. A **Reset lane** action restores the selected lane's automatic movements.

The game calculates connector curves from the selected lane endpoints. The player does not draw custom curve geometry. Roundabouts remain automatic, and the current restriction on mid-junction U-turns remains in force.

## Traffic behavior

Represent each incoming lane at a node as either automatic or manual. For a manual lane, its stored outgoing lane pairs replace `lanePairs` output for that source lane. Permit multiple outgoing connections, but require at least one valid exit for every manually edited lane. The editor refuses to remove a lane's last exit.

The existing lane-space route finder, mandatory lane changes, signal phase builder, connector conflict calculation, and reservation arbiter continue to operate on `node.connectors`. Rebuilding a junction after a rule change regenerates connectors and derived signal/conflict data from the allowed movements, then requests vehicle rerouting. Vehicles already crossing a connector keep the existing safe-drain behavior.

If road edits invalidate saved movements, discard invalid source or destination lane references and keep remaining valid movements. If an edited lane has no valid saved exits after a road change, remove its manual override and restore automatic routing. Splitting a road transfers lane rules at each original endpoint to the replacement segment connected there. Converting a junction to a roundabout clears its manual lane rules; roundabouts use their existing automatic behavior.

## UI feedback and errors

Show the selected junction's current connector paths clearly while editing, with edited and automatic lanes distinguishable. Hover feedback identifies the incoming and outgoing lanes a drag will connect. The tool explains invalid targets, including clicks outside a junction, roundabouts, and prohibited U-turns, without changing the network. Resetting a lane shows that it has returned to automatic routing.

## Persistence

Store manual lane rules on each node using stable authored identifiers: incoming edge ID, direction, and lane index, plus each allowed outgoing edge ID, direction, and lane index. Do not serialize runtime lane or connector IDs because those objects are rebuilt on load.

Bump the city save format from version 3 to version 4. Migrate version 3 saves by adding an empty manual-rule list to each node. Preserve the existing version 1 and 2 migrations, including priority-road data and zone-grid migration, and add the same empty list so those cities continue with automatic lane rules. Validate that all referenced edges exist and meet at the node, lane indices are valid for the saved road types and directions, source lanes and destinations are unique, and each manual source lane has at least one destination.

## Scope and acceptance

- Keep automatic lane-routing behavior for every unedited lane.
- Allow one lane to connect to multiple outgoing lanes, including movements not selected by the current automatic lane-pair rule.
- Ensure route finding and lane changes never use a disabled connector.
- Preserve the custom choices across save, load, export, and import; older saves use automatic rules.
- In an Avenue example, configure one incoming lane for straight-only and its neighbor for left or right turns. Traffic follows those choices, and the settings survive a save round trip.
- Keep signal controls, priority-road behavior, roundabouts, road construction, and custom connector geometry outside this feature except for the rebuild integration described above.

## Validation approach

Review connector generation, routing and lane changes, signal/conflict rebuilding, reservation safety, save migration and validation, and road-removal, split, upgrade, reversal, and roundabout paths. Automated test changes or runs are outside this request.
