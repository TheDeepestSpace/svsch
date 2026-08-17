import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { diagramNodeDimensions, nodeWarningIconCenter } from '../../diagram/nodeSizing';
import type { PositionedNode } from '../../ir/types';
import { Tooltip } from '../Tooltip';

/**
 * Renders a `kind: 'boundaryPort'` node — the label-only, wire-stub-on-both-
 * sides standin for a child module's port once its instance has been
 * "Expand"ed in place (see webview/expand). Deliberately not a real port
 * "skin" (no PortNodeSvg body) — same label+handle convention the rest of
 * the diagram already uses for a node's ports (see NetLabelNode), just with
 * a handle on *both* edges since the signal passes straight through this
 * node rather than terminating at it.
 */
export function BoundaryPortNode({
  node,
  selected,
  style
}: {
  node: PositionedNode;
  selected?: boolean;
  style: React.CSSProperties;
}): React.ReactElement {
  const boundary = node.metadata?.boundaryPort;
  const outerSide = boundary?.outerSide ?? 'left';
  const innerSide = outerSide === 'left' ? 'right' : 'left';
  const { width, height } = diagramNodeDimensions(node);
  const warningCenter = nodeWarningIconCenter(node, width, height);

  return (
    <div
      className={`hdl-boundary-port hdl-boundary-port-outer-${outerSide}${selected ? ' hdl-boundary-port-selected' : ''}`}
      data-node-id={node.id}
      data-node-kind={node.kind}
      title={`${node.label} (${boundary?.childModuleName ?? ''})`}
    >
      {/* Both a source and target Handle at each id: the node is a pass-through,
          not a real source/sink, and (like an inout port elsewhere in this
          codebase) either edge endpoint may legitimately land on either side. */}
      <Handle type="target" id="outer" position={outerSide === 'left' ? Position.Left : Position.Right} />
      <Handle type="source" id="outer" position={outerSide === 'left' ? Position.Left : Position.Right} />
      <Handle type="target" id="inner" position={innerSide === 'left' ? Position.Left : Position.Right} />
      <Handle type="source" id="inner" position={innerSide === 'left' ? Position.Left : Position.Right} />
      <svg className="hdl-boundary-port-wire-svg" viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
        <path className="svsch-edge" d={`M 0 ${height / 2} H ${width}`} />
      </svg>
      <span className="hdl-boundary-port-text">{node.label}</span>
      {node.warningNote && (
        <Tooltip content={node.warningNote}>
          {(trigger) => (
            <span
              {...trigger}
              className="node-warning"
              role="img"
              aria-label={node.warningNote}
              style={{ left: warningCenter.x, top: warningCenter.y, transform: 'translate(-50%, -50%)' }}
            >
              ⚠
            </span>
          )}
        </Tooltip>
      )}
    </div>
  );
}
