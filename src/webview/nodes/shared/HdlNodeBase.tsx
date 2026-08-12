import React from 'react';
import type { PositionedNode } from '../../../ir/types';

export interface HdlNodeBaseProps {
  node: PositionedNode;
  width: number;
  height: number;
  style: React.CSSProperties;
  className: string;
  /** Extra class(es) appended to the wrapping "hdl-node-svg" element, e.g. "mux-skin". */
  svgClassName?: string;
  /** Omit to render the <button> with no title attribute at all. */
  title?: string;
  onDoubleClick: React.MouseEventHandler<HTMLButtonElement>;
  svg: React.ReactNode;
  /** Rendered right after the <svg>, before handles — e.g. instance parameter chips. */
  extraContent?: React.ReactNode;
  handles: React.ReactNode;
  selection?: React.ReactNode;
  /** Resize hit-zones (register/instance only) — rendered after selection, before the warning icon, matching every kind's DOM order. */
  resizeControls?: React.ReactNode;
  warningIcon: React.ReactNode;
}

/**
 * Generic wrapper shared by every self-contained per-kind node component
 * (RegisterNode, MuxNode, InstanceNode, ...): the <button> shell, the inner
 * <svg>, and the fixed slot order (extra content, handles, selection,
 * warning icon) that every kind renders in. Each kind still computes its
 * own geometry/handles and supplies them as props — this only removes the
 * boilerplate that was identical across kinds.
 */
export function HdlNodeBase({
  node,
  width,
  height,
  style,
  className,
  svgClassName,
  title,
  onDoubleClick,
  svg,
  extraContent,
  handles,
  selection,
  resizeControls,
  warningIcon
}: HdlNodeBaseProps): React.ReactElement {
  return (
    <button
      className={className}
      data-node-id={node.id}
      data-node-kind={node.kind}
      style={style}
      title={title}
      onDoubleClick={onDoubleClick}
    >
      <svg className={svgClassName ? `hdl-node-svg ${svgClassName}` : 'hdl-node-svg'} width={width} height={height} aria-hidden="true">
        {svg}
      </svg>
      {extraContent}
      {handles}
      {selection}
      {resizeControls}
      {warningIcon}
    </button>
  );
}
