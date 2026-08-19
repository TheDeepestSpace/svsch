import React, { useContext } from 'react';
import { InteractionContext, type NodeResizeHandle } from './context';

const RESIZE_HANDLES: NodeResizeHandle[] = [
  'top',
  'right',
  'bottom',
  'left',
  'top-left',
  'top-right',
  'bottom-right',
  'bottom-left',
];

/**
 * Edge/corner grow-only resize hit-zones shared by the instance and register
 * node kinds. The drag itself is driven from DiagramApp (main.tsx) — this
 * only renders the handle hit-zones, the drag state machine lives in
 * startNodeResize on InteractionContext. Reverting a resize lives with the
 * other selected-block actions in NodeSelectionToolbar.
 */
export function NodeResizeControls({ nodeId }: { nodeId: string }): React.ReactElement {
  const { startNodeResize } = useContext(InteractionContext);
  return (
    <React.Fragment>
      {RESIZE_HANDLES.map((handle) => (
        <div
          key={handle}
          className={`nodrag svsch-node-resize-handle svsch-node-resize-${handle}`}
          onPointerDown={(event) => startNodeResize(event, nodeId, handle)}
          onClick={(event) => event.stopPropagation()}
        />
      ))}
    </React.Fragment>
  );
}
