# Traffic AI v2 Implementation Plan

**Goal:** Implement the review roadmap in the current authorized worktree, preserving local editor changes.
**Architecture:** Retain the lane graph and IDM model. Add continuous manoeuvres with dual occupancy, feasible time-based routes, local junction conflict occupancy, and bounded diagnostics.
**Tech stack:** Plain browser JavaScript and Node built-in test runner; no dependencies.

## Constraints
- Mandatory route requests never bypass safety.
- Source lane ownership persists until a manoeuvre completes; destination occupancy is visible immediately.
- Incomplete manoeuvres cannot enter connectors. Stop lateral travel when longitudinal travel stops.
- Preserve save compatibility and all user changes. Work in the existing branch; no automatic commit or publication.
- Delegated work uses gpt-6-luna, xhigh reasoning only.

## Tasks and validation
- [x] Establish baseline using `node --test tests/*.test.cjs`; retain evidence of pre-existing failures.
- [x] Movement: add `tests/traffic-v2-movement.test.cjs`, demonstrate old immediate ownership transfer and missing target occupancy, implement distance-parametrized quintic trajectories and tangent heading in `game.js`, rerun movement/pocket/presorting tests. Add future gap checks, projected occupancy, bounded cooperation and legal missed-turn recovery.
- [x] Routing: add `tests/traffic-v2-routing.test.cjs`, demonstrate infeasible short-link route and speed-insensitive costs, implement feasibility across adjacent lane orders/pocket mouths and travel-time costs in `findRoute`/`routeBetween`, rerun routing and existing routing consumers.
- [x] Junctions: add `tests/traffic-v2-junctions.test.cjs`, demonstrate whole-connector exclusion after region clearance and unsafe shared-prefix following, implement conservative local region release/time windows and compatible signal scheduling, rerun intersection tests.
- [x] Diagnostics: add standalone `traffic-diagnostics.js` and test-first SAT/swept-footprint/metrics tests. Integrate recording and developer overlay, record track traversal times, expose bounded summary API, document world units and pocket warnings.
- [x] Acceptance: run seeded moving car/truck scenarios with diagnostics; fix new safety regressions, record measured baseline/comparison and performance results rather than assume improvement. Review changes with a fresh reviewer, run full suite and syntax/diff checks, document remaining limitations honestly.

Validation and measured limitations are recorded in `docs/traffic-ai-v2-implementation-2026-10-15.md`. Overall city throughput is lower than the unsafe baseline; further tuning remains explicit rather than claimed complete.
