# City save format work report

Implemented the version 1 `CitySave` validator in `city-save.js` as a browser global and CommonJS module. It validates the complete required schema, graph references and topology, ring membership and directed cycle topology, road geometry, river points, the 5,251-cell zone grid, buildings, camera, trips, settings, and documented collection limits. Each declared ring member must have exactly one incoming and one outgoing ring edge, and one directed cycle must cover the full membership. River centrelines require at least two points and river outlines at least three; all stored coordinates are bounded to ±10,000, ring half-width is capped at 100, and IDs stay at or below `Number.MAX_SAFE_INTEGER - 100000` to leave room for generated IDs. It returns the original payload unchanged, including harmless extra properties, and reports invalid files with a field-specific `Invalid city save:` message.

Added `tests/city-save.test.cjs` with a valid authored city containing ordinary roads, a roundabout, river geometry, all three zone/building types, camera settings, and trip data, plus malformed schema, reference, geometry, disconnected ring cycles, cell, ID-range, and size cases. The CommonJS and browser-global entry points are both covered.

Validation was done test-first. The follow-up regression tests first failed on missing ring topology checks. After adding cycle validation:

```text
node --test tests/city-save.test.cjs
16 tests passed, 0 failed

node --check city-save.js
passed
```

`ZONE_COUNT` is derived from the source game's `WORLD_W: 3000`, `WORLD_H: 2000`, and `CELL: 34`, yielding `ceil(3000 / 34) * ceil(2000 / 34) = 5,251`.
