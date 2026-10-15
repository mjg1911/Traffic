# Pre-sorting lanes

Approved in chat on 15 October 2026. Add a Pre-sorting lanes intersection tool. Clicking a regular intersection selects it; clicking an incoming road arm adds turning pockets on that arm only. Clicking an already configured arm removes its pockets without changing the other arms. Each pocket has an independently draggable upstream handle. Keep the original through lanes; cars merge into a pocket only within its usable length and only with a safe gap. Roundabouts remain automatic.

Store lengths on the junction, keyed by incident road ID. Clamp lengths to the usable approach, leaving space at the upstream junction. Preserve existing manual connections on ordinary lanes. Newly added pockets have automatic turn connections and may also use the lane connection editor. Remove all pockets at the selected junction with a dedicated button. Escape, pointer cancellation and tool changes cancel a resize. Save/load and export/import preserve the lengths; old cities default to no pockets.

Use bounded lane geometry that follows curved approaches and tapers the through lanes outward to make room for left pockets. Pocket tracks share the approach distance coordinate with the ordinary lanes, but cannot be entered before their mouth, used as departing lanes, or assigned building addresses. Rebuilding geometry must migrate cars and reroute them. Clamp or discard obsolete pockets after road editing.

Verify geometry, legal movements, safe entry, route completion, independent resizing, cancellation, removal, one-way arms, curves, saved cities and invalid imports, plus the existing regression suite. Visually inspect the tool in a browser if available.

## One or two boxes (approved follow-up)

Default to one left-turn pocket on the clicked arm, with a right-turn pocket as fallback when that arm has no left turn. Add a 1 box / 2 boxes selector to the existing tool panel. Two adds both left and right pockets where those turns are available. The selector applies to new arm placements only; existing arms remain unchanged. Clicking a configured arm removes only that arm's pockets, while the remove button clears every pocket at the selected junction. An ordinary approach lane continues to support any turn without a dedicated pocket. Do not add a migration workflow; the user can start a new city.
