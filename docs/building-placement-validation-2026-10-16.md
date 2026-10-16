# Building placement validation — 2026-10-16

## Delivered behavior

- Residential, Commercial, and Industrial buildings in three fixed sizes, with parking included in their collision footprint.
- Click placement and release-to-commit row previews along straight and curved roads; preview cancellation and overlap rejection.
- Entrance-derived lane addresses, both one-way kerbs, size-aware capacity/demand, and existing outbound/visit/return traffic lifecycle.
- Protection against building/parking loss during road, turning-lane, and roundabout edits; disconnected lots remain fixed.
- Save version 5 and validated migration from zoning saves, including legacy lots initially without roads.
- Starter city, accessible Buildings controls, theme support, and README instructions.

## Automated evidence

Full run: `node --test --test-concurrency=2 tests/*.test.cjs` completed with **192 tests: 187 passed, 5 failed**, no skipped or canceled tests. The five failures are in the existing `tests/traffic-merge-queues.test.cjs`:

1. A car waiting for a merge keeps room to finish when the queue clears.
2. A truck waiting for a merge keeps room to finish when the queue clears.
3. A queued two-lane merge to the left preserves room for both changes.
4. A queued two-lane merge to the right preserves room for both changes.
5. Waiting for the destination lane preserves merge room before the kerb.

An independent read-only investigation supplied `git show HEAD:game.js` to the harness through an in-memory file-read override. The same five assertions fail against that unchanged traffic implementation. The vehicles are killed by the existing five-second merge-gap recovery before the fixtures clear their queues. The pre-existing connector-clearance edits do not trigger in these cases. These failures were preserved rather than changing traffic recovery within this feature.

The seed-42, 60-simulated-second traffic acceptance test passed: completed trips, zero detected swept vehicle overlaps, zero illegal junction entries, and no truncated safety scans.

After final review identified an isolated legacy-save frontage case, a regression test was observed failing, the inference/reattachment behavior was corrected, and the latest focused run passed **45/45**:

`node --test tests/buildings.test.cjs tests/building-placement.test.cjs tests/city-save.test.cjs`

The full-suite count predates that additional regression test. Relevant existing turning-pocket tests also passed (17/17). JavaScript syntax checks for `game.js`, `building-placement.js`, `city-save.js`, and `pre-sorting.js` passed; `git diff --check` was clean.

## Visual and independent review

Browser interaction verified the Buildings palette, single Medium and Large placements, dragged Small rows, curved-road alignment, invalid overlap previews, blank-map creation, and light/dark rendering. No browser warnings or errors were recorded during inspection. See [placement preview](building-placement-preview.png).

Independent geometry/save and integration reviews used the user-requested `gpt-6-luna` model with `xhigh` reasoning. The isolated-legacy-frontage finding was fixed and covered by the new regression test.

## Scope and retained state

Parking stalls are visual; one entrance per building uses the existing visit lifecycle. Parking-space occupancy and internal parking-lot driving are not simulated. Old buildings preserve their legacy appearance and footprint instead of gaining oversized parking areas.

The user's pre-existing uncommitted connector-clearance recovery and selected-route overlay changes remain in `game.js`. Their two existing untracked plans were preserved. No traffic routing, lane-change, or junction arbitration algorithm was rewritten.
