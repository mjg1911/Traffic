# Selected Vehicle Route Overlay Implementation Plan

> **For agentic workers:** Use the inline `superpowers:executing-plans` workflow to carry out this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the selected vehicle's active route and trip endpoints in the City tool.

**Architecture:** Add a canvas drawing function in `game.js` that traces the selected vehicle's remaining route from its current position through the actual `Track` paths to its goal. Draw distinct circles around the active leg's departure and target buildings, and call the function between building and vehicle rendering so the selected vehicle remains visible above the overlay.

**Tech Stack:** Existing vanilla JavaScript simulation, HTML Canvas, and the current road graph. No new dependencies.

## Global Constraints

- Keep the overlay limited to the currently selected vehicle, so it does not clutter the city view.
- Draw a subtle dotted line along the vehicle's remaining planned route, using the actual lane and junction connector paths from its live route. Start at the vehicle's current position and end at its active target.
- Mark the active leg's departure building and target building with visually distinct circles.
- On the outbound leg, departure is the trip origin and target is the destination. On the return leg, departure is the destination and target is the origin.
- Follow live reroutes and vehicle movement. Clear the overlay when selection is cleared or the vehicle leaves the simulation.
- During entry or visit phases, retain the endpoint circles but omit the route line when there is no active road route.
- Keep the overlay read-only and independent of saved city data.

---

## File map

- `game.js`: add the selected route and endpoint drawing, and place it in the existing canvas render order. Do not change simulation routing, selection, or save data.

## Task 1: Draw the selected vehicle's route and endpoints

**Files:**
- Modify: `game.js` (add `drawSelectedCarRoute` after `drawBuildings`; call it from `render`)

**Interfaces:**
- Consumes: `W.selectedCar`, `W.cars`, `car.phase`, `car.origin`, `car.dest`, `car.track`, `car.route`, `car.ri`, `car.s`, `car.goalS`, `track.length`, `track.pos(s)`, and `CAM.z`.
- Produces: `drawSelectedCarRoute(alpha)`, a canvas-only renderer for the active leg. It does not mutate simulation state.

- [x] **Step 1: Add the renderer after `drawBuildings`.** Use this function so the route line follows the live `Track.pos(s)` geometry and does not draw stale route data when the vehicle has no current track:

```js
function drawSelectedCarRoute(alpha) {
  const car = W.selectedCar;
  if (toolCategory(W.tool) !== 'city' || !car || !W.cars.includes(car)) return;

  const departure = car.phase === 'BACK' ? car.dest : car.origin;
  const target = car.phase === 'BACK' ? car.origin : car.dest;
  const route = car.route.slice(car.ri);
  if (car.track && route.length && route[0] === car.track) {
    ctx.save();
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < route.length; i++) {
      const track = route[i];
      const fromS = i === 0 ? clamp(car.s, 0, track.length) : 0;
      const toS = i === route.length - 1
        ? clamp(car.goalS, fromS, track.length)
        : track.length;
      const steps = Math.max(1, Math.ceil((toS - fromS) / 8));
      for (let step = 0; step <= steps; step++) {
        const s = fromS + (toS - fromS) * step / steps;
        const p = i === 0 && step === 0
          ? {x: lerp(car.ppx, car.px, alpha), y: lerp(car.ppy, car.py, alpha)}
          : track.pos(s);
        if (!started) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
        started = true;
      }
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([3 / CAM.z, 5 / CAM.z]);
    ctx.strokeStyle = 'rgba(18, 32, 44, 0.88)';
    ctx.lineWidth = 5 / CAM.z;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(75, 219, 177, 0.98)';
    ctx.lineWidth = 2 / CAM.z;
    ctx.stroke();
    ctx.restore();
  }

  const drawEndpoint = (building, color, fill) => {
    if (!building) return;
    ctx.beginPath();
    ctx.arc(building.x, building.y, Math.max(building.size * 0.8, 10 / CAM.z), 0, TAU);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 / CAM.z;
    ctx.stroke();
  };
  ctx.save();
  drawEndpoint(departure, '#4fd8a7', 'rgba(79, 216, 167, 0.12)');
  drawEndpoint(target, '#ffc04d', 'rgba(255, 192, 77, 0.12)');
  ctx.restore();
}
```

- [x] **Step 2: Integrate the route renderer into `render(alpha)`.** Call `drawSelectedCarRoute(alpha)` after `drawBuildings(dark, detail)` and `drawSignals()` and before `drawCars(alpha, detail)`. This keeps roads and buildings as the background, the route visible above them, and vehicles above the route.
- [x] **Step 3: Review the final diff against the design note.** Confirm the change is confined to `game.js`, traces only the remaining route, uses reversed endpoints during `BACK`, omits the route line when the vehicle has no active track, and adds no save or simulation behavior.
