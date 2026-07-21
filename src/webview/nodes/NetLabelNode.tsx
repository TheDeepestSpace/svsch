import React from 'react';
import { Handle, Position, useStore } from '@xyflow/react';
import { getVscodeApi } from '../vscodeApi';
import { diagramNodeDimensions } from '../../diagram/nodeSizing';
import { InteractionContext } from './shared/context';
import { ArrayStackLeads, handlePositionForSide, NetLabelWire } from './shared/NetLabelWire';
import type { PositionedNode } from '../../ir/types';
import { Tooltip } from '../Tooltip';

const vscode = getVscodeApi();

export function NetLabelNode({
  node,
  moduleName,
  selected,
  style
}: {
  node: PositionedNode;
  moduleName: string;
  selected?: boolean;
  style: React.CSSProperties;
}): React.ReactElement {
  const cutNet = node.metadata?.cutNet;
  // Absent origin (labels saved before this field existed) reads as
  // synthetic: freely renameable, same as always.
  const isDeclaredName = cutNet?.origin === 'declared';
  const aliasNames = cutNet?.aliasNames;
  const { hoveredNetKey, setHovered } = React.useContext(InteractionContext);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(node.label);
  const [isDirectlyHovered, setIsDirectlyHovered] = React.useState(false);

  React.useEffect(() => {
    setDraft(node.label);
  }, [node.label]);

  const stopDrag = (event: React.SyntheticEvent) => {
    event.stopPropagation();
  };

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setDraft(node.label);
      setEditing(false);
      return;
    }
    if (cutNet && trimmed !== node.label) {
      vscode.postMessage({
        type: 'renameCutNet',
        moduleName,
        netKey: cutNet.netKey,
        label: trimmed
      });
    }
    setEditing(false);
  };

  const cancel = () => {
    setDraft(node.label);
    setEditing(false);
  };

  const handleSide = cutNet?.handleSide ?? 'left';
  const handlePosition = handlePositionForSide(handleSide);
  const handleType = cutNet?.role === 'source' ? 'target' : 'source';
  const isHovered = hoveredNetKey !== undefined && hoveredNetKey === cutNet?.netKey;
  // A marquee drawn around the real block/port a cut end is attached to
  // rarely also covers the label itself — it can sit well outside that
  // node's own bounding box — so this node's own `selected` prop alone
  // misses that case. React Flow does still mark the label's cut-stub edge
  // selected whenever either endpoint is (same behavior the wire's own halo
  // already relies on), so checking that edge catches the drag-select case
  // without requiring the marquee to physically reach the label.
  const isStubEdgeSelected = useStore((state) => {
    for (const edge of state.edges) {
      if ((edge.source === node.id || edge.target === node.id) && edge.selected) return true;
    }
    return false;
  });
  // Drag-selecting a dangling end reuses the exact same "this wire matters
  // right now" treatment as hovering its net — the halo on its stub and the
  // highlight on its own name — instead of introducing a separate style.
  const isHighlighted = isHovered || selected === true || isStubEdgeSelected;
  const edgeStyleClasses = [
    cutNet?.edgeStyle?.aggregate === 'struct' ? 'hdl-net-label-struct' : '',
    cutNet?.edgeStyle?.aggregate === 'interface' ? 'hdl-net-label-interface' : '',
    cutNet?.isSourceStacked ? 'hdl-net-label-stacked' : ''
  ].filter(Boolean).join(' ');

  const { width: nodeWidth, height: nodeHeight } = diagramNodeDimensions(node);

  return (
    <div
      className={`hdl-net-label hdl-net-label-${cutNet?.role ?? 'sink'} hdl-net-label-align-${cutNet?.align ?? 'start'} hdl-net-label-handle-${handleSide}${edgeStyleClasses ? ` ${edgeStyleClasses}` : ''}${isDirectlyHovered ? ' hdl-net-label-hovered' : ''}${selected ? ' hdl-net-label-selected' : ''}`}
      data-node-id={node.id}
      data-node-kind={node.kind}
      style={style}
      tabIndex={0}
      title={isDeclaredName ? `${node.label} (declared in source — cannot be renamed)` : node.label}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (isDeclaredName) return;
        setEditing(true);
      }}
      onMouseEnter={() => { setHovered(cutNet?.netKey); setIsDirectlyHovered(true); }}
      onMouseLeave={() => { setHovered(undefined); setIsDirectlyHovered(false); }}
    >
      {cutNet && <Handle type={handleType} id="cut" position={handlePosition} />}
      <NetLabelWire node={node} handleSide={handleSide} edgeStyle={cutNet?.edgeStyle} align={cutNet?.align} isSourceStacked={cutNet?.isSourceStacked} isHighlighted={isHighlighted} />
      {cutNet?.isSourceStacked && (
        <ArrayStackLeads side={handleSide} width={nodeWidth} y={nodeHeight / 2} trimSink={cutNet?.role === 'source'} wide={cutNet?.edgeStyle?.thick === true} thick={cutNet?.edgeStyle?.thick === true} />
      )}
      {editing ? (
        <input
          className="hdl-net-label-input nodrag nopan"
          value={draft}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onDoubleClick={stopDrag}
          onMouseDown={stopDrag}
          onPointerDown={stopDrag}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              cancel();
            }
          }}
        />
      ) : (
        <span className={`hdl-net-label-text${isHighlighted ? ' hdl-net-label-text-hovered' : ''}${isDeclaredName ? '' : ' hdl-net-label-text-synthetic'}`}>
          {node.label}
          {aliasNames && aliasNames.length > 0 && (
            <Tooltip content={`Also declared as: ${aliasNames.join(', ')}`}>
              {(trigger) => (
                <sup
                  {...trigger}
                  className="hdl-net-label-alias-marker nodrag nopan"
                  role="img"
                  aria-label={`This net also has these declared aliases: ${aliasNames.join(', ')}`}
                >
                  *
                </sup>
              )}
            </Tooltip>
          )}
        </span>
      )}
      {cutNet && (
        <button
          className="hdl-net-label-tie nodrag nopan"
          type="button"
          aria-label="Tie net back together"
          title="Tie net back together"
          onClick={(event) => {
            event.stopPropagation();
            vscode.postMessage({
              type: 'tieNet',
              moduleName,
              netKey: cutNet.netKey
            });
          }}
          onDoubleClick={stopDrag}
          onMouseDown={stopDrag}
          onPointerDown={stopDrag}
        >
          Tie
        </button>
      )}
      {node.warningNote && (
        <Tooltip content={node.warningNote}>
          {(trigger) => (
            <span
              {...trigger}
              className="node-warning"
              role="img"
              aria-label={node.warningNote}
            >
              ⚠
            </span>
          )}
        </Tooltip>
      )}
    </div>
  );
}
