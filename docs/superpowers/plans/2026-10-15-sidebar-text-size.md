# City Tools Panel Text Size Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent two-size text toggle at the top of the left City Tools panel.

**Architecture:** Add a semantic toggle beside the existing panel heading icon. Store its standard/large state in browser local storage and reflect that state on `#sidebar`; CSS scales typography only inside that panel, leaving glyph icons and the rest of the application unchanged.

**Tech Stack:** Existing HTML, CSS, and dependency-free browser JavaScript.

## Global Constraints

- Apply the larger size to text throughout the left panel, including tabs, tool names, descriptions, notes, diagnostics, and statistics.
- Keep icons, the map, the top bar, and other interface text at their current sizes.
- Keep the setting available at the top of the panel in both themes and at narrow viewport widths.
- Preserve the existing panel layout and let its current scrolling behavior accommodate taller content.
- Do not change simulation behavior, map scale, city data, or save formats.

---

### Task 1: Add the persistent City Tools text-size toggle

**Files:**
- Modify: `index.html` in the `#sidebar .panel-heading` markup.
- Modify: `styles.css` for the heading control and panel typography scale.
- Modify: `game.js` for preference initialization, accessible state, and persistence.

**Interfaces:**
- The button is `#btn-text-size`; its `aria-pressed` value is `true` only when large text is active.
- The `#sidebar.text-large` class selects the approximately 125% typography scale.
- The preference key is `arterial-sidebar-text-size`; values are `large` and `standard`.

- [x] **Step 1: Add the button in the panel heading**

Keep the current title and decorative arrow. Wrap the arrow and new button in a right-aligned actions container. The new button starts in the standard state:

```html
<div class="panel-heading-actions">
  <button id="btn-text-size" class="text-size-toggle" type="button"
    aria-label="Increase City Tools text size" aria-pressed="false" title="Increase text size">A+</button>
  <span class="panel-icon" aria-hidden="true">↗</span>
</div>
```

Increment the existing `styles.css` and `game.js` query-string versions in `index.html` so browsers load the updated local assets.

- [x] **Step 2: Add panel-scoped typography scaling**

Set `--panel-text-scale: 1` on `#sidebar` and `--panel-text-scale: 1.25` on `#sidebar.text-large`. Change each textual font-size rule for descendants of `#sidebar` to multiply its current pixel value by `var(--panel-text-scale)`, including the mobile `h1` and `.category-tab` overrides. Leave glyph-only sizes unchanged for `.panel-icon`, `.tool-icon`, `.road-symbol`, `.grid-icon`, and `.help-icon`. Style `.panel-heading-actions` as a compact horizontal group and `.text-size-toggle` as a clearly visible, focusable control with a stable size in both themes and at narrow widths.

Example for an existing panel rule:

```css
.category-tab {
  /* retain the existing layout and colors */
  font-size: calc(9px * var(--panel-text-scale));
}
```

Apply the same multiplier to the current textual values in `.eyebrow`, `h1`, `.category-tab`, `.section-title`, `.tool`, shortcut labels, `.tool-list small`, `.road-types`, `.segmented button`, `.grid-toggle`, `.snap-status`, `.zones button`, `.panel-note`, `.stats`, `.car-debug-row`, `.demand`, `.new-city`, `.tool-help p`, and `#sidebar footer`.

- [x] **Step 3: Initialize and persist the setting**

Read `arterial-sidebar-text-size` safely near the existing theme preference initialization. Add an `applySidebarTextSize()` helper that toggles `text-large`, changes the button text to `A+` or `A−`, updates `aria-pressed`, and updates the accessible name to the action that will occur. Initialize the DOM from the saved value and attach a click handler that flips the state and attempts to save `large` or `standard`. Guard storage access with `try/catch`; a storage error must leave the toggle usable for the current page session.

Use this accessible-name mapping:

```js
button.setAttribute(
  'aria-label',
  sidebarTextLarge ? 'Use standard City Tools text size' : 'Increase City Tools text size'
);
```

- [x] **Step 4: Review the finished change against the spec**

Inspect the resulting markup, CSS rules, and JavaScript diff. Confirm the control remains in the panel heading, all panel text rules use the scale (including narrow-screen overrides), glyph icons and out-of-panel text do not use it, and local-storage failures are caught. `node --check game.js` completes without syntax errors. No automated tests were added or run for this task.
