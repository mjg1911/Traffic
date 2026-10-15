# House placement near roads

## Problem

Residential buildings can be generated on pavement near junctions. Development attaches a building to one nearby road segment and offsets it from that segment, but does not check whether the resulting building footprint overlaps another road.

## Design

After attaching a newly developed building to its access road, check its rendered, rotated rectangular footprint against every road in the network. Treat each road as its centerline plus its paved half-width. Reject the candidate if the footprint intersects any road; otherwise add the building as usual. This retains normal curb access while preventing a junction-side placement from landing on crossing pavement.

## Scope

This change applies to newly generated buildings. It does not change zoning, road construction, save-file validation, or existing building relocation behavior.

## Acceptance criteria

- No newly developed building footprint intersects a road surface, including at a junction.
- A safe roadside candidate can still develop and retain road access.
- The regression test reproduces the junction case that currently places houses on crossing roads.
