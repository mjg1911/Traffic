# Building Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Replace automatic zoning with direct, size-aware building placement while preserving traffic simulation.

**Architecture:** Pure placement geometry and presets live in `building-placement.js`. `game.js` integrates fixed lots, kerb addresses, input, drawing, startup, and traffic; `city-save.js` validates and migrates authored geometry.

**Tech Stack:** Plain JavaScript, Canvas, HTML/CSS, Node's built-in test runner; no new dependencies.

## Global Constraints

- Work in `E:/Traffic game`; preserve pre-existing uncommitted changes in `game.js` and the two untracked plans.
- Footprints include parking: Small 4×3/1 space, Medium 6×4/4 spaces, Large 8×8/16 spaces.
- One building tile is 15 world units (5 displayed metres); size multipliers are 1/3/8.
- Buildings stay fixed; disconnected buildings stay in the city and generate no traffic.
- Keep traffic routing, movement, junctions, vehicle types, return trips, and vehicle limits.
- Save versions 1–4 remain importable; version 5 removes zone-cell ownership requirements.
- Any delegated work uses `gpt-6-luna`, reasoning `xhigh`, never `max`.

## File structure

- Create `building-placement.js`: presets, footprint corners, rectangle intersection, road-corridor intersection, point hit testing, lot generation along a path.
- Modify `game.js`: Building/CITY, road edit preflight, simulation calls, pointer gestures, rendering, starter population, capture/restore.
- Modify `index.html`, `styles.css`: script loading and Buildings controls.
- Modify `city-save.js`: version 5 validation and legacy migration.
- Modify `tests/harness.cjs`: load the pure module before game code.
- Create `tests/building-placement.test.cjs`, `tests/buildings.test.cjs`; update old zoning-specific assertions to the new behavior.
- Modify `README.md`: direct placement, parking, saves, shortcuts.

### Task 1: Pure geometry and presets

**Files:** `building-placement.js`, `tests/building-placement.test.cjs`.

**Interface:** browser global/CommonJS `BuildingPlacement`; `TILE=15`, `GAP=3`, `SETBACK=2`; `SIZES.S/M/L={width,depth,parking,multiplier}` in world units. `corners(lot)` consumes `{x,y,width,depth,angle}`. `contains(lot,point,tolerance=0)`, `overlaps(a,b,gap=0)`, `corridorOverlaps(lot,points,radius)` operate on full rectangles. `alongRoad(path,halfWidth,s,side,sizeKey)` returns lot geometry and `entrance:{x,y}` at its front centre, facing the road. `path` provides `length`, `pos(s)`, `dir(s)`.

- [x] Write tests asserting preset dimensions, rotated rectangle intersections, tangent alignment, and a curved-road segment crossing a lot away from its centre; run `node --test tests/building-placement.test.cjs` and confirm missing functionality fails.
- [x] Implement pure geometry. Use separating-axis tests for rotated rectangles and exact segment-to-rectangle distances for polyline corridors. The game adapter supplies sampled curves with a conservative approximation allowance.
- [x] Run the test file; require zero failures. Review exports against this interface.

### Task 2: Fixed buildings and entrance-based traffic

**Files:** `game.js`, `index.html` script list, `tests/harness.cjs`, `tests/buildings.test.cjs`.

- [x] Add blank-network tests using `loadGame({blank:true})` for `CITY.previewBuilding(point,type,sizeKey)`, `CITY.placeBuilding(candidate)`, exact footprint hit testing, disconnected buildings, fixed dimensions, and size capacities; verify failure first.
- [x] Add fixed geometry fields to Building while retaining `type`, `lane`, `s`, `people`, `jobs`, `service`, and existing trip interfaces. Use size-key multipliers instead of automatic levels. Separate lot creation from entrance reattachment.
- [x] Replace zoning candidate development and timed growth/abandonment with explicit placement; retain economy/service updates. Use the entrance lane address for trips and the parking entrance for the off-road arrival animation. Weight destinations by capacity and multiply origin demand by size.
- [x] Add legal driveway checks: kerb lane, truck/car clearance from trimmed ends, no turning pockets at the entrance, no remote road hopping on reconnect.
- [x] Test real route creation, both one-way sides, disconnect/reconnect, and size-related frequency with deterministic timers. Run `node --test tests/buildings.test.cjs`.

### Task 3: Protect lots during road editing

**Files:** `game.js` road editing and pre-sorting wrappers; `tests/buildings.test.cjs`.

- [x] Add failure-first tests for build, upgrade, reshape, and turning-lane edits that would overlap a lot; assert rejection leaves live road, car, and building identities and state unchanged.
- [x] Preflight proposed road corridor, node pavement, and affected turning lanes against full fixed footprints. Use conservative curve subdivision. Do not call demolition cleanup for player-authored lots. Reconnect entrances only after successful edits; remap splits from fixed world entrance position.
- [x] Preserve unrelated existing road rules. Verify legal splits/reversals keep lot geometry fixed and road deletion suspends trips. Run focused building, road editor, and turning-pocket tests.

### Task 4: Save version 5 and legacy compatibility

**Files:** `city-save.js`, `game.js` capture/restore, `tests/city-save.test.cjs`, `tests/buildings.test.cjs`.

- [x] Write failure-first fixtures for version 5 geometry round trips, malformed size/angle/parking/entrance fields, and migration of versions 1–4.
- [x] Store `{sizeKey,width,depth,angle,parking,entrance,access}` alongside existing building counters. `access` is null or `{edgeId,side}`; live lane indices and longitudinal positions are derived. Legacy geometry is reconstructed once using old type/level/seed rules and fixed thereafter.
- [x] Validate finite dimensions and references, reject invalid data before replacing the city, and remove occupied zone-cell constraints only for version 5. Keep old validators for old input before migration.
- [x] Update capture/restore to avoid moving lots during lane attachment. Run `node --test tests/city-save.test.cjs tests/buildings.test.cjs`.

### Task 5: Placement gestures, visuals, and starter city

**Files:** `game.js`, `index.html`, `styles.css`, `README.md`, `tests/buildings.test.cjs`, `tests/game.test.cjs`.

- [x] Add failure-first input tests: click places once; drag uses one road/side and frontage spacing; Escape/tool change/pointer cancel produce no placements; invalid candidates do not commit; no duplicate placement while reversing a drag.
- [x] Replace Zones with Buildings; add type and size selectors with accessible pressed state and shortcut 2. Replace zone painting/brush sizing and overlays with full lot previews and reasons. Preview rows until release and recompute validation against current live state at commit.
- [x] Draw pavement, driveway, parking lines and fixed building geometry from one local lot layout in both themes. Render fixed lot boundaries consistently with hit testing. Keep industrial roofs distinct and building colors consistent with type.
- [x] Replace starter zoning/development with deterministic placed lots via the same APIs; preserve the starter road layout and usable traffic. Update README.
- [x] Run focused input tests, inspect in the browser, and verify both themes plus new/load/import flows.

### Task 6: Regression checks and review

- [x] Run `node --test --test-concurrency=2 tests/*.test.cjs` to completion; inspect failures individually. Use blank fixtures for new isolated cases rather than repeatedly warming up starter traffic.
- [x] Review the diff for traffic-engine changes outside entrance handling and generation, old zoning callbacks, missing scripts in the harness, and lost pre-existing source edits.
- [x] Run a final independent code review with the required model/effort; address substantive findings and repeat affected tests.
- [x] Check `git diff --check`, record test results, and deliver the working changes with any actual limitations.

## Execution evidence

Implemented in the user-authorized checkout. See `docs/building-placement-validation-2026-10-16.md` for full-suite results, the five confirmed pre-existing traffic queue failures, final focused checks, and browser review evidence. No merge or publication was performed.
