# Clear Buildings Under Roads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove buildings whose footprints intersect road pavement after a road build, upgrade, or reshape.

**Architecture:** Add a city cleanup method that reuses `CITY.overlapsRoad` and `CITY.demolish`. Call it after successful road geometry changes: after a build or reshape, and from the existing `NET.reattachAll` hook used by upgrades and other network rewrites.

**Tech Stack:** Browser JavaScript, existing Node.js test harness.

## Global Constraints

- Preserve the existing building footprint calculation and demolition behavior.
- Keep zoning intact so the vacated cell can develop again when its footprint is clear of pavement.
- Cover road builds, road type upgrades, and reshaping.

---

### Task 1: Clear buildings after road geometry changes

**Files:**
- Modify: `game.js` (`NET.reattachAll`, `CITY`, `reshapeRoad`, and `buildRoad`)

**Interfaces:**
- Produces: `CITY.clearRoadOverlaps()`, which removes every current building for which `CITY.overlapsRoad(building)` is true.
- Uses: existing `CITY.demolish(building)` to release the lot and retire the building's traffic.

- [x] Add `clearRoadOverlaps()` to `CITY`, iterating a snapshot of `this.buildings` and demolishing entries that overlap current road geometry.
- [x] Call cleanup from `NET.reattachAll()` so road upgrades and network rewrites clear covered buildings.
- [x] Call cleanup after a successful `reshapeRoad()` rebuild and after `buildRoad()` has created all road segments.
- [x] Review the diff to confirm failed builds do not demolish buildings and no unrelated working tree changes are included.
