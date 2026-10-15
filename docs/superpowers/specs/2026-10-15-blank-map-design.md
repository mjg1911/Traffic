# Blank map creation design

## Goal

Add a top-right **New map** action that starts a blank map. Keep the river and generated landscape, and clear the roads, zones, buildings, and traffic. Preserve the existing **New city** action, which starts the populated starter city.

## User flow

- The top-right **New map** action opens the existing replacement confirmation dialog.
- The dialog copy and confirm button describe creating a blank map.
- Confirming resets the map; cancelling keeps the current map.
- The left-panel **New city** action continues to use the same dialog with its existing starter-city wording and behavior.

## Implementation

Add a top-right button in the existing city actions. Make the shared dialog's title, description, and confirmation label depend on which action opened it. Pass that choice to the existing restart flow. The blank-map path resets simulation and city state, creates a fresh river and landscape seed, fits the camera, and skips both starter-grid construction and starter population. The existing path continues to build and populate the starter city.

No save format changes are needed. Existing save and recovery behavior remains available, and the confirmation warns before replacing the active map.

## Verification

Review the UI bindings and reset paths for both actions, inspect the final diff, and run syntax and whitespace checks. No automated tests will be added or run for this change.
