# Direct building placement

Approved in chat on 2026-10-16. Implementation authorized in the current checkout.

## Behavior

Replace zoning with a Buildings category. Select Residential, Commercial, or Industrial and Small, Medium, or Large. Click to place one lot; drag to preview a row on one road side and release to place valid lots. Escape, pointer cancellation, and changing tools cancel the preview. Existing city removal remains available.

Footprints include parking: Small 4 wide by 3 deep with one space, Medium 6 by 4 with four spaces, Large 8 by 8 with sixteen spaces. A separate building tile is 15 world units (5 displayed metres). Parking capacity is visual in this version; one driveway per lot serves the existing trip lifecycle.

Lots are rigid rectangles. The frontage follows the tangent of the closest road at the driveway. A two-world-unit setback separates the front boundary from pavement. Drag spacing starts at frontage plus three world units, measured along the road; each candidate is checked individually, allowing gaps on tight bends. Reject road intersections, building overlaps, water intersections, world-boundary violations, and entrances too near junctions or turning pockets. Preview and commit use the same geometry and validation.

## Architecture

Add a dependency-free browser/CommonJS `building-placement.js` module for presets and oriented-rectangle/road-corridor geometry. Keep live road selection, attachment, pointer input, and trip integration in `game.js`. Preserve the current routing, movement, lane changing, junction reservation, and car/truck code.

Buildings store fixed width, depth, angle, size key, parking count, and road entrance. Their lane address is derived from the entrance; attachment must never translate or resize the lot. Two-way roads connect to the adjacent kerb lane. One-way roads use the lane nearest the chosen kerb and retain legal travel direction. Do not attach to roundabout rings or bridges. Disconnect a lot when no legal nearby access remains; retain it and suspend its trips. Remap access after road splits, upgrades, reversals, or reshapes.

Remove automatic development, level growth, and abandonment. Retain service and trip statistics. Size multipliers initially use 1/3/8; residential capacity is 9/27/72, commercial jobs 8/24/64, industrial jobs 13/39/104. Apply multipliers to residential/freight trip frequency and destination selection weight. Keep time-of-day demand, existing trip kinds, trucks, return journeys, and the global vehicle limit.

Protect fixed lots from road edits. Reject new/changed road geometry that overlaps lots before touching live roads or vehicles. Include widened junction and turning-lane geometry in validation; road deletion may disconnect lots. Keep the existing road-edit rules otherwise.

## Persistence and startup

Save format version 5 stores authored lot geometry and driveway position, plus service and trip counters. Derived lane objects are never serialized. Old version 1–4 saves remain accepted and migrate to fixed legacy lots preserving their position, footprint, level-derived capacity, and appearance. Legacy lots do not acquire oversized parking areas. Ignore old painted empty zones after migration. Validate new fields and references before replacing the live city; preserve current invalid-import behavior. The starter city uses the same placement API as players.

## Validation

Cover nine presets; both sides of straight, diagonal, curved, and one-way roads; complete lot collision including parking; junction/pocket clearance; deterministic drag spacing and cancellation; fixed geometry after network edits; no automatic construction/abandonment; size-sensitive traffic; outbound and return trips; version 5 round trips and legacy import. Run relevant existing save, road, junction, and traffic suites. Inspect the live browser in both themes and verify actual clicking and dragging.
