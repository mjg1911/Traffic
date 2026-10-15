# Traffic AI Deep-Dive Review

**Project:** Arterial / Traffic  
**Repository:** https://github.com/mjg1911/Traffic  
**Review date:** 15 October 2026  
**Reviewed branch:** `main`  
**Reviewed commit:** `dcdff8ce2c5facf966316b87d5921675827153d3`  
**Document purpose:** Traffic behaviour analysis, competitor/industry lessons, proposed architecture, priorities, and acceptance tests.

> **Review scope and limitations:** This report is based on repository source, traffic-related tests and project documentation, plus a comparison with approaches discussed publicly for traffic simulators and games. The code was reviewed, but the browser game and automated test suite were **not executed** as part of this review. Findings explicitly visible in the source are distinguished from risks that require runtime reproduction. No source files were modified.

---

## 1. Executive verdict

**Keep the current simulation foundations, but substantially redesign how vehicles plan, execute and coordinate lane changes.**

The underlying architecture is promising: the game already has a directed lane-and-connector road network, lane-space A* routing, Intelligent Driver Model (IDM) car following, MOBIL-inspired lane changing, editable lane connections, turn pockets, conflict detection and intersection arbitration. Those are valuable building blocks.

The central problem is that **the system knows which lane a vehicle needs but does not adequately establish when and how the vehicle can reach that lane.** When a junction approaches, the route can demand a mandatory lane change that the car must attempt to satisfy locally. Meanwhile, its lateral motion is currently an interpolation of its position rather than a properly planned manoeuvre. This helps explain why the vehicles can look as if they slide sideways into the correct lane.

### High-level disposition

| System | Recommendation |
|---|---|
| Road/lane representation | Keep and extend |
| A* route finding | Improve substantially |
| Car-following physics (IDM) | Keep and tune |
| Lane-change decisions | Major redesign |
| Lane-change animation and lane occupancy | Major redesign |
| Intersection collision management | Improve substantially |
| Turning pockets and lane editor | Keep and extend |
| Traffic behaviour testing | Major investment needed |

**Strategic recommendation:** Make predictive lane selection and physically continuous lane changes the next engineering milestone, before investing heavily in new cosmetic features or road types.

---

## 2. Why vehicles slide between lanes

### Finding A — Lane ownership changes before the physical manoeuvre finishes

**Priority: Critical — Confirmed from code**  
**Source:** [`game.js` — `executeChange()`](https://github.com/mjg1911/Traffic/blob/main/game.js#L1619-L1636) and [`Car.step()`](https://github.com/mjg1911/Traffic/blob/main/game.js#L1376-L1383)

When a lane change begins, the car's track is immediately replaced with the destination lane and a lateral offset is assigned. That offset is reduced toward zero over `CHANGE_TIME = 0.85` seconds. The apparent steering angle is approximated separately.

The resulting behaviour is closer to a sideways translation than a continuous steering manoeuvre. More importantly, because the vehicle is promptly transferred into the new lane's vehicle list, the old lane does not fully account for its body while it is crossing the boundary. That is an occupancy-model risk; whether it creates visible overlaps in practice needs moving-vehicle tests.

**Recommended change:**

- Introduce a lane-change manoeuvre object with a source lane, destination lane, start position, progress, duration and safety envelope.
- Account for the vehicle in **both lanes** until it has physically cleared the source lane. This can be represented through explicit occupancy intervals or a temporary/ghost occupancy in the original lane.
- Follow a smooth, continuous trajectory and compute the car's heading from its actual path tangent.
- Validate front and rear clearance for the entire planned manoeuvre rather than only at its beginning.
- Complete lane ownership transfer only when the car is established in the new lane.

### Finding B — Route planning does not fully check manoeuvre feasibility

**Priority: Critical — Confirmed architectural limitation**  
**Source:** [`game.js` — `findRoute()`](https://github.com/mjg1911/Traffic/blob/main/game.js#L1139-L1192)

Lane changes have a fixed route-planning penalty (`CHANGE_COST = 34`). The route finder considers changes between sibling lanes when selecting the next connector, but does not prove that the selected changes can be completed given the actual distance remaining, traffic gaps, lane-change duration, turning-pocket entry points and downstream constraints.

A route can therefore be graph-valid while physically difficult or impossible at the vehicle's current position.

**Recommended change:** Add a lane feasibility layer: number of required adjacent changes, minimum usable distance, achievable arrival time, expected speed, traffic occupancy and legal merge locations. Prefer routes whose lane sequences can actually be driven. If a planned turn becomes unreachable, continue legally and replan rather than forcing a last-second merge.

### Finding C — Pre-sorting logic is well intentioned but too broad

**Priority: High — Confirmed from code**  
**Source:** [`game.js` — `considerLaneChange()`](https://github.com/mjg1911/Traffic/blob/main/game.js#L1521-L1565)

The current sorting distance is calculated using a minimum of 300 internal units and increases with speed and number of lane changes:

```javascript
const sortDistance = Math.max(
  300,
  speed * (CHANGE_TIME + CHANGE_CD) * (numberOfLanes - 1)
    + speed * speed / (2 * IDM_B)
);
```

At a representative speed of 128 internal units/second, it is roughly 349 units for a two-lane approach and 637 units for a three-lane approach. The starter grid's nominal junction spacing is approximately 350 units before trimming. Thus some roads are mostly or entirely inside a pre-sorting region. The code also suppresses discretionary lane changes for vehicles already in their intended lane in that region.

**Recommended change:** Separate motivations rather than treating pre-sorting as one broad rule: strategic turn preparation, tactical gap finding, discretionary passing, yielding/cooperation and last-chance recovery. Use distances and timings derived from physical feasibility, not solely a fixed lookahead heuristic.

### Finding D — Short turning pockets can demand impossible high-speed merges

**Priority: High — Confirmed parameter mismatch; gameplay impact to be tested**  
**Source:** [`pre-sorting.js`](https://github.com/mjg1911/Traffic/blob/main/pre-sorting.js)

Turning pockets can be as short as 45 internal units, while the configured lane-change duration is 0.85 seconds. At 80 units/second, a vehicle travels approximately 68 units during a full-duration manoeuvre. A minimum-length pocket can therefore be too short to complete the manoeuvre at that speed without slowing beforehand. The legally usable portion is smaller still because a vehicle cannot enter before the pocket's mouth.

**Recommended change:** Link pocket usability to approach speed and manoeuvre requirements. Keep adjustable pockets as gameplay features, but display warnings for impractically short pockets and have vehicles adjust their approach speed before entering.

### Finding E — Routing optimizes a proxy cost, not expected travel time

**Priority: High — Confirmed from code**  
**Source:** [`game.js` — routing cost](https://github.com/mjg1911/Traffic/blob/main/game.js#L1139-L1192)

The routing algorithm adds lane-change penalty, connector length, following-lane length, turn-angle penalty and an occupancy-based jam cost. It does not directly estimate road and junction travel time from actual speed limits, queues or signal delays.

A shorter road can be slower than a longer one, especially around traffic lights and turn queues. Route changes should also be stable rather than react to minor momentary changes.

**Recommended cost model:**

\[
C_{\mathrm{route}} = T_{\mathrm{drive}} + T_{\mathrm{junction}} + T_{\mathrm{queue}} + T_{\mathrm{merge}} + P_{\mathrm{risk}}
\]

Use smoothed observed delays and a modest hysteresis threshold before rerouting. `P_risk` is a planning penalty for difficult manoeuvres, not an actual measured travel time.

### Finding F — Intersection conflict handling remains coarser than its geometry

**Priority: High — Confirmed from code**  
**Sources:** [`computeConflicts()`](https://github.com/mjg1911/Traffic/blob/main/game.js#L584-L725) and [`arbitrate()`](https://github.com/mjg1911/Traffic/blob/main/game.js#L1674-L1784)

The current code already computes pairwise geometric **conflict-zone intervals**. This is a valuable foundation. But admission checks still use connector-wide claims. A car that has passed the physical crossing location can continue excluding a conflicting movement until its entire claim is released.

Additionally, connections originating from the same inbound lane are excluded from pairwise conflict generation. Shared-lane following and branching still need a robust spacing policy across connector choices.

**Recommended change:** Preserve the connector geometry, extend conflict zones to cover crossing/merging/shared-prefix regions and use predicted occupancy times and swept vehicle footprints to admit safe simultaneous movements. Release conflict regions as soon as the vehicle's rear clears the particular region, not necessarily the entire connector.

### Note about the existing audit

The repository contains [`traffic-intersection-code-audit-2026-10-15.md`](https://github.com/mjg1911/Traffic/blob/main/traffic-intersection-code-audit-2026-10-15.md). It is worth keeping, but reviews an earlier revision (`0749857`). In the current commit reviewed here, several earlier findings appear to have already been addressed: the city-wide arbitration `return` for retired nodes, roundabout circulation priority, the unconditional 26-second waiting-car deletion and addition of conflict-zone data. Verify those fixes through tests; do not blindly treat every older issue as still outstanding.

---

## 3. Lessons from other traffic simulations and games

The best approach is to combine the strongest concepts rather than try to duplicate one entire simulator.

### SUMO — Simulation of Urban Mobility

**Most valuable reference for detailed traffic engineering.** SUMO differentiates strategic lane changes, speed advantage, cooperation and keeping to the preferred driving side. It also documents secure gaps, vehicle-lane change reasoning and gap-creation responses.

**Adopt:** Separate lane-change motivations, explicit safety checks, cooperative merging, event logging and controlled simulation scenarios.

### Cities: Skylines II

Public developer descriptions emphasize routing and lane choice informed by travel time, congestion and surrounding vehicles. Its proprietary internals should not be assumed to be documented or identical to those descriptions.

**Adopt:** Traffic-aware lane selection and route stability, so choosing the correct lane depends on likely traffic consequences as well as geometric eligibility.

### A/B Street

A/B Street provides useful development discussion about mandatory lane changes, short approaches and cases in which the target lane cannot be reached. Its lane-changing work also illustrates protecting original-lane occupancy during a manoeuvre.

**Adopt:** Explicitly model failed or infeasible merges, avoid forced movement, and retain collision-relevant occupancy in both lanes.

### Trafficity

This traffic-focused city-building game emphasizes traffic-aware routing, intersection options, slip lanes and road hierarchy as player choices. It is more useful as a **game-design comparison** than as an openly documented source of driving algorithms.

**Adopt:** Make improvements from road design perceptible: a better lane layout, turn pocket or signal arrangement should create measurable and visually understandable traffic improvements.

### Recommended synthesis

Use **SUMO's strategic/cooperative lane-change principles**, **MOBIL's safety-and-incentive decision framework**, **A/B Street's explicit in-progress lane occupancy**, and **traffic-aware route selection** as the basis for this game's own implementation. Keep the game's existing browser-friendly geometry, road editor and junction controls.

---

## 4. Proposed Traffic AI v2 architecture

Separate decisions into four levels:

1. **Route planner:** Which roads and intersection movements should serve a trip?
2. **Lane planner:** Which lane sequence must be reached over the next two or three intersections, and is it feasible?
3. **Behaviour controller:** Should the vehicle follow, accelerate, brake, change lanes, cooperate, yield or replan?
4. **Movement and safety layer:** Execute a continuous trajectory while accounting for all occupied space, vehicle footprints and junction conflict regions.

### Lane planner responsibilities

- Plan multiple junctions ahead rather than solving only the immediately upcoming connector.
- Evaluate lane-change count, lane availability, usable merging distance, current congestion and turn-pocket mouths.
- Prefer legal lane sequences with achievable merges.
- Introduce route commitment and hysteresis: don't switch the target lane because of a marginal improvement in a momentary score.
- Provide a stable fallback when a turn becomes unreachable.

### Lane-change state machine

| State | Responsibility |
|---|---|
| `KEEP_LANE` | Follow the current lane and leader |
| `PREPARE` | Select target lane and find an achievable gap |
| `YIELD_FOR_GAP` | Adjust speed gently to form or accept a safe gap |
| `CHANGING` | Follow continuous lateral/longitudinal motion, occupying both lanes |
| `SETTLING` | Complete the manoeuvre and clear original-lane occupancy |
| `ABORT_OR_REPLAN` | Resolve an unsafe/impossible change by continuing legally |

**Non-negotiable invariant:** Mandatory route instructions must never override collision safety.

### Smooth trajectories

A useful baseline is the fifth-order smoothstep for lane-change progress:

\[
e(u) = 10u^3 - 15u^4 + 6u^5, \quad 0 \le u \le 1
\]

This provides zero lateral velocity and acceleration at both ends of the manoeuvre. However, apply the progress to an actual source-to-destination trajectory; calculate heading from its tangent, not just from a visual correction. Ensure manoeuvre timing respects available distance, speed, curvature, lateral acceleration and moving-vehicle clearance. Smooth geometry alone is not proof of collision safety.

### Cooperative merges

A vehicle preparing to merge should be allowed to signal its intention to the local behaviour controller. A nearby follower may reduce acceleration slightly if it can safely create room, especially at short turn pockets, lane drops and roundabout approaches. The required cooperation must be bounded; other drivers should not brake violently to accommodate an unsafe insertion.

### What should happen if the vehicle misses its lane?

Normally, continue through a legal route and replan at a safe location. If there is a reachable queue and room to wait safely, waiting can be appropriate. But do not force a lane change at the stop line or endlessly hold a blocked vehicle while its desired turn remains impossible.

---

## 5. Junctions, routing, driving diversity and debugging

### Intersection management

Keep the current graph and connector architecture, editable turning rules, roundabouts, lights and don't-block-the-box checks. Evolve the arbiter to use actual conflict regions, predicted arrival/clearance windows, vehicle extents and downstream exit availability. Build signal plans using compatible movements rather than just road-approach angle groups. Support optional protected turns, permissive turns and demand-responsive phase timing once safety tests are established.

### Routing quality

Store moving-average traversal times for road segments and intersection movements. Penalize poor merge feasibility and unreliable left-turn queues. Replan at deliberate decision points rather than reacting to every small fluctuation. Measure route changes per trip, not only average trip duration.

### Vehicle behaviour

Keep car/truck differences and introduce carefully bounded variation in acceleration, headways and merge preferences. Personality settings must never bypass safety conditions.

### Developer and player diagnostics

A developer overlay should show each vehicle's planned movement, desired lane, lane-change state, gap constraints, turn-pocket mouth, junction reservation and reason for waiting. Later, expose understandable traffic-analysis tools to players: queue length, delay, turning demand and blocked approaches.

---

## 6. What should stay the same

| Existing feature | Recommendation |
|---|---|
| Node/Edge road graph | Keep overall structure |
| Lane and Connector entities | Keep; improve occupancy semantics |
| Bézier paths and arc-length parametrization | Keep |
| IDM following dynamics | Keep and recalibrate after merging is fixed |
| MOBIL-inspired scoring | Keep as one input to lane-change decisions |
| Roundabouts represented as graph topology | Keep |
| Player-editable lane connections | Keep |
| Adjustable turn pockets | Keep |
| Fixed time-step simulation | Keep |
| Seeded random generator | Keep; ensure gameplay randomness is deterministic |
| Existing automated tests | Preserve and expand |

**Avoid an indiscriminate rewrite.** The highest-impact redesign is the interface between route intention, lane-choice feasibility and physical movement.

---

## 7. Implementation roadmap

### P0 — Instrument, reproduce, baseline

- Make every lane-change decision and junction denial observable.
- Add overlap/near-miss detection using vehicle footprints.
- Establish seeded maps with controlled demand and record current results.
- Track waiting reasons, impossible merge requests, reservation lead times and route changes.

**Done when:** The observed junction-slide problem has a repeatable scenario and measurable indicators.

### P1 — Proper lane-change execution and safety

- Add lane-change states and manoeuvre geometry.
- Keep vehicles collision-relevant in both source and destination lanes.
- Ensure gap safety persists through completion, including trucks.
- Prevent unfinished lane changes from crossing into junction connectors.
- Derive vehicle orientation from the manoeuvre path.

**Done when:** Cars no longer visibly snap/slide sideways and the test suite finds no new vehicle overlaps.

### P2 — Predictive lane planning

- Plan a feasible lane sequence across upcoming junctions.
- Rework mandatory merge distance and short-link decisions.
- Add cooperative gap creation.
- Support missed-turn/legal-replan behaviour.
- Improve pocket usability and player warnings for short lanes.

**Done when:** Vehicles arrive in appropriate approach lanes early, and failed merges are handled deliberately.

### P3 — Better junction throughput

- Use existing conflict-zone intervals for local occupancy management.
- Predict safe crossing/merge time windows and exit clearance.
- Improve right-of-way and fairness at unsignalled intersections.
- Build movement-compatible signal phases.

**Done when:** Safe, non-conflicting movements proceed together and intersection throughput improves without collisions.

### P4 — Routing quality and scalability

- Route using measured/predicted travel times.
- Cache reusable graph/adjacency information and reduce unnecessary replanning.
- Profile sorting, collision checking and signal arbitration at larger vehicle populations.
- Add player-facing traffic analysis and performance diagnostics.

**Done when:** The same behavioural quality holds on larger and denser cities.

The existing configuration includes `MAX_CARS = 240`. Do not make arbitrary performance optimizations ahead of correctness; first profile the system with increasingly large deterministic scenarios.

---

## 8. Acceptance and benchmark plan

### Suggested regression scenarios

| Scenario | Required outcome |
|---|---|
| Two-lane road approaching a four-way traffic light | Early and stable correct-lane selection |
| Three-lane highway approaching a required turn | Multiple adjacent lane changes completed safely |
| Short segment between two intersections | No physically impossible mandatory merge |
| Nearly full destination lane | Safe wait or legal reroute; no clipping |
| Minimum-length dedicated turn pocket | Feasible speed selection and gap check |
| Busy roundabout fed by a high-volume road | Correct circulating priority and gap acceptance |
| Congested crossing with blocked downstream link | No stop inside the junction without exit space |
| Road edit with active approaching/crossing vehicles | Local and safe connector rebuilding |
| Mixed city-scale traffic with trucks | Throughput, fairness and footprint safety under load |

### Metrics

- Successful trips per simulated minute.
- Average, median and p95 trip duration.
- Average and p95 delay per junction/movement.
- Queue lengths and time spent stationary for each reason.
- Failed/unachievable mandatory lane changes.
- Distance remaining to the stop line when a lane change starts/finishes.
- Vehicles moving laterally while almost stopped.
- Lane changes, route changes and missed turns per trip.
- Intersection throughput and peak safe concurrent movements.
- Vehicle rectangle overlaps, near misses and illegal entries.
- CPU cost per simulated second, frame-time distribution and vehicle count.

**Hard safety criteria:** Zero unintended swept-vehicle overlaps and zero illegal junction entries in the deterministic regression suite. For throughput, delay and visual behaviour, establish the current baseline and require demonstrated improvement rather than guessing a target.

### Simulation-unit consistency

Road geometry and vehicle physics currently operate in internal pixel-like units, while the UI presents pocket lengths as metres. Define and document an explicit world-unit scale before comparing parameter values against real-world traffic data.

---

## 9. Final recommendation

**Next milestone: Traffic AI v2 — Predictive lane selection and physically continuous lane changes.**

The key user-visible acceptance condition is simple: when approaching an ordinary busy crossing, vehicles should already be preparing for the correct lane, merge in continuous physically believable manoeuvres, respect safe gaps and never need to make a last-second sideways correction just because the planned route says so.

The strongest part of the existing game is that roads, lanes and junction movements are first-class simulation objects. The weakest part is the disconnect between the strategic route and the actual vehicle movement. Fix that first.

For a traffic-focused game, **realistic congestion is acceptable; traffic jams caused by broken AI are not**. Player-built bad roads should cause meaningful and explainable congestion. Good road design should be rewarded with better flow, not undermined by erratic merging or artificial intersection blocking.

**Priority decision:** Implement P0–P2 before major expansion of visual features or road types; follow closely with P3 because junction throughput is central gameplay.

---

## 10. Primary project references

- [Traffic repository](https://github.com/mjg1911/Traffic)
- [Core game logic (`game.js`)](https://github.com/mjg1911/Traffic/blob/main/game.js)
- [Dedicated turning-pocket logic (`pre-sorting.js`)](https://github.com/mjg1911/Traffic/blob/main/pre-sorting.js)
- [Existing intersection audit](https://github.com/mjg1911/Traffic/blob/main/traffic-intersection-code-audit-2026-10-15.md)
- [Lane pre-sorting regression tests](https://github.com/mjg1911/Traffic/blob/main/tests/lane-presorting.test.cjs)
- [Turn-pocket regression tests](https://github.com/mjg1911/Traffic/blob/main/tests/turn-pockets.test.cjs)
- [Intersection regression tests](https://github.com/mjg1911/Traffic/blob/main/tests/intersections.test.cjs)
- [Lane-connections design specification](https://github.com/mjg1911/Traffic/blob/main/docs/superpowers/specs/2026-10-15-lane-connections-design.md)
- [Turn-pocket design specification](https://github.com/mjg1911/Traffic/blob/main/docs/superpowers/specs/2026-10-15-pre-sorting-lanes-design.md)

**External systems considered:** SUMO (Simulation of Urban Mobility), Cities: Skylines II, A/B Street and Trafficity. Their publicly described behaviour provides design inspiration; this report does not claim access to proprietary source code or to independently measured performance comparisons of those games.

---

*Prepared as a project-ready engineering review. This file contains recommendations and a validation plan, not implemented code changes.*
