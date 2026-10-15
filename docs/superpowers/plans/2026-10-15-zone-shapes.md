# Circle and Rectangle Zoning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Circle / Rectangle choice to zone painting while retaining the current circle brush behavior.

**Architecture:** Keep zone cells and save data unchanged. Add a session-only shape choice, one shared grid-aligned rectangle calculation for preview and painting, and a filled-cell operation that reuses the existing zone-cell side effects. Rectangle drags preview until release; Circle continues painting continuously.

**Tech Stack:** Browser JavaScript, Canvas, HTML and CSS; no new dependencies.

## Global Constraints

- Circle is the default and retains continuous painting, right-drag erasing, and Ctrl + wheel brush sizing.
- Rectangle follows the zone grid; start and end cells define inclusive opposite corners so width and height vary independently.
- Rectangle applies on release; a click affects the cell under the pointer.
- Both shapes skip water and preserve existing building removal behavior.
- Canceling a rectangle preview or changing tools applies no zone changes.
- Zone shape is a session preference; city saves and exports keep their current format.
- Do not add or run tests unless the user asks to test or verify implementation.

---

## File Structure

- `game.js`: session shape state, rectangle bounds and cell painting, pointer handling, cancellation, and Canvas preview.
- `index.html`: Circle / Rectangle selector within the existing Zones panel.
- `styles.css`: selector spacing, reusing the existing `.segmented` treatment.
- `README.md`: explain the two zoning gestures.

### Task 1: Add the Circle / Rectangle zoning interaction

**Files:**
- Modify: `index.html` in `#panel-zone`.
- Modify: `styles.css` beside `.zones` styles.
- Modify: `game.js` in `W`, `CITY`, canvas pointer events, `cancelDrawing`, `setTool`, `syncUI`, and `drawOverlays`.
- Modify: `README.md` in the Zones usage paragraph.

**Interfaces:**
- Add `W.zoneShape` with values `'circle'` and `'rectangle'`; default to `'circle'` and do not serialize it.
- Add `zoneRectangleBounds(start, end)` returning `{x0, y0, x1, y1}` by mapping both pointer positions to zone cells and returning the inclusive grid-aligned bounds.
- Add `CITY.paintRectangle(start, end, type)` to update every cell between the inclusive start and end cells. Apply each selected cell through shared cell mutation logic so water skipping, zone changes, and building demolition remain consistent with circle painting.

- [x] Add two shape buttons beside the zone-type buttons, using `data-zone-shape="circle"` and `data-zone-shape="rectangle"`, with accessible labels and `aria-pressed` state.
- [x] Add a `zone-shapes` class using the existing `.segmented` button styling; keep the zone type buttons unchanged.
- [x] Add `W.zoneShape = 'circle'` and wire the buttons to update the shape and synchronize selected styling.
- [x] Extract the existing per-cell zone update into one `CITY` method, then have both circular `paint` and rectangular `paintRectangle` use it.
- [x] On Rectangle pointer-down, store the world start point and erase state without changing zones. On pointer-move, update only the preview. On pointer-up, apply `paintRectangle` once and mark city attachments dirty. Keep Circle pointer-down and pointer-move behavior unchanged.
- [x] Draw the grid-aligned rectangle preview from `zoneRectangleBounds(IN.zoneStart, IN.mouse)` with the selected zone color or erase color. Draw the existing circular brush preview only when Circle is selected.
- [x] Clear the rectangle start point in `cancelDrawing`; rely on the existing pointer-cancel and tool-change cancellation paths.
- [x] Update the Zones panel note, active tool hint, and README instructions to describe Circle brush painting and Rectangle drag-to-fill.
- [x] Review the changed source for consistent rectangle preview and fill bounds, preserved circle behavior, and unchanged save data. Do not add or run automated tests unless the user asks for testing or verification.

**Review checklist:** Circle painting still starts on pointer-down and continues on pointer-move; rectangle painting changes cells only on pointer-up; click, varied rectangle proportions, all drag directions, right-drag erase, water, and cancellation follow the design.
