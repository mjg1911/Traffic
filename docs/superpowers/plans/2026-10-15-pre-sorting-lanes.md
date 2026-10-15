# Pre-sorting Lanes Implementation Plan

**Goal:** Add real turning pockets with draggable lengths and persistence.

**Architecture:** A focused pre-sorting module supplies bounded offset paths and junction editing helpers. Integrate with existing lane building, connectors, safe lane changes, canvas input/rendering, and CitySave validation.

**Tech Stack:** Browser JavaScript, Canvas, Node test runner. No new dependencies; retain direct file opening.

## Tasks

- [x] Add failing tests in tests/turn-pockets.test.cjs for extra turn-only tracks, route eligibility and upstream entry limits.
- [x] Implement pre-sorting geometry and mutations; integrate lane generation, connectors and lane changing in game.js. Use stable ordinary lane indices and append pocket indices.
- [x] Add tests for length clamping, removal, pointer dragging/cancellation, one-way approaches and persistence.
- [x] Add intersection controls in index.html; render pockets, arrows and draggable handles; commit resize on release and discard previews on cancellation.
- [x] Validate optional preSorting junction records in city-save.js, including incident road direction, finite lengths and lane-rule indices. Capture and restore them in game.js.
- [x] Update README.md; run regression and syntax checks. Inspect final diff and native Canvas rendering. Browser local file navigation was unavailable.

## Visual correction

User screenshot revealed detached pocket strips and an oversized circular junction. The strips were replaced with a continuous cached road outline with 35 m tapers. A later screenshot showed that joining all approach mouths into one convex junction polygon made the crossing look pointed, so junctions now keep the standard central pad while each pocket widens only its selected approach. Shift the through lanes before the pocket entry and retain adjacent spacing for right pockets. Reposition the lane dividers and length labels.

## Existing test failures

The unmodified baseline reproduces four failures: two CitySave tests require version 1 while the project uses version 4; one priority gap assertion fails; one roundabout conversion reservation assertion fails. Exclude these four known failures for the regression run. Do not change unrelated simulation behavior as part of this feature.
