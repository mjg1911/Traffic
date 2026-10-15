# Circle and Rectangle Zoning Design

Approved in chat on 15 October 2026.

## Goal

Let players choose between the existing circular zone brush and a rectangular area they can size by dragging.

## Design

Add a Circle / Rectangle selector to the Zones panel. Circle remains the default and keeps its current behavior: left-drag paints continuously with the circular brush, right-drag erases, and Ctrl + wheel adjusts the brush radius.

Rectangle starts at the pointer-down location and previews a zone-grid-aligned rectangle while dragging. The start cell and end cell define opposite inclusive corners, so width and height can vary independently. On release, fill every land cell in that rectangle. A click without a drag affects the cell under the pointer. Right-drag erases with the same rectangle shape. Escape, pointer cancellation, or changing tools cancels the preview without applying it.

Rectangle selection uses the existing cell zoning rules: water cells are skipped, changing a cell's zone demolishes a building on that cell, and clearing a cell removes its building. The selector is a session tool preference, defaults to Circle, and does not change city save data or require a save migration.

Show a live shape preview in the selected zone color, with an erase color during right-drag. Keep the existing zone type choices and update the on-screen hint to explain both shapes.

## Alternatives considered

1. **Circle / Rectangle selector (recommended):** Retains one zoning tool and maps Rectangle to a one-shot grid-aligned area, matching the requested drag-to-zone workflow.
2. **Separate rectangle zoning tool:** Makes the action more discoverable as a distinct tool but adds another tool button and tool state for a closely related operation.
3. **Rectangle paint brush:** Paints a fixed-size rectangle continuously as the pointer moves. This follows the circle brush model but does not let a single drag define a specific filled area.

## Scope and compatibility

Changes are limited to zoning input, preview rendering, the Zones panel, and help text. The zone grid remains the saved representation, so existing saves and exports remain compatible. No new dependencies are needed.

## Review criteria

- Circle still paints and erases as before, including brush resizing.
- Rectangle preview follows the pointer, aligns with the zone grid, and allows width and height to vary independently in every drag direction.
- Releasing applies exactly the previewed cells; a click changes one cell.
- Rectangle erase, water skipping, building removal, cancellation, and tool changes follow the existing zoning rules.
- The saved city format remains unchanged.
