# Priority Road Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let players mark one or more junction approaches as priority roads, with other approaches yielding.

**Architecture:** Store selected incident edge IDs on each junction node and persist them in save version 3. Calculate priority dynamically in the junction arbiter so selected approaches outrank unselected ones while existing yield-by-road-width, signal timing, reservations, and clearance checks continue to work. Add a dedicated tool, visible approach markers, hover feedback, and usage documentation.

**Tech Stack:** Vanilla JavaScript, Canvas rendering, browser-local JSON saves.

## Global Constraints

- Preserve the existing uncommitted workspace edits.
- Keep current signal, stop, yield, roundabout, conflict, and downstream-clearance behavior.
- Migrate version 1 and version 2 city saves to version 3 without losing saved city state.
- Do not add or run automated tests for this request.

---

### Task 1: Persist priority approaches

**Files:**
- Modify: `city-save.js`
- Modify: `game.js` (`GNode`, `captureCity`, and `restoreCity`)

**Interfaces:**
- `GNode.priorityEdges` is a `Set<number>` of incident non-ring `Edge.id` values.
- Current node saves contain `priorityEdges: number[]` for every node.
- `CitySave.migrate(raw)` returns validated version 3 data.

- [ ] **Step 1: Add version 3 validation.** Set `VERSION` to `3`; recognize version 1 as legacy dimensions and versions 2 and 3 as current dimensions. Accept `PRIORITY` only in version 3. Require each version 3 node to have a unique array of integer `priorityEdges`; after reading edges, require each listed ID to exist, be non-ring, and touch that node. Require `PRIORITY` nodes to have at least one listed edge and other controls to have none.
- [ ] **Step 2: Migrate older saves.** Keep the existing version 1 zone expansion and add `priorityEdges: []` to its nodes. Add a version 2 path that preserves its current zones and buildings while changing the version to 3 and adding an empty list to every node. Return validated version 3 data from both paths.
- [ ] **Step 3: Store and restore runtime selections.** Initialize `GNode.priorityEdges` to an empty `Set`, serialize it as an array, and restore it from migrated node data before rebuilding connectors.

### Task 2: Apply priority-road traffic rules

**Files:**
- Modify: `game.js` (`Connector` priority comparison, `NET.removeEdge`, `NET.splitEdge`, `NET.cycleControl`, and `arbitrate`)

**Interfaces:**
- Add `movementPriority(connector)`: selected approaches at `PRIORITY` nodes return `2`, unselected approaches return `1`, and all other controls retain the connector's existing lane-count or ring priority.
- Add `priorityArmAt(point)`: returns `{ node, edge }` only when the point is near a non-ring edge incident to a junction with at least three arms.

- [ ] **Step 1: Use the selected approach rank.** Sort requests and compare conflicting approaches through `movementPriority`. Leave signal permission, stop-sign timing, conflict occupancy, outbound clearance, and reservation accounting in place.
- [ ] **Step 2: Toggle selected arms.** Selecting the first arm switches a normal junction to `PRIORITY`; selecting more arms adds them; clicking a selected arm removes it. Removing the last arm switches the node to `YIELD`. Rebuilding the junction signal state must clear obsolete signal data.
- [ ] **Step 3: Keep selections valid through road edits.** Remove an edge ID from both endpoints when deleting a road and return an emptied priority node to `YIELD`. When splitting a selected edge, transfer selection to the replacement edge at each original endpoint. The existing junction control tool clears selected arms when cycling away from priority.

### Task 3: Add the player-facing tool and indicators

**Files:**
- Modify: `index.html`
- Modify: `game.js` (tool selection, pointer handling, hover overlay, and `drawSignals`)
- Modify: `README.md`

**Interfaces:**
- Add `data-tool="PRIORITY"` to the Junctions panel without a keyboard shortcut.
- Priority-arm clicks are handled by the existing pointerdown tool switch and display a short toast describing the result.

- [ ] **Step 1: Add the Priority road tool.** Include the control in the Junctions panel; map it to the junction category; add a hint that explains selecting each arm and selecting both arms of a through road.
- [ ] **Step 2: Handle clicks and hover.** Use `priorityArmAt` to toggle a valid approach. Explain invalid clicks. Highlight the target road arm and junction when hovering with this tool.
- [ ] **Step 3: Draw approach markers.** Draw a diamond marker on each selected approach and yield triangles on unselected approaches at a priority junction. Keep signal lights and stop markers unchanged.
- [ ] **Step 4: Update user documentation and cache versions.** Add the usage instruction to `README.md`; increment the `game.js` and `city-save.js` query versions in `index.html`.

### Task 4: Review the implementation

**Files:**
- Review: `city-save.js`, `game.js`, `index.html`, and `README.md`

- [ ] **Step 1: Inspect the final diff.** Confirm only feature-related changes were made and existing user edits remain present.
- [ ] **Step 2: Run non-test checks.** Run `node --check game.js`, `node --check city-save.js`, and `git diff --check`. Do not run the automated test suite.
- [ ] **Step 3: Review migration and traffic paths.** Confirm version 1 and 2 saves receive empty selections, version 3 validates node-to-edge membership, selected approaches outrank unselected approaches, and existing conflict and clearance checks remain intact.
