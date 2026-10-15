# Opposing Signal Phases Design

## Goal

Restore the earlier traffic-signal behavior where opposing approaches can display green at the same time.

## Design

Assign each incoming approach to one of two signal phases based on its road axis. Approaches pointing in opposite directions share an axis and therefore share a phase. This restores the grouping rule previously used by `buildSignal()`.

Keep signal duration, amber transitions, signal display, connector conflict checks, and reservation arbitration unchanged. The change affects traffic signals only; stop-control behavior remains unchanged.

## Alternatives considered

- Restore road-axis grouping, matching the requested earlier behavior.
- Keep conflict-graph coloring and add special pairing for opposing approaches, which is more complex and may still split approaches when turn movements conflict.

The first option is selected because it directly restores the described behavior.

## Scope and verification

Change only the phase-assignment logic in `game.js`. The user will test the behavior in the game after implementation.
