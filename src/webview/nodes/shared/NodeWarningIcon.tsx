import React from 'react';
import { Tooltip } from '../../Tooltip';
import { nodeWarningIconCenter } from '../../../diagram/nodeSizing';
import type { PositionedNode } from '../../../ir/types';

/**
 * Centers the warning half a grid outside the node's outline (see
 * nodeWarningIconCenter) instead of pinning it to a fixed CSS corner, so it
 * clears mux/alu/inverter's sloped edges, array-dimension badges, and the
 * interface-instance chevron outline instead of overlapping them.
 */
export function NodeWarningIcon({
  node,
  width,
  height,
}: {
  node: PositionedNode;
  width: number;
  height: number;
}): React.ReactElement | null {
  const message = node.warningNote;
  if (!message) return null;

  const center = nodeWarningIconCenter(node, width, height);
  const style: React.CSSProperties = {
    left: center.x,
    top: center.y,
    transform: 'translate(-50%, -50%)',
  };

  return (
    <Tooltip content={message}>
      {(trigger) => (
        <span {...trigger} className="node-warning" role="img" aria-label={message} style={style}>
          ⚠
        </span>
      )}
    </Tooltip>
  );
}
