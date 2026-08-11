import React from 'react';

export type SelectionAction = 'cut' | 'reroute';

export const InteractionContext = React.createContext<{
  hoveredNetKey?: string;
  setHovered: (netKey?: string, immediate?: boolean) => void;
  // The specific edge instance currently hovered (its Reroute/Cut controls are
  // visible), distinct from hoveredNetKey — several edges (a fanout) can share
  // one net key, so only this id unambiguously identifies the r/c shortcut
  // target for a solo (non-multi-selected) hover.
  hoveredEdgeId?: string;
  setHoveredEdgeId: React.Dispatch<React.SetStateAction<string | undefined>>;
  // Set while the pointer is over a selected wire's hover zone, so every other
  // selected wire can reveal its own Cut/Reroute controls too (multi-select
  // batch actions) instead of only the one actually under the cursor.
  selectionHoverActive: boolean;
  setSelectionHoverActive: (active: boolean) => void;
  // Which control is currently hovered within the (possibly multi-wire) controls
  // popup, so every selected wire can preview the pending batch action.
  pendingSelectionAction?: SelectionAction;
  setPendingSelectionAction: (action?: SelectionAction) => void;
  // Portal target for floating controls (selection toolbar, cut-stub Reroute)
  // that must paint above node bodies. Kept outside react-flow's own
  // ViewportPortal so the generate-region overlay — which shares that portal
  // and must stay beneath nodes — isn't forced into the same stacking tier.
  // See NodeSelectionToolbar for the full rationale.
  overlayPortalNode: HTMLDivElement | null;
}>({
  setHovered: () => {},
  setHoveredEdgeId: () => {},
  selectionHoverActive: false,
  setSelectionHoverActive: () => {},
  setPendingSelectionAction: () => {},
  overlayPortalNode: null
});
