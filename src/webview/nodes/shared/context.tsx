import React from 'react';

export type SelectionAction = 'cut' | 'reroute';

// Edge-drag ('left'/'right'/'top'/'bottom') resizes one axis; corner-drag
// (e.g. 'top-left') resizes both independently, no aspect lock.
export type NodeResizeHandle =
  'left' | 'right' | 'top' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export const InteractionContext = React.createContext<{
  hoveredNetKey?: string;
  setHovered: (netKey?: string, immediate?: boolean) => void;
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
  // Starts a grow-only block resize drag (instance/register nodes), mirroring
  // GenerateRegionOverlay's pointer-drag pattern one level up in main.tsx —
  // HdlNode only renders the handle hit-zones, the drag state machine lives
  // in DiagramApp alongside the node/region state it has to update together.
  startNodeResize: (event: React.PointerEvent, nodeId: string, handle: NodeResizeHandle) => void;
}>({
  setHovered: () => {},
  selectionHoverActive: false,
  setSelectionHoverActive: () => {},
  setPendingSelectionAction: () => {},
  overlayPortalNode: null,
  startNodeResize: () => {},
});
