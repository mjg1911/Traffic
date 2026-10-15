# One-Way Single Road Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a selectable one-lane one-way road while preserving the existing two-lane One-way road.

**Architecture:** Add `ONEWAY_SINGLE` to the existing road registry, palette, and road-type cycle. Reuse the current one-way lane generation and reversal flow; extend city-save validation to recognize the new one-way type without changing the save version.

**Tech Stack:** Browser JavaScript, HTML/CSS UI, standalone city-save validation module.

## Global Constraints

- Keep the current save version; existing saves remain valid.
- Automated tests are not added or run for this request.
- Preserve the unrelated working-tree changes already present in the workspace.

---

### Task 1: Add the one-lane one-way road end to end

**Files:**
- Modify: `game.js`
- Modify: `city-save.js`
- Modify: `index.html`
- Modify: `README.md`

**Interfaces:**
- Produces road type key `ONEWAY_SINGLE`, with `lanes: 1` and `oneway: true`.
- `NET.reverseOneWay(edge)` accepts either supported one-way road type and continues returning `false` for other edges.
- City saves remain at version 4 and validate `ONEWAY_SINGLE` edges, lane rules, and selected road-type settings.

- [x] **Step 1: Register the new road type and add it to the cycle.**

In `game.js`, add this entry next to `ONEWAY` in `ROADS`:

```js
  ONEWAY_SINGLE: { key:'ONEWAY_SINGLE', name:'One-way single', lanes:1, oneway:true, median:0, speed:112, cost:1.7, surf:'#2e394f', mark:'arrow' },
```

Set the cycle order to:

```js
const ROAD_ORDER = ['STREET', 'AVENUE', 'ONEWAY', 'ONEWAY_SINGLE', 'HIGHWAY'];
```

The existing lane-offset, road-width, direction, and arrow-marking code already reads these fields and needs no special-case path.

- [x] **Step 2: Add the palette control.**

In `index.html`, add a road card next to the existing One-way card:

```html
<button data-road="ONEWAY_SINGLE"><span class="road-symbol">↑</span><span>One-way single<small>Follows draw direction</small></span><em>1 →</em></button>
```

Keep the current One-way card and its `2 →` label unchanged.

- [x] **Step 3: Extend reversal to all one-way road types.**

In `game.js`, change the guard in `NET.reverseOneWay` from a hard-coded `e.type !== 'ONEWAY'` check to a registry check:

```js
if (!e || !ROADS[e.type] || !ROADS[e.type].oneway || e.type === 'RING') return false;
```

Keep its endpoint swap, bend negation, junction rebuild, and building reattachment unchanged. In the Upgrade handler, reverse when the selected type matches the clicked edge and that selected road spec is one-way. Update the Upgrade help text so it says to select the same one-way type and click it to reverse its direction.

Use this condition in the existing Upgrade branch:

```js
if (hit.edge.type === W.roadType && ROADS[hit.edge.type].oneway) {
```

- [x] **Step 4: Extend city-save validation.**

In `city-save.js`, add `ONEWAY_SINGLE` to `ROAD_TYPES`, map it to one lane in `ROAD_LANES`, and add a one-way type set:

```js
const ONE_WAY_TYPES = new Set(['ONEWAY', 'ONEWAY_SINGLE']);
```

Use `ONE_WAY_TYPES.has(incoming.type)` and `ONE_WAY_TYPES.has(outgoing.type)` in lane-rule direction checks so manual rules cannot travel against a one-way road. Add `ONEWAY_SINGLE` to the supported standard road types in `settings.roadType`. Do not increment `VERSION`.

- [x] **Step 5: Update the player instructions.**

In `README.md`, replace the Upgrade description with:

```md
- **Upgrade (3):** choose a road type, then click an existing road to change it. One-way single carries one lane and One-way carries two; both follow their drawn direction. Select the same one-way type and click that road to reverse its direction.
```

Keep the existing draw-direction behavior clear.

- [x] **Step 6: Review the scoped changes without running automated tests.**

Inspect the final diff for `game.js`, `city-save.js`, `index.html`, and `README.md`. Confirm the new key appears in the registry, palette, cycle, save type/lane maps, lane-rule direction checks, and settings allowlist. Confirm the two-lane `ONEWAY` entry remains intact and `city-save.js` keeps `VERSION = 4`. Do not add or run automated tests.

---
