# Arterial — Traffic workshop

Double-click **Play Arterial.cmd** in this folder to play. You can also open **index.html** directly in Edge, Chrome or Firefox. Keep the files together. No installation, account, server or Internet connection is needed.

## Build and manage roads

- **Straight:** drag from the start to the end of your road, then release.
- **Curve:** drag to set the two endpoints, release, move the mouse to shape the curve, then click to build.
- **Lock to grid (G):** show a 50-unit grid and snap your road endpoints. Straight roads are constrained to north–south or east–west. An existing junction can be off-grid; a road starting there stays aligned with that junction.
- Start or finish on an existing road to connect it. Roads crossing one another form a junction automatically. Leave space between junctions; cramped connections are rejected without changing the network.
- **Reshape (B):** drag the middle of an existing road to bend it. Escape restores its shape while dragging. Bends that would create an unconnected crossing are rejected; draw a new connecting road instead.
- **Upgrade (3):** choose a road type, then click an existing road to change it. One-way roads follow the direction they were drawn; select One-way and click an existing one-way road to reverse its direction. Click again to switch it back.
- **Signals (4):** click a junction with three or more roads to cycle traffic lights, stop and yield control.
- **Roundabout (5):** click a junction to convert it; click a roundabout node again to restore a normal junction.
- **Remove (6):** click or drag over roads and buildings. Right-click also removes them. Right-click during road drawing cancels instead.
- **Escape:** cancel the road you are drawing. Changing tools also cancels an unfinished road.

Use **WASD** to pan. Hold **Space** or **Shift** and drag to pan, or scroll to zoom. **F** fits the city, **P** pauses, **Q** cycles road types, **C** switches straight/curve, and **L** toggles lane routing. The view buttons also zoom and fit.

Open **City & zoning** for homes, shops and industry. **2** selects zone painting. Drag to paint, right-drag to erase, and Ctrl + scroll adjusts brush size. The starter city already contains buildings and traffic. The missing road connection along its north side is a useful first experiment.

**Dark mode** changes the controls and map together. Your choice is remembered. The simulated time of day affects travel demand, while your selected theme controls the map lighting.

## Keep your city

- **Save city** stores your city in this browser on this PC. **Load** lets you choose the manual save or recovery slot.
- The **recovery** slot updates every 30 seconds and when the page closes. A new game starts with a fresh starter city; use Load to resume a saved one. The manual slot changes only when you click Save city.
- **Export** downloads an `arterial-city.json` backup. **Import** opens one of these backups after validating it. Invalid files leave the current city intact.
- Browser-local storage belongs to the browser and file location. Clearing browsing data, moving this folder or using another browser can make those saves unavailable. Use Export for lasting backups.
- Roads, curves, junction types, roundabouts, zoning, buildings, time, camera and drawing settings are saved. Active vehicles start fresh trips after loading; exact in-flight journeys and signal countdowns are not saved.

## Credits and local adaptation

Original simulation: **Anthony Ellis**, [Arterial](https://anthonyellis.dev/projects/arterial/), [source](https://github.com/AnthonyEllisDev/portfolio/blob/main/demos/arterial.html).

`arterial-original.html` is the unmodified downloaded reference. This local adaptation retains the original traffic model and adds road tools, presentation, themes and persistence. Visual inspiration: the [Trafficity gameplay trailer](https://www.youtube.com/watch?v=fUkBn6H-d-A). No Trafficity artwork or code is included. This is a top-down simulation; elevated roads and grade-separated interchanges are outside this version.

The original source was supplied for personal local adaptation. Check the upstream project's license/permissions before redistributing an adapted version.

## Development checks

With Node.js installed, run `node --test tests/*.test.cjs` from this folder. Tests exercise grid geometry, actual road network editing, save validation, round trips and resumed traffic. The game itself does not require Node.js.
