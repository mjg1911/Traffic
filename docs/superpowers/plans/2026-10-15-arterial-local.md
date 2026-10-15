# Arterial Local Implementation Plan

> **For agentic workers:** Use executing-plans for the connected integration tasks, with a focused helper implementation and independent final review. Track completion below.

**Goal:** Deliver a locally playable traffic management game with clear road tools, straight/cardinal drawing, light/dark themes and durable city saves.

**Architecture:** Preserve the upstream microscopic simulation in `game.js`, extracted from the original HTML. Put pure editing geometry in `road-editor.js` and save validation in `city-save.js`; use classic local scripts so opening `index.html` works offline without a server. Presentation lives in `index.html` and `styles.css`.

**Tech Stack:** Plain JavaScript, Canvas 2D, HTML/CSS, Node's built-in test runner.

## Global Constraints

- Store the playable game and all required assets in `E:\Traffic game`.
- Avoid external runtime dependencies, remotely loaded fonts and remotely loaded assets so offline play remains reliable.
- Preserve `arterial-original.html` as the unmodified reference source and credit its author in the playable version and instructions.
- All delegated work uses gpt-6-luna with xhigh reasoning; never substitute.
- Work directly in this new project folder; there is no Git repository to isolate or commit.

## Task 1: Drawing geometry

Files: create `road-editor.js`, `tests/road-editor.test.cjs`.

Interface: `RoadEditor.snapPoint(point, spacing=50)`; `RoadEditor.endpoint(start, pointer, {grid, straight, spacing=50, nodes=[], tolerance=20})` returns `{x,y,node}`. Export for classic browser scripts and CommonJS tests.

- [x] Write tests before implementation: negative grid coordinates, horizontal and vertical axis selection, free diagonal placement, aligned junction snapping, off-axis junction rejection and no mutation of inputs. Example: `assert.deepEqual(endpoint({x:100,y:100},{x:330,y:144},{grid:true,straight:true}), {x:350,y:100,node:null})`.
- [x] Run `node --test tests/road-editor.test.cjs`; confirm the new behaviour is missing.
- [x] Implement nearest grid rounding; in locked straight mode preserve the start's perpendicular coordinate, snap the varying coordinate and only accept nodes exactly on that axis. Otherwise use ordinary nearest-junction snapping.
- [x] Re-run tests, record outcome.

## Task 2: Offline playable app and road interactions

Files: create `index.html`, `styles.css`, `game.js`, `Play Arterial.cmd`, `README.md`, `tests/game.test.cjs`.

Consumes Task 1 geometry. Keep upstream original unchanged. Extract its script, retaining simulation identities and browser inspection API.

- [x] Add integration tests using the actual game in a Node VM with minimal browser shims: road between two coordinates, road starting on existing edge, straight road axis lock, curved construction, cancellation, and traffic progression.
- [x] Implement a separate Bend tool. Use Straight mode for drag/release placement. Use Curve mode for endpoint drag followed by a second click to set curvature. Compute the control point from `midpoint + normal * bend * 2`, matching `Edge.build()`.
- [x] Resolve preview and committed endpoints through the same geometry helper. Store the proposed edge attachment so locked roads cannot drift to a different axis at commit. Connect crossings by splitting existing and new edges where they meet; disallow intersections too close to existing junctions when splitting cannot be safe.
- [x] Add keyboard G for grid, C for straight/curve, B for bend, Escape to cancel. Ignore shortcuts inside editable controls. Display the 50-unit grid only while locked, thinning lines at distant zoom without changing snapping.
- [x] Replace the sidebar with a compact top bar, left road panel, traffic summary, bottom simulation controls, and expandable city/zoning controls. Include theme toggle, legend, shortcuts, source attribution, and accessible labels.
- [x] Render light cream terrain, pale roads, olive/teal/ochre buildings, blue water and small colourful cars. Dark mode uses slate terrain with readable road/lane contrast. Disable automatic map dimming; theme is independent of simulated clock.
- [x] Expand the starter network and zone it; develop and warm it using bounded simulation steps to begin with buildings and moving traffic. Preserve New city as a fresh starter map.
- [x] Launcher content: `@echo off` followed by `start "" "%~dp0index.html"`. Document that no installation is needed.
- [x] Verify Node integration tests and real browser rendering and road interactions.

## Task 3: Persistence

Files: create `city-save.js`, `tests/city-save.test.cjs`; integrate in `game.js` and `index.html`.

Interface: `CitySave.validate(data)` returns validated data or throws; `captureCity()` returns versioned plain data; `restoreCity(data)` validates before mutation and rebuilds derived geometry.

- [x] Test valid data round trip and rejection of invalid version, non-finite coordinates, dangling node IDs, invalid road types, duplicate IDs, corrupt zoning, buildings and ring references, and unreasonable sizes before implementation.
- [x] Format version 1 includes seed, time, nodes with control/ring metadata, edges with endpoint IDs/type/bend, rings, river geometry, zones and buildings, camera, trips and editing settings. Store only authored state, reconstruct lanes and building attachments; reset vehicles on load.
- [x] Build a complete candidate network and city before replacing live state. On failure retain live city and show a message. Add browser-local Save/Load, file export/import, and a separate recovery save every 30 seconds and on page exit. Do not auto-replace an existing saved city on boot.
- [x] Tests run `node --test tests/*.test.cjs`; verify round trips of actual road geometry, ring topology, city zoning and buildings.

## Task 4: Review and delivery

- [x] Review changes against the approved design; resolve important findings.
- [x] Run `node --test tests/*.test.cjs` and JavaScript syntax checks.
- [x] Test through a loopback-only browser preview (the preview browser blocks direct file navigation): starter traffic, drawing straight and curved roads, grid lock, bend, themes, Save/Load, malformed imports, pause/speed.
- [x] Verify the launcher target and quoted Windows path statically; direct file navigation cannot be exercised in the preview browser. Confirm source links are navigation only, with no external runtime requests.
- [x] Capture a final screenshot, keep the game open, and deliver the launcher link plus essential controls.

## Progress

Plan reviewed against the approved spec. Execution proceeds in this session without further scope approvals.


Completed: 43/43 automated tests pass; syntax checks pass; independent review approved after geometry and ring-validation fixes. Browser checks confirmed straight and curved construction, grid lock, demolition, themes, pause and local Save/Load. Browser file-picker import was blocked by upload permission; the actual async import handler and malformed-data preservation are covered automatically. Launcher path and all local resources audited; direct file launch remains a manual check.
