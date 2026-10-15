# City-builder console UI Implementation Plan

> **For agentic workers:** Use inline execution in this session. Keep the current workspace because it is not a Git checkout.

**Goal:** Reorganize Arterial's interface into the approved city-builder console layout without changing simulation behavior.

**Architecture:** Keep the Canvas renderer and simulation model intact. Rework the existing HTML structure and CSS presentation; add a small tool-to-category mapping in `game.js` so category selection and keyboard shortcuts stay synchronized.

**Tech Stack:** HTML, CSS variables, vanilla JavaScript, Canvas 2D.

## Global Constraints

- Keep the game local and offline with no runtime dependencies.
- Preserve existing tool behavior, keyboard shortcuts, save handling, and city data.
- Use only statistics the game already tracks; do not imply that it has an economy.
- Preserve DOM IDs and data attributes consumed by `game.js` unless their references are updated in the same change.

---

### Task 1: Reorganize the game interface

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `game.js`

**Interfaces:**
- `index.html` keeps the existing IDs for save, load, import/export, theme, simulation, camera, statistics, and dialogs.
- Category buttons use `data-tool` for their existing primary tool and `data-category` for their panel; existing tool choices continue to use `data-tool`, road choices use `data-road`, zone choices use `data-zone`, and draw-mode choices use `data-draw`.
- `game.js` maps `ROAD`, `BEND`, and `UPGRADE` to Roads; `ZONE` to Zones; `JUNCTION` and `ROUNDABOUT` to Junctions; and `BULLDOZE` to City.

- [ ] **Step 1: Restructure `index.html` around the approved layout.** Keep the current control IDs, move the existing simulation-backed header metrics into the top bar, group tools into Roads, Zones, Junctions, and City panels, retain the traffic card, and keep pause/speed/time/navigation in the bottom bar.
- [ ] **Step 2: Replace the compact rules in `styles.css` with readable component rules.** Define matching light and dark palettes, clearer selected/focus states, a slate console, brighter map-zone accents, and responsive header/sidebar/bottom-bar behavior.
- [ ] **Step 3: Synchronize the selected category in `game.js`.** Add a category mapping and panel sync function; call it after tool selection, connect category buttons to the matching existing primary tool, and keep road and zoning sub-options visible only in their relevant panels.
- [ ] **Step 4: Update the stylesheet and script query versions in `index.html`.**

**Review notes:** Manually check that every `$('...')` reference in `game.js` still has exactly one corresponding element and that every existing `data-tool`, `data-road`, `data-zone`, and `data-draw` control remains present. Automated tests are not included in this plan because the user did not request test execution.
