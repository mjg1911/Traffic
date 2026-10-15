# One-Way Direction Toggle Implementation Plan

> **For agentic workers:** This small change is being implemented inline in the current session.

**Goal:** Let players reverse an existing one-way road by selecting One-way in Upgrade mode and clicking that road.

**Architecture:** Store direction using the existing endpoint order. Swap the endpoints and negate the bend so the road keeps its shape, rebuild junction lanes, refresh building access, and reroute traffic. No save-format change is needed because endpoint order is already serialized.

**Tech Stack:** Browser JavaScript, existing Node-based test suite (not run for this request).

## Global Constraints

- Keep the change focused on one-way direction selection.
- Preserve the road curve and existing city save format.
- Do not add or run tests unless the user asks for testing or verification.

---

### Task 1: Reverse direction from Upgrade mode

**Files:**
- Modify: `game.js` network mutation and Upgrade click handler.
- Modify: `game.js` Upgrade help text.

**Implementation:** Add a network method that accepts only `ONEWAY` edges, swaps `n1`/`n2`, negates `bend`, rebuilds affected junctions, and marks building access dirty. In Upgrade mode, when the selected road type and clicked road are both `ONEWAY`, invoke that method and mark traffic for rerouting. Other upgrade behavior remains unchanged.

**Review:** Inspect the resulting diff and confirm the direction state remains represented by the already-saved endpoints. Tests are not added or run under the current instruction.
