# Arterial — Traffic workshop

Double-click **Play Arterial.cmd** in this folder to play. You can also open **index.html** directly in Edge, Chrome or Firefox. Keep the files together. No installation, account, server or Internet connection is needed.

## Build and manage roads

- **Straight:** drag from the start to the end of your road, then release.
- **Curve:** drag to set the two endpoints, release, move the mouse to shape the curve, then click to build.
- **Lock to grid (G):** show a 50-unit grid and snap your road endpoints. Straight roads are constrained to north–south or east–west. An existing junction can be off-grid; a road starting there stays aligned with that junction.
- Start or finish on an existing road to connect it. Roads crossing one another form a junction automatically. Leave space between junctions; cramped connections are rejected without changing the network.
- **Reshape (B):** drag the middle of an existing road to bend it. Escape restores its shape while dragging. Bends that would create an unconnected crossing are rejected; draw a new connecting road instead.
- **Upgrade (3):** choose a road type, then click an existing road to change it. One-way single carries one lane and One-way carries two; both follow their drawn direction. Select the same one-way type and click that road to reverse its direction.
- **Signals (4):** click a junction with three or more roads to cycle traffic lights, stop and yield control.
- **Roundabout (5):** click a junction to convert it; click a roundabout node again to restore a normal junction.
- **Priority road:** choose the tool, then click each road arm that should have right of way. Click an arm again to remove its priority; the other approaches yield.
- **Lane connections:** choose the tool and click a regular junction. Click an incoming lane end to select it, or drag from it to an outgoing lane end to add or remove that movement. Only the lane you edit becomes manual; untouched lanes keep their automatic turns. Choose **Reset selected lane** to restore its automatic turns. Roundabouts stay automatic. Changes are saved with the city.
- **Pre-sorting lanes:** choose the tool under intersection controls, click a regular junction, then click an incoming road arm near it to add turning lanes on that side only. Click the same arm again to remove its lanes. **1 box** is the default and adds a left-turn lane; if that arm only has a right turn, it adds a right-turn lane. **2 boxes** adds both where available. The choice applies to new placements and leaves existing arms unchanged. Drag each blue handle along its road to set that lane's length; release to apply it. Escape cancels a resize. Through lanes remain available, and cars merge into the turning lanes near the junction. Lengths stop before the next intersection. Use **Remove all pre-sorting lanes** to clear the selected junction. Lengths are saved with the city.
- **City:** click vehicles to inspect them. **Remove roads or buildings** is a toggle that starts off; turn it on to remove objects by clicking or dragging. Press **6** to toggle removal; from another category, it enters City with removal enabled. Right-click removes map objects in other categories and follows the toggle in City.
- **Escape:** cancel the road you are drawing. Changing tools also cancels an unfinished road.

Use **WASD** to pan. Hold **Space** or **Shift** and drag to pan, or scroll to zoom. **F** fits the city, **P** pauses, **Q** cycles road types, **C** switches straight/curve, and **L** toggles lane routing. The view buttons also zoom and fit.

Choose **Zones** in the left tool panel for homes, shops and industry. **2** selects zone painting. Choose **Circle** to paint continuously as you drag, or **Rectangle** to drag out and fill a grid-aligned area with independently sized sides. Right-drag erases with the selected shape; Ctrl + scroll adjusts the circle brush size. The starter city already contains buildings and traffic. The missing road connection along its north side is a useful first experiment.

**Dark mode** changes the controls and map together. Your choice is remembered. The simulated time of day affects travel demand, while your selected theme controls the map lighting.

## Keep your city

- **Save city** stores your city in this browser on this PC. **Load** lets you choose the manual save or recovery slot.
- The **recovery** slot updates every 30 seconds and when the page closes. A new game starts with a fresh starter city; use Load to resume a saved one. The manual slot changes only when you click Save city.
- **Export** downloads an `arterial-city.json` backup. **Import** opens one of these backups after validating it. Invalid files leave the current city intact.
- Browser-local storage belongs to the browser and file location. Clearing browsing data, moving this folder or using another browser can make those saves unavailable. Use Export for lasting backups.
- Roads, curves, junction controls, priority approaches, roundabouts, zoning, buildings, time, camera and drawing settings are saved. Active vehicles start fresh trips after loading; exact in-flight journeys and signal countdowns are not saved.

## Credits and local adaptation

Original simulation: **Anthony Ellis**, [Arterial](https://anthonyellis.dev/projects/arterial/), [source](https://github.com/AnthonyEllisDev/portfolio/blob/main/demos/arterial.html).

`arterial-original.html` is the unmodified downloaded reference. This local adaptation retains the original road graph and car-following foundations, extends traffic planning and movement, and adds road tools, presentation, themes and persistence. Visual inspiration: the [Trafficity gameplay trailer](https://www.youtube.com/watch?v=fUkBn6H-d-A). No Trafficity artwork or code is included. This is a top-down simulation; elevated roads and grade-separated interchanges are outside this version.

The original source was supplied for personal local adaptation. Check the upstream project's license/permissions before redistributing an adapted version.

## Development checks

With Node.js installed, run `node --test --test-concurrency=2 tests/*.test.cjs` from this folder. Tests exercise grid geometry, actual road network editing, save validation, round trips and resumed traffic. The game itself does not require Node.js.

## Traffic AI and analysis

Cars plan legal lane sequences across upcoming junctions and estimate travel time from speed limits, queues and smoothed traversal observations. They prepare adjacent merges early, accept bounded cooperation and replan when a turn becomes unreachable. Route changes need a meaningful expected improvement, which keeps vehicles from switching routes for small fluctuations.

A lane change follows a smooth trajectory. The source lane retains ownership until it finishes, and both lanes account for the crossing vehicle. Cars slow before short turning pockets and before entering short roads that require multiple lane changes. The pocket editor warns when a pocket needs a slow merge; some very short pockets cannot accommodate trucks. Signal stages group compatible movements and skip empty stages; signals display individual turns. Junction reservations check conflicts and exit space, revalidate forecasts and hold vehicles before occupied conflict regions.

City management shows queued vehicles, completed trips per simulated minute, the 95th percentile of recent trip durations, and the main current queue cause. **Lanes (L)** adds vehicle intentions, merge progress, waiting reasons and junction reservations. Diagnostics and observations reset on new city/load; active traffic and its measurements are not part of city saves.

**World scale:** three internal world units represent one displayed metre. A lane is approximately 3.7 m wide, a car 5 m long and a truck 8 m long. Speeds remain world units per simulated second internally; multiply by 1.2 to convert to km/h. Pocket lengths in existing saves remain in world units, and their displayed metre values use this scale. The driving parameters are game settings rather than a calibrated real-world traffic model.

For a repeatable seed-42 benchmark run `node tests/traffic-benchmark.cjs`; add `--baseline` to compare the unchanged `HEAD` simulation. `TRAFFIC_BENCH_SECONDS` changes its default 60-second measurement window. The benchmark includes truck traffic, scans moving rectangular footprints, and reports incomplete safety scans explicitly. CPU figures exclude the external benchmark scanner. The developer API exposes `ARTERIAL.trafficDiagnostics.summary()`, `.getEvents()`, and `ARTERIAL.trafficAnalysis()`; set `ARTERIAL.W.safetyChecks = true` to scan each simulated step without enabling the visual overlay.


To profile a fixed population, set `TRAFFIC_BENCH_CARS` to 60, 120 or 240 and `TRAFFIC_BENCH_SECONDS` to 5 before running the benchmark. This builds a six-lane highway with mixed cars and trucks; it measures free-flow capacity rather than dense-junction capacity. Near-miss results with `possible: true` represent a conservative threshold interval; they are separate from confirmed overlaps and do not weaken collision clearance checks.
