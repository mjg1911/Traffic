# Arterial / Traffic — Intersection and Traffic Logic Audit

**Repository:** [mjg1911/Traffic](https://github.com/mjg1911/Traffic)<br>
**Reviewed branch:** `main`<br>
**Source revision:** [`0749857585830e6d9d0f9d489f6fa3d7ac0f823e`](https://github.com/mjg1911/Traffic/commit/0749857585830e6d9d0f9d489f6fa3d7ac0f823e)<br>
**Review date:** 15 October 2026<br>
**Scope:** intersection connector geometry, movement compatibility, signalling, stop/yield/priority control, roundabouts, reservation lifetime, car longitudinal/lateral movement, rerouting, editing, and existing tests.

## Executive summary

**Verdict: The intersection code is not globally limited to one car at a time, but it has important throughput bottlenecks and correctness gaps.** The simulator actually precomputes which connector movements conflict, stores individual connector reservations, and can admit several compatible vehicles in one tick. Existing unit tests explicitly assert that opposite through movements, multiple parallel through lanes, and four independent turns at a **yield** junction can share an intersection.

That correct foundation masks shortcomings in the live traffic experience:

1. Every detected conflict is treated as a **whole-movement mutex**: the second car must wait until the first vehicle has completely cleared the *far end* of its connector, even when the physical conflict point was passed earlier. This is the strongest general-purpose concurrency bottleneck.
2. Traffic signals are **approach-wide two-phase switches**, not movement-specific controls. A harmless turn on a red approach cannot proceed; permissive left turns and high-volume through traffic compete for the same green phase without a deliberate protected/permissive-turn strategy.
3. A high-speed car can **claim a junction far in advance** using a braking-distance request window, reserving space while it is still upstream.
4. Priority arbitration is **entirely reactive and coarse**: it tests an approaching car in a fixed 78-pixel window, and does not schedule conflict-zone occupancy in time.
5. There are confirmed situational correctness problems: a roundabout entering from a highway ties with circulating ring traffic; a road-edit cleanup branch can suspend granting reservations across the *entire city*; a 26-second slow-speed timeout deletes cars, including legitimately stopped ones.
6. The conflict checker exempts movements with the same inbound lane, although two different connectors from that lane share the initial physical lane. The existing same-connector spacing guard does not cover this combination. This is a plausible collision/overlap risk requiring a targeted moving-vehicle test.

**Overall assessment:** Sound starting architecture for a prototype; not yet an adequate production traffic model for a game in which intersection engineering is the main challenge. Fix correctness bugs and instrument the simulation first, then evolve from connector-wide locks to conflict-zone/arrival-time reservations and more capable signal control.

## What the implementation currently does

The relevant pipeline is:

1. `NET.addEdge` / `NET.rebuildAround` build directed `Lane` tracks and a set of possible turning `Connector` tracks. Turning rules are defined by `lanePairs()` ([game.js L460–542](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L460-L542)).
2. `computeConflicts()` samples connector centerlines and records another connector as incompatible if its rail crosses or comes within `CFG.CONFLICT_R = 10.5`, except for different choices from the same inbound lane ([L547–589](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L547-L589)).
3. `buildSignal()` groups incoming roads into up to two green phases by their heading relative to the first approach ([L591–613](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L591-L613)). The fixed timing is 8.5 seconds green and 1.2 seconds amber ([L73–79](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L73-L79)).
4. Each `simStep` rebuilds and sorts per-track vehicle lists, calls `arbitrate()`, then runs lane changes and `Car.step()` ([L2977–3025](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L2977-L3025)).
5. To request entry, the car must be on the correct inbound lane, have finished its lateral move, have no lane leader ahead, and be within a speed-based stopping distance. Arbitration then checks signal/stop permissions, occupied *conflicting connector IDs*, approaching priority traffic, the outbound lane, and a vehicle already on the *same* connector ([L1431–1504](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L1431-L1504)).
6. A granted claim remains active through the connector and until the vehicle's rear has moved `len/2` into the outbound lane ([L1199–1219](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L1199-L1219)).

These checks are cumulative: an apparently empty, green intersection may still reject a car because its required lane is not reached, a compatible stream is claiming too early, the outlet has traffic close to the entry, or its movement geometrically conflicts with someone whose overlap point has already cleared.

## Findings at a glance

**Classification:** *Confirmed* means the cited code unambiguously exhibits the rule/failure path; *risk* means the structure exposes a credible problem but reproducing an actual vehicle collision or its real-world frequency would require simulation runs. Severity describes potential game impact, not measured prevalence.

| ID | Severity | Confidence | Finding | Primary effect |
|---|---|---|---|---|
| F01 | High | Confirmed | Whole-connector conflict locks are held until the rear clears the connector | Unnecessarily serial movements |
| F02 | High | Confirmed | Signals control incoming approaches, not individual movements | Red-bound compatible turns cannot go; green-turn contention |
| F03 | High | Confirmed | Speed-based reservation window can be 100–145 px upstream | Premature exclusion of competing movements |
| F04 | High | Confirmed | Removed-node connector causes `arbitrate()` to `return` globally | All other intersections temporarily stop issuing grants |
| F05 | High | Confirmed | Ring priority 3 ties highway inbound priority 3 | Vehicles already on roundabout can yield to entrants |
| F06 | High | Safety risk | Different turns from the same inbound lane are excluded from conflict matrix | Insufficient physical separation if a follower enters another connector |
| F07 | High | Confirmed | Cars are deleted after 26 seconds below 6 px/s | Silent despawn during legitimate queues, masks gridlock |
| F08 | Medium–High | Confirmed | Fixed-lookahead priority rule has no arrival-time calculation | Excessive waiting and possible starvation at unsignalled crossings |
| F09 | Medium–High | Confirmed | Single reference-heading phase partition breaks down at unusual angles | Two conflicting arms same green, or only one phase |
| F10 | Medium | Confirmed | Turn sharing and mandatory lane sorting create queue interference | Through cars blocked behind turns; failed merges and reroutes |
| F11 | Medium | Confirmed | Outbound clearance uses only current first-car location | Predictably moving exit traffic blocks entries unnecessarily |
| F12 | Low–Medium | Confirmed | Stop control permits rolling passage below 7 px/s | Does not model a complete stop |
| F13 | Medium | Confirmed | Signal offsets and parts of vehicle behavior use `Math.random()` rather than seeded `rng()` | Non-reproducible performance measurements |

## Detailed findings

### F01 — Conflict locks cover the entire connector, not the actual conflict region

**Code:** [L547–589](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L547-L589), [L1478–1502](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L1478-L1502), [L1215–1219](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L1215-L1219).

For any pair flagged as conflicting, `node.occ.get(otherConnector.id)` forbids *all* concurrent occupancy until the first car's rear has exited its own connector. Yet two movements may only overlap physically near the start or middle, with no danger in both being active after one car has passed that area. Larger junctions, slower turn paths, and trucks extend the blanket exclusion interval. The conflict algorithm does not record the arc-length interval on each path where the geometries are close, so arbitration cannot distinguish actual shared conflict-zone use from harmless simultaneous traversal elsewhere.

**Example:** A left-turn car has already passed the crossing point but remains on the last portion of its curved connector. A straight car on a crossing approach remains blocked for the entire remaining path plus rear clearance. This is a policy-driven throughput loss, not evidence of a single global intersection lock.

**Fix:** Represent pairwise *conflict zones*: for each connector pair store a bounded segment (entry/exit `s`) or grid cells swept by each vehicle footprint, and reserve zone occupancy over predicted time windows. A car should release a **specific conflict zone** when its rear clears that zone, without necessarily releasing its entire movement claim. Start with one zone per crossing and add merges/shared starts; require geometry-focused tests for trucks.

### F02 — Traffic lights are per approach; turn-specific opportunities are lost

**Code:** [L593–613](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L593-L613), [L1416–1422](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L1416-L1422), [L1471–1476](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L1471-L1476).

`signalAllows()` checks only `conn.fromLane.id` against the lane's red/green phase; the turn angle, outgoing lane, or compatible simultaneous movement is irrelevant to signal permission. For instance, the tests show all four independent right turns can be reserved together at a **YIELD** junction; at a normal two-phase **SIGNAL** junction, the right turns originating on red approaches are prohibited despite their geometrical compatibility. The current signal model has no right-turn bypass policy, dedicated left-turn arrows, permissive-left precedence rule, queue-responsive phase duration, or synchronized corridors.

During one green, through and left movements of equal-ranked approaches compete purely through connector occupancy and sort order; a left-turn reservation can keep opposing through traffic stopped, including movements that should arguably receive priority in a conventional permissive-left policy.

**Fix:** Make signal groups sets of *movements* rather than only approaches. Implement an explicit intersection policy, e.g. opposing through/right phase with permissive left yield; optional protected left phase when demand warrants; configurable right-on-red only if desired for the game's traffic conventions. Then optimize phases using a conflict matrix and traffic demand. Do not turn on every non-conflicting movement automatically regardless of intended signal policy: movement-level safety and signal permissions are separate questions.

### F03 — The just-in-time request window grants claims too far upstream

**Code:** [L1455–1464](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L1455-L1464), [CFG L60–79](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L60-L79).

The arbiter authorizes a lead car once `dist <= max(2 + len + 6, v²/(2·135) + len/2 + 2 + 6)`. This is a **braking-distance eligibility window**, not a short entry-slot reservation window. For a normal 15px car it begins at approximately 23px at rest, 45.5px at 90px/s, 98.8px at 150px/s and 135.5px at 180px/s. Once granted, `occ` immediately blocks all conflicting movements even while that car is approaching.

This deliberately prevents waiting vehicles far up a queue from claiming; the existing [junction reservation design](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/docs/superpowers/specs/2026-10-15-junction-reservation-design.md) explicitly specifies the braking-distance window. That design solves early *queued* claims but still over-reserves on faster roads.

**Fix:** Separate (a) the advance **decision/braking horizon** from (b) a near-entry **commit/occupation horizon**. An approaching car can be told whether to decelerate without holding every conflict-zone reservation from braking distance onward. Require a time-of-arrival or short-horizon safety check before actual admission. Keep hard stop-line safeguards.

### F04 — A road edit can pause intersection grants everywhere

**Code:** [L1435–1449](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L1435-L1449), [L760–839](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L760-L839).

If any still-living car occupies a connector whose node has been removed from `NET.nodes` (notably when converting a junction into a roundabout, or reversing the conversion), the first scan in `arbitrate(cars)` executes an unconditional **`return`**. That exits the *whole* arbitration pass and prevents completely unrelated intersections from granting claims that tick. Existing claims can continue; new ones cannot. This behavior repeats until the old crossing vehicle no longer satisfies the condition.

**Fix:** Mark a local *affected spatial region* or affected new ring nodes as temporarily draining. Skip grants only for overlapping movements around the edited junction. Do not return from the global arbiter. Add a regression test where one vehicle finishes a removed junction while an unrelated junction continues admitting a vehicle.

### F05 — Highway traffic can tie with vehicles already circulating a roundabout

**Code:** [L365–379](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L365-L379), [L1424–1429](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L1424-L1429), [L1478–1489](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L1478-L1489).

Ring connectors have priority 3, but all three-lane highway approaches also have priority 3 (`fromLane.edge.spec.lanes`). At a ring node controlled by yield, equal-priority approaching traffic triggers right-of-way checks in *both* directions. The code comment says ring traffic outranks everything, but it does not outrank a highway entrance.

**Fix:** Explicitly check `node.isRing` or entering-versus-circulating movements, giving circulating traffic priority over every entering edge. Don't derive roundabout priority solely from lane count. Test ring vehicle moving and highway entry approaching at the same time.

### F06 — Shared incoming lane movements have no cross-turn conflict guard

**Code:** [L563–566](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L563-L566), [L1493–1501](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L1493-L1501), [L1080–1091](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L1080-L1091).

`computeConflicts` unconditionally skips pairs if their `fromLane` is identical. This is justified in a comment by the fact that those cars queue on the inbound lane, but it means that after the front car enters one connector, a follower wishing to take a *different connector* has no occupancy conflict with the first car. The later `inside = conn.firstVehicle()` check also checks only the follower's *chosen* connector, not the preceding car's different connector. `findLeader()` looks ahead along the selected route; it need not detect a leading car on the other connector. Separate turns often physically overlap for their initial segment before diverging.

A collision is **not proven by static inspection** because approach-lane spacing and vehicle speeds may usually provide sufficient headway. However, the arbiter has no explicit shared-prefix gap guarantee for this case, particularly when a fast follower reaches the entry while the lead car is turning slowly.

**Fix:** Add shared-prefix / merge-zone incompatibility and a speed-aware admission gap across *all* connectors from the inbound lane. Use swept vehicle extents and test fast followers behind slow right/left turns, including trucks. Do not simply mark an entire approach mutually exclusive forever: preserve safe pipelining as vehicles separate.

### F07 — Legitimate waiting cars silently vanish after 26 seconds

**Code:** [L1173–1196](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L1173-L1196).

`this.wait` increments while velocity is below 6px/s and resets when higher. At `this.wait > 26`, a car executes `this.kill(); return;`. This isn't restricted to malformed routes; a car stopped at red, yield, stop, blocked exit, or queue can be deleted simply for waiting. A very slow vehicle inside an intersection is not explicitly exempt, either. The despawn may conceal gridlock in the statistics while visually making a car disappear.

**Fix:** Distinguish *legitimate control delay* from *diagnosed unrecoverable deadlock*. Retain the car during ordinary queues. For a genuine stuck case, attempt safe reroute or re-spawn with telemetry and a debug warning, never a silent 26-second deletion. Expose a despawn reason counter.

### F08 — Yield/priority arbitration is based on fixed distance, not safe time slots

**Code:** [L1478–1490](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L1478-L1490), [CFG L73–79](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L73-L79).

For every higher/equal-priority geometrically conflicting connector, a requester yields if the last vehicle on that inbound lane is following the conflicting route, moving faster than 3px/s, and less than 78px from the connector. The check does not ask whether that vehicle is actually expected to arrive during the requester's conflicting *time interval*, whether it can enter, or where the shared region lies. Symmetric approaching vehicles can both yield until one slows, even though a definite ordered allocation would permit predictable progress. A never-ending dominant stream can postpone minority roads indefinitely.

**Fix:** Use estimated arrival and clearing times (with acceleration / braking and length constraints), then order requests by control policy and accumulated *request wait time*. For unsignalled conflicts, schedule a safe gap rather than treating all traffic within 78px as an imminent threat. Test high/low approach densities and bound fairness delay; avoid using the 26-second kill as a fallback.

### F09 — Angle-based signal grouping can misclassify irregular intersections

**Code:** [L591–613](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L591-L613), [L1404–1422](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L1404-L1422).

The first incoming approach sets a reference axis. Every other approach within 45° of that undirected axis is phase 0; the remainder is phase 1. This is not a general phase-grouping algorithm. For a very shallow 5° two-road crossing (which the road tests explicitly allow), both crossing road axes can fall into phase 0, producing `phases=1`. Since the rest of the code treats only `phases > 1` as signalled, its control policy silently behaves like an unsignalled yield junction. For asymmetrical multi-arm connections, different conflicting approaches may show simultaneous green but then be serialized by conflict arbitration.

**Fix:** Construct a movement compatibility graph (or, at minimum, cluster actual opposite arms and explicitly handle skewed/Y intersections). Reject unsafe phase assignments at build time and ensure a `SIGNAL` node with genuine crossing roads has a meaningful plan rather than silently reverting to one phase.

### F10 — Shared turn/through lanes and imperfect lane sorting amplify queues

**Code:** [L460–480](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L460-L480), [L1285–1324](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L1285-L1324), [L1183–1189](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L1183-L1189).

On a two-lane road, right turns and outer-lane through traffic share lane 0; left turns and inner-lane through traffic share lane 1. There is no dedicated turn pocket, so one blocked turn can hold an entire through queue. Route planning assigns the desired lane, but actual merging depends on MOBIL gaps and lateral completion. A car near the junction on the wrong lane brakes to the stop line, and only after 3.5s stopped attempts strict rerouting. In real congestion this can look like cars refusing to use free intersection space.

**Fix:** Provide optional turn-only and/or short storage lanes, lane-to-turn policies users can upgrade, and improve route cost to reflect queue length and merge feasibility. Make pre-sorting mandatory earlier but never unsafe. Test jams with mixed turns on two- and three-lane approaches, not just one isolated pre-sorting car.

### F11 — Downstream clearance is a static snapshot

**Code:** [L1493–1497](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L1493-L1497).

A claim is rejected if the first car on the outbound lane currently has its rear closer than `car.len + BOX_CLEAR` to that lane's start. This protects against blocking the junction — a good rule — but makes no prediction about how far that car will travel before the incoming vehicle could reach the exit. The result is unnecessary waiting on otherwise clearing exits. Conversely, the check is not a comprehensive prediction of later congestion during the manoeuvre.

**Fix:** Retain anti-gridlock clearance, but use predicted exit occupancy at the expected arrival time with a safety buffer and account for the leading car's acceleration and traffic ahead. Start with a conservative upper bound and verify no box blocking.

### F12 — STOP control allows rolling stops

**Code:** [L1475–1476](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L1475-L1476).

The requirement is `car.v <= STOP_V` (`STOP_V = 7`) at close range, not a true stop or a minimum dwell period. This may be an intentional arcade abstraction, but it should be designed explicitly. If the player expects all-way stop behavior, add an actual stop arrival/queue order and a small stopped dwell interval.

### F13 — Key timing is not entirely deterministic

**Code:** [L607–613](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L607-L613), [L1010–1023](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L1010-L1023), [L1508–1510](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/game.js#L1508-L1510).

The game has a seeded PRNG and a `?seed=` parameter, but initial signal timers, car behavior factors/colors and some other events still use `Math.random()`. This means two playthroughs of nominally the same city and seed can have different signal offsets, driving speeds and hence traffic patterns. Debugging throughput becomes harder.

**Fix:** Route all simulation-affecting randomness through a seeded PRNG; keep cosmetic randomness independent. Add deterministic fixed-timestep replay tests and record the seed/scenario with any performance result.

## What the existing tests establish — and do not establish

The most relevant automated tests are [tests/intersections.test.cjs](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/tests/intersections.test.cjs) and [tests/lane-presorting.test.cjs](https://github.com/mjg1911/Traffic/blob/0749857585830e6d9d0f9d489f6fa3d7ac0f823e/tests/lane-presorting.test.cjs). They include asserted reservations for opposite street through cars, four independent right turns at a yield junction, 4-lane avenue and 6-lane highway through movements, actual simultaneous crossing and claim release, truck clearance, blocked exit rejection, stop/red/amber denial, pre-sorting, and safe rebuilding.

These are **useful unit/controlled-scenario tests**, not evidence that realistic traffic attains good concurrency: many start cars a few pixels from the junction, preselect ideal matching routes, set speed to zero, and bypass trip generation and multiple neighbouring intersections. Tests of a rebuilt junction ensure the edited location is protected but do not test the global arbitration-return bug. There is no demonstrated long-run throughput/latency benchmark, conflict-zone occupancy trace, collision count, stress fairness bound, or scenario with full mixed turning queues. The repository's older validation document reports 43 passed at the time of that validation; that report should not be interpreted as a fresh test execution against this commit.

**Verification limitation:** This investigation was a read-only review of repository source and tests using the connected GitHub repository. I could not clone/run the game or execute the Node suite in this environment. Findings labelled confirmed follow directly from source control flow and arithmetic; frequency, exact throughput impact, and the possible F06 physical overlap require runtime tests. No repository code was modified.

## Recommended implementation sequence

### Phase 0 — Instrument and reproduce, before altering behavior

Add counters to the `arbitrate()` decision path for `wrong_lane`, `lateral_move`, `not_lead`, `request_too_early`, `red_or_amber`, `stop_permission`, `conflicting_claim`, `approaching_priority`, `exit_blocked`, `same_connector`, and `draining`. Record per-node occupancy, active cars per junction, time spent waiting, movement attempts/grants, and lane/turn type; make a toggleable debug overlay. Save a seeded scenario and run with the exact same demand.

At minimum, construct repeatable scenes for: orthogonal signal 4-way, unsignalled yield 4-way, angled 3-way, 5° crossing, avenue/highway mixed movements, highway entrance roundabout, blocked downstream link, junction being edited with another junction busy, and mixed dense traffic.

### Phase 1 — Fix correctness regressions safely

1. Replace the global `return` for a retired node with a spatially local drain block; add a two-junction regression test (F04).
2. Give ring circulation explicit priority over **all** entry roads, including highways (F05).
3. Replace the unconditional 26-second traffic despawn with route/deadlock diagnosis and telemetry; legitimate queues must persist (F07).
4. Introduce a shared incoming-lane diverge gap check independent of connector identity; test fast follower / slow turn before enabling more concurrency (F06).
5. Make one-phase signal misclassification visible and deterministic; require valid signal plans for skewed junctions (F09).

### Phase 2 — Recover safe concurrency without rewriting everything

1. Distinguish braking/intent horizon from near-entry commitment, then measure claim lead time (F03).
2. Store geometric **conflict intervals** along each connector. Allow overlaps when the earlier car has passed the relevant conflict interval with its rear; keep a conservative car/truck envelope (F01).
3. Replace fixed approach-distance dominance with arrival-time-based gap checking and a fairness queue for priority/yield (F08).
4. Predict outbound lane space at departure/exit time rather than from current `s` alone, without violating don't-block-the-box (F11).

Implement this progressively behind a compatibility flag and rerun collision/throughput regression scenes at every step.

### Phase 3 — Make signal and lane design meaningful gameplay

1. Introduce movement-level phase definitions, safe permissive left-turn yield, optional protected turn phases, and an explicit right-turn-on-red game rule (F02).
2. Allow players to improve turning capacity through dedicated turn pockets / lane-use settings, signal timing, and priority controls (F10).
3. Add vehicle-demand-aware phase selection with starvation limits, optional arterial signal coordination, and stable seed-based evaluation.

## Proposed acceptance tests

- **Safety:** Zero overlapping swept vehicle rectangles or invalid concurrent conflict-zone occupancy across the seeded dense-traffic suite, including trucks, tight turns, high speeds, and intersections modified while active.
- **Concurrency:** Opposite through cars on normal streets, both directions of each parallel through lane on avenues/highways, and four independent right-turn movements at an unsignalled junction remain safe and simultaneously eligible. New tests must exercise mixed compatible movements with realistic speeds and upstream queues.
- **Localized edits:** A vehicle clearing a retired connector blocks only the edited footprint, never an otherwise unrelated node.
- **Priority:** A highway-fed roundabout always allows an eligible circulating car ahead of a conflicting entry vehicle.
- **Liveness:** No silent despawn from a red phase or legitimate queue; low-priority streams get bounded opportunities under chosen realistic demand scenarios, rather than requiring the 26-second removal mechanic.
- **Signals:** Every generated signal plan covers all inbound movements, has explainable conflict-safe green combinations, handles skewed junctions, and does not silently become unsignalled.
- **Benchmarks:** At identical seeded demand, record successful crossings per simulated minute, average and p95 waiting time, queue length, reservation lead time, actual peak simultaneous cars inside each junction, near misses, and per-cause denial shares. Require no safety regression and a sustained improvement over measured current behavior before shipping changes.

## Suggested first engineering tasks (in priority order)

| Order | Task | Why it comes first |
|---|---|---|
| 1 | Add arbitration denial telemetry and deterministic seeds | Establish which gate is responsible in actual gameplay |
| 2 | Fix global edit return, ring priority, and unintended despawn | High-confidence correctness changes, easy targeted tests |
| 3 | Add shared-prefix cross-turn spacing and moving-vehicle tests | Protect safety before relaxing conflict exclusion |
| 4 | Split decision horizon from reservation commitment | Prevent far-away cars from locking the box |
| 5 | Model pairwise conflict zones and release by physical clearance | Most direct way to improve real simultaneous movement |
| 6 | Implement robust movement-based traffic phases | Unlock compatible movements and rational turn priority |
| 7 | Improve stop/yield time gap scheduling and turn-lane capacity | Reduce starvation and queue interference |
| 8 | Run deterministic city-scale stress benchmarks | Demonstrate actual improvement rather than only passing examples |

## Bottom line

The primary issue is **overly coarse management of space and time**, not a literal single-car lock. You already have enough lane/connector geometry to calculate substantially better movement compatibility. The largest design improvement is to allocate actual crossing/merge regions during predicted occupation windows, then design signal phases and lane rules around those movements. Before that refactor, fix the confirmed global-edit, priority and vehicle-lifetime errors, and instrument the reasons that cars are being refused entry. This approach should improve visible intersection throughput **without sacrificing collision safety**.
