# Clear buildings under roads

## Problem

Building placement already checks a building's rendered footprint against road pavement. Existing buildings are not checked after the road network changes, so a newly built, upgraded, or reshaped road can leave a building inside the road surface.

## Design

Reuse `CITY.overlapsRoad(building)` to check the complete building footprint against the current road network. Add a city cleanup method that demolishes each overlapping building through `CITY.demolish`, preserving the zone and clearing the occupied cell and associated traffic. Run the cleanup after successful road builds, upgrades, and reshapes, once the final road geometry is available.

The existing development check remains in place, so a cleared zoned lot can develop again only where its building footprint stays clear of pavement.

## Scope

This change covers road builds, road type upgrades, and reshaping. It does not change road validation, building geometry, zoning, or save formats.

## Acceptance criteria

- A successful road build removes any existing building whose footprint intersects road pavement.
- Upgrading a road or reshaping it also removes any building that the resulting road geometry covers.
- A building outside the resulting road pavement remains in the city.
- Demolished buildings release their occupied lot, and the zone remains available for later development.
