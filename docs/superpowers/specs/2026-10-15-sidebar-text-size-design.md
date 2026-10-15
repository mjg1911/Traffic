# City tools panel text size

## Goal

Make the text in the left City Tools panel easier to read without changing the map or the rest of the interface.

## Approved design

Add a compact `A+` / `A−` toggle in the City Tools panel heading. It switches between the current typography and a larger size, approximately 125% of the current size. The toggle changes to `A−` while the larger setting is active and exposes its state to assistive technology.

Remember the selection in browser local storage so it remains in effect after reload. If storage is unavailable, the control still works for the current page session and the default remains the current text size on the next load.

## Behavior and presentation

- Apply the larger size to text throughout the left panel, including tabs, tool names, descriptions, notes, diagnostics, and statistics.
- Keep icons, the map, the top bar, and other interface text at their current sizes.
- Keep the setting available at the top of the panel in both themes and at narrow viewport widths.
- Preserve the existing panel layout and let its current scrolling behavior accommodate taller content.

## Implementation and accessibility

Use a panel-scoped CSS scale so typography can increase without zooming the controls or map. Add a semantic button with an accessible name, visible keyboard focus, and an `aria-pressed` state. Initialize the setting from a dedicated local-storage key; guard storage reads and writes so privacy modes or storage errors do not prevent use of the panel.

## Verification

Review the markup and styles at desktop and narrow breakpoints, confirm the toggle applies only to the left panel, confirm its pressed state and label track the selected size, and confirm the choice survives a page reload when storage is available.

## Scope

This change is limited to readability in the City Tools panel. It does not change simulation behavior, map scale, city data, or save formats.
