import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { nodeWarningIconCenter, resolvedNodeDimensions } from '../../diagram/nodeSizing';
import type { PositionedNode } from '../../ir/types';
import { Tooltip } from '../Tooltip';

/**
 * Renders a `kind: 'boundaryPort'` node — the label-only standin for a child
 * module's port once its instance has been "Expand"ed in place (see
 * webview/expand). The label is anchored flush to the outer (border) side at
 * the exact inset the instance's own port labels use, so expanding doesn't
 * shift it horizontally; the external wire terminates on the outer handle at
 * the border, exactly where it terminated on the collapsed instance. On the
 * inner side, a lead line runs from the label's inner edge to the inner
 * handle, so the internal wire reads as emerging from the other side of the
 * label — no drawn segment ever crosses the text itself (compare NetLabelNode,
 * which instead draws under its label and masks with a background).
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
  const { width, height } = resolvedNodeDimensions(node);
  const warningCenter = nodeWarningIconCenter(node, width, height);

  const label = <span className="hdl-boundary-port-text">{node.label}</span>;
  const innerLead = <span className="hdl-boundary-port-lead" aria-hidden="true" />;

  return (
    <div
      className={`hdl-boundary-port hdl-boundary-port-outer-${outerSide}${selected ? ' hdl-boundary-port-selected' : ''}`}
      data-node-id={node.id}
      data-node-kind={node.kind}
      title={`${node.label} (${boundary?.childModuleName ?? ''})`}
      style={style}
    >
      {/* Both a source and target Handle at each id: the node is a pass-through,
          not a real source/sink, and (like an inout port elsewhere in this
          codebase) either edge endpoint may legitimately land on either side. */}
      <Handle type="target" id="outer" position={outerSide === 'left' ? Position.Left : Position.Right} />
      <Handle type="source" id="outer" position={outerSide === 'left' ? Position.Left : Position.Right} />
      <Handle type="target" id="inner" position={innerSide === 'left' ? Position.Left : Position.Right} />
      <Handle type="source" id="inner" position={innerSide === 'left' ? Position.Left : Position.Right} />
      {outerSide === 'left' ? (
        <>
          {label}
          {innerLead}
        </>
      ) : (
        <>
          {innerLead}
          {label}
        </>
      )}
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
