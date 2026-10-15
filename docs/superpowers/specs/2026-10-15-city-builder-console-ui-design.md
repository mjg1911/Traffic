# City-builder console UI

## Goal

Make Arterial feel like a clearer, brighter city-building game while keeping its existing traffic simulation, road editing, zoning, save, and navigation behavior.

## Approved direction

Use a city-builder console layout with a central map, a concise city header, a contextual left build panel, and a bottom simulation bar. Use dark slate-blue control surfaces, vivid green selection accents, and brighter map and zoning colors. Preserve the light and dark themes.

## Layout

- The header shows the Arterial identity, Riverbend, population, vehicle count, average trip duration, and existing save/load/import/export/theme actions.
- The left panel has four clear categories: Roads, Zones, Junctions, and City. Selecting a category selects its primary tool. Its panel exposes related tools and settings; road type, drawing mode, and grid options appear only in the Roads category where they are relevant.
- The City category holds the existing remove tool, city statistics, demand bars, and New city action.
- A compact traffic card shows the current congestion level, status, and flow bar.
- The bottom bar holds pause, speed, simulated time, lane display, and concise navigation hints. Zoom, fit, compass, and zoning legend remain available over the map.

## Interaction and data

- Keep the existing tool names, keyboard shortcuts, simulation settings, map renderer, and save/import/export behavior.
- Keep existing DOM IDs and `data-tool`, `data-road`, `data-zone`, and `data-draw` hooks used by `game.js`.
- Category selection changes the active tool to the category's primary existing tool: Roads → `ROAD`, Zones → `ZONE`, Junctions → `JUNCTION`, City → `BULLDOZE`.
- Tool selection through keyboard shortcuts also opens the matching category. Reshape, Upgrade, and Roundabout stay available within their related categories.
- Show only statistics already produced by the simulation. Do not add an economy or invented city values.
- Add no runtime dependencies and keep the game usable offline.

## Responsive behavior and accessibility

- Keep labels visible on category controls, retain keyboard shortcuts, and expose selected states through `aria-pressed` or tab semantics.
- At narrow widths, compact or wrap header metrics and controls without covering the central map or hiding primary tools.
- Retain visible keyboard focus and sufficient contrast in both themes.

## Scope

This is a presentation and navigation update. It does not change traffic, road geometry, city data, persistence formats, or add simulation features.
