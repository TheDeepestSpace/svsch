import React from 'react';

export type SelectionAction = 'cut' | 'reroute';

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
}>({
  setHovered: () => {},
  selectionHoverActive: false,
  setSelectionHoverActive: () => {},
  setPendingSelectionAction: () => {}
});
