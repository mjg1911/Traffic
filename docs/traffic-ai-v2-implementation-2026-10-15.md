# Traffic AI v2 — implementation and validation

15 October 2026. Implemented in the existing `main` checkout at `E:/Traffic game`; changes are uncommitted. The pre-existing turning-pocket hover/flash edits in `game.js` and `index.html` were preserved. The source review is unchanged.

## Implemented scope

- **P0 — Diagnostics:** bounded event/metric recording; vehicle states, front/rear gap constraints and refusal reasons; predicted reservation windows; oriented car/truck rectangles; adaptive swept collision checks with spatial filtering; explicit incomplete-scan reporting. The Lanes overlay shows intentions, merge progress, gaps, pocket mouths and waiting causes. Near-miss threshold intervals can be reported as `possible` while collision clearance remains independently proved.
- **P1 — Movement:** distance-based quintic trajectories and tangent headings; source ownership until completion; collision-relevant target occupancy throughout the manoeuvre; continued following in both lanes; bounded entry speed; no connector admission during a manoeuvre. Same-tick departures, track transitions and spawned vehicles update occupancy and poses immediately. Stopped cars do not continue moving sideways.
- **P2 — Planning:** full-route lane feasibility across adjacent lane orders and pocket mouths; car/truck stopping clearance; entry speed planning before short downstream links; bounded cooperative gap requests; legal replanning for missed turns; route commitment against immediate reversals; warnings and lower approach speeds for short pockets. A 45-unit pocket remains usable by cars but is rejected for trucks when its usable merge distance is insufficient.
- **P3 — Junctions:** paired conflict intervals based on car/truck footprints, shared departure prefixes and merges; release after local footprint clearance; conservative predicted windows; revalidation of provisional approach claims; per-region holds when already-entered vehicles' forecasts overlap. Physical crossing claims are preserved. Signal stages contain compatible movements, skip empty demand stages, retain amber, and display individual turns. Retired connector geometry drains locally after road edits.
- **P4 — Travel time and measurement:** time-based routing with speed/load, observed full-track traversal times and signal-delay estimates; meaningful-improvement route hysteresis; deliberate replanning points; invalidated outgoing-movement caches. Per-trip lane-change, route-change and missed-turn metrics are available. City management shows queues, throughput, p95 trip time and the main current queue cause. Capacity profiles cover 60, 120 and 240 active vehicles.

Three world units represent one displayed metre. Saved geometry and pocket lengths remain in world units. Driving parameters are game settings, not a calibrated traffic-engineering model.

## Verification

`node --test --test-concurrency=2 tests/*.test.cjs`: **158 passed, 0 failed**, no skipped tests. Syntax checks passed for `game.js`, `pre-sorting.js` and `traffic-diagnostics.js`; `git diff --check` passed. Headless rendering with the diagnostic overlay enabled also passed.

Regression coverage includes moving two- and three-lane approaches, short links, car/truck pocket feasibility, occupied gaps, red/amber entry denial, blocked exits, simultaneous compatible crossings, roundabout priority, provisional reservations that become unsafe, two already-entered movements with a stalled lead, local drainage after road edits, same-tick lane entrants, kerb destinations, stopped lateral motion, wrapped headings and corner-grazing swept collisions.

Focused fixtures omit starter-city generation and author their own actual network; the city acceptance test and game integration tests retain the normal startup. Existing tests were updated where they assumed immediate lane ownership, version-1-only save exports, approach-wide signal stages, or turning-pocket creation merely by selecting a junction. The corner-turn concurrency test now respects measured vehicle footprints: adjacent corner paths intersect in the narrow test junction, while opposite turns can proceed together. Test identity assertions avoid expanding cyclic simulation graphs on failure.

## Seeded city comparison

Baseline: unchanged reviewed commit `dcdff8ce2c5facf966316b87d5921675827153d3`. Both runs use seed 42, normal starter-city warmup, then 60 additional simulated seconds and 3,600 footprint scans. Parking/visiting animations and a vehicle's initial spawn frame are excluded from the external traffic scan. Unreserved-entry counts specifically check that lane-to-connector transitions held that connector's claim; red/amber and lane eligibility have separate regression tests.

| Metric | Baseline | Traffic AI v2 |
|---|---:|---:|
| Completed trips | 86 | 75 |
| Lane-change starts | 113 | 189 |
| Peak vehicles | 145 | 139 |
| Peak simultaneous claims, city-wide | 24 | 23 |
| Distinct overlapping vehicle pairs | 21 | 0 |
| Unreserved connector entries | 0 | 0 |
| Incomplete footprint scans | 0 | 0 |
| Mean completed-trip duration | 39.73 s | 37.55 s |
| p95 completed-trip duration | 62.52 s | 63.00 s |

The new run completes 75 trips versus 86 in the baseline, approximately 12.8% fewer in this window. It eliminates the 21 observed overlapping pairs while completing every safety scan. This establishes a safety improvement; **it does not establish an overall throughput improvement**. Protected movement stages and actual body clearance constrain some movements the former centre-line model admitted. Signal efficiency and route tuning remain measurable follow-up work. Completed-trip duration statistics also sample different completed trips and should not be treated as a controlled travel-time comparison.

## Capacity profile

Five simulated seconds on a six-lane highway, with one truck per four vehicles. CPU figures cover simulation steps, exclude the external footprint scanner and browser rendering, and depend on this machine. This is free-flow population profiling, not a dense-city or junction stress certification.

| Vehicles | Mean simulation step | p95 simulation step | Overlap pairs | Complete scans |
|---:|---:|---:|---:|---:|
| 60 | 0.531 ms | 0.840 ms | 0 | 300/300 |
| 120 | 0.927 ms | 1.545 ms | 0 | 300/300 |
| 240 | 1.817 ms | 2.627 ms | 0 | 300/300 |

## Reproduce and inspect

- Run `node tests/traffic-benchmark.cjs` for the city benchmark; add `--baseline` to read the unchanged `HEAD` source without modifying the checkout.
- `TRAFFIC_BENCH_SECONDS` changes the measurement window. Set `TRAFFIC_BENCH_CARS` to 60, 120 or 240 and the duration to 5 for the capacity profile.
- Raw results: `docs/traffic-ai-baseline.json`, `docs/traffic-ai-current.json`, `docs/traffic-ai-capacity-profile.json`.
- In the game, open City management for traffic analysis or enable Lanes (L) for vehicle diagnostics. The developer API exposes `ARTERIAL.trafficDiagnostics.summary()`, `.getEvents()` and `ARTERIAL.trafficAnalysis()`; `ARTERIAL.W.safetyChecks = true` enables scans without the overlay.

## Limits

The automated browser refused local `file:` URLs, so live visual/browser verification was unavailable; it was not bypassed. Headless simulation and drawing checks passed. The deterministic scenarios provide regression evidence, not a collision guarantee for every player-built map or arbitrary geometry edit. Dense-junction performance at the full vehicle limit and broad multi-seed throughput tuning remain further validation work. No dependencies were installed, and nothing was committed, pushed or published.
