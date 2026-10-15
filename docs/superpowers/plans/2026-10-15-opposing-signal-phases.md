# Opposing Signal Phases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore simultaneous green phases for opposing traffic approaches.

**Architecture:** Keep the existing signal object, timing, amber cycle, and movement arbitration. Replace only the phase assignment in `buildSignal()` with the earlier doubled-angle road-axis grouping, so headings 180 degrees apart map to the same phase.

**Tech Stack:** JavaScript, existing browser game.

## Global Constraints

- Change only signal phase assignment in `game.js`.
- Preserve signal timing, amber behavior, connector conflict checks, and stop-control behavior.
- The user will test the behavior in the game after implementation.

---

### Task 1: Restore opposing approach phase grouping

**Files:**
- Modify: `game.js`, `buildSignal()`

**Interfaces:**
- Consumes: `approachGroups(node.lanesIn)`, each lane's `dir()` method, and the existing `node.signal` state.
- Produces: the existing `node.signal` shape (`group`, `phases`, `idx`, `timer`, `amber`) with opposing approach axes assigned to the same phase.

- [x] **Step 1: Replace conflict-graph phase coloring with road-axis grouping.** For each approach, get the heading from its first lane at the lane end. Normalize that heading modulo π, compare it to the first approach axis, and assign phase 0 when the axis difference is below π/4, otherwise phase 1. Map every lane in the approach to that phase. Keep `phases`, `idx`, `timer`, and `amber` construction unchanged.

- [x] **Step 2: Review the final diff.** Confirm the edit is limited to `buildSignal()` phase assignment and preserves the existing signal state fields and timer initialization. Do not run the test suite; the user will test the behavior in the game.
