import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import { gateBubbleGap, gateBubbleRadius, gateXorGap } from '../../../diagram/nodeSizing';
import { gateInputPortCenterY } from '../../../diagram/muxGeometry';
import { nodeIsArrayNode, gateBodyOperation, gateIsNegated } from '../../../ir/nodeMetadata';
import { nodeStackIsWide } from '../../../ir/edgeStyle';
import { arrayStackSkinLayersFor } from '../../arrayStackGeometry';
import { SvgArrayStackLeads } from '../shared/SvgArrayStackLeads';
import type { DiagramNode, DiagramPort } from '../../../ir/types';

/** Body path for an AND gate: flat left edge, right side bulges into a D-shaped dome. */
export function andBodyPath(left: number, right: number, height: number): string {
  const domeRadius = height / 2;
  const flatRight = right - domeRadius;
  return `M ${left} 0 L ${flatRight} 0 A ${domeRadius} ${domeRadius} 0 0 1 ${flatRight} ${height} L ${left} ${height} Z`;
}

/**
 * Fraction along the back curve's cubic control points, in [left, right] terms, at which
 * the concave edge sits. The curve's actual depth never exceeds 75% of this (the bezier's
 * midpoint reach for two coincident control points), so `gateConcaveEdgeReachX` — built from
 * this same fraction — is always a safe overshoot past the visible boundary at any height.
 */
const gateBackCurveControlXFraction = 0.1821041667;

/** X the back curve's control points sit at — always deeper than the curve's actual visible reach. */
export function gateConcaveEdgeReachX(left: number, right: number): number {
  return left + (right - left) * gateBackCurveControlXFraction;
}

/** Body path for an OR/XOR gate: concave left edge, curved back tapering to a point on the right. */
export function orBodyPath(left: number, right: number, height: number): string {
  const midY = height / 2;
  const span = right - left;
  const backCtrlX = gateConcaveEdgeReachX(left, right);
  const backCtrl1Y = height * 0.3030833333;
  const backCtrl2Y = height * 0.6969166667;
  const bulgeCtrl1X = left + span * 0.4160312500;
  const bulgeCtrl1Y = height * 0.9771354167;
  const bulgeCtrl2X = left + span * 0.7620937500;
  const bulgeCtrl2Y = height * 0.8853020833;
  return [
    `M ${left} 0`,
    `C ${backCtrlX} ${backCtrl1Y} ${backCtrlX} ${backCtrl2Y} ${left} ${height}`,
    `C ${bulgeCtrl1X} ${bulgeCtrl1Y} ${bulgeCtrl2X} ${bulgeCtrl2Y} ${right} ${midY}`,
    `C ${bulgeCtrl2X} ${height - bulgeCtrl2Y} ${bulgeCtrl1X} ${height - bulgeCtrl1Y} ${left} 0`,
    'Z'
  ].join(' ');
}

/** The extra back-curve XOR/XNOR draw just left of the OR body, echoing its concave edge. */
export function xorBackCurvePath(span: number, height: number): string {
  const ctrlX = gateConcaveEdgeReachX(0, span);
  const ctrl1Y = height * 0.3030833333;
  const ctrl2Y = height * 0.6969166667;
  return `M 0 0 C ${ctrlX} ${ctrl1Y} ${ctrlX} ${ctrl2Y} 0 ${height}`;
}

/**
 * Selection outline for an XOR/XNOR gate: the OR body curve widened to start at the
 * detached back-curve's own edge (x=0) instead of the inset main body, so the tip's
 * bulge curves flow straight into the back-curve with no straight segment between them.
 */
export function xorSelectionPath(right: number, height: number): string {
  return orBodyPath(0, right, height);
}

/**
 * How far a wire routed into a gate's left-side input needs to reach to disappear under
 * the node's body fill. Zero for AND/NAND — their left edge is flat at x=0, flush with the
 * port, so a wire ending there already meets the visible boundary. OR/NOR/XOR/XNOR's back
 * curve recedes inward away from x=0 (see `orBodyPath`), so a wire stopping flush at the
 * port leaves a gap before the curve; nodes render above nets (see main.tsx's Z_INDEX
 * constants), so routing the endpoint past `gateConcaveEdgeReachX` hides the overshoot
 * under the fill and closes that gap for every input, regardless of its y position.
 */
export function gateLeftEdgeWireReach(node: DiagramNode, width: number): number {
  if (node.kind !== 'gate') return 0;
  const bodyOp = gateBodyOperation(node);
  if (bodyOp === 'and') return 0;
  const negated = gateIsNegated(node);
  const isXor = bodyOp === 'xor';
  const left = isXor ? gateXorGap : 0;
  const bubbleSpan = negated ? gateBubbleGap + gateBubbleRadius * 2 : 0;
  const right = width - bubbleSpan;
  return gateConcaveEdgeReachX(left, right);
}

export function GateNodeSvg({ node, width, height, arrayConnections }: NodeSvgProps): React.ReactElement {
  const isArray = nodeIsArrayNode(node);
  const stackWide = isArray && nodeStackIsWide(node);
  const skinLayers = arrayStackSkinLayersFor(stackWide);
  const hasArrayConnection = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    (arrayConnections ?? []).some(c => c.portId === portId && c.role === role);
  const arrayConnectionThick = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    (arrayConnections ?? []).find(c => c.portId === portId && c.role === role)?.thick ?? false;

  const inputs = node.ports.filter((p: DiagramPort) => p.direction !== 'output');
  const outputs = node.ports.filter((p: DiagramPort) => p.direction === 'output');

  const bodyOp = gateBodyOperation(node);
  const negated = gateIsNegated(node);
  const isXor = bodyOp === 'xor';

  const left = isXor ? gateXorGap : 0;
  const bubbleSpan = negated ? gateBubbleGap + gateBubbleRadius * 2 : 0;
  const right = width - bubbleSpan;
  const midY = height / 2;
  const backCurve = xorBackCurvePath(right - left, height);

  const path = bodyOp === 'and' ? andBodyPath(left, right, height) : orBodyPath(left, right, height);
  const selectionPath = isXor ? xorSelectionPath(right, height) : path;
  const bubbleCx = right + gateBubbleGap + gateBubbleRadius;

  return (
    <>
      {isArray && skinLayers.map(layer => (
        <g key={layer.id}
           className={`hdl-node-array-layer hdl-node-array-${layer.id} svsch-array-layer-${layer.id}`}
           transform={`translate(${layer.dx}, ${layer.dy})`}
           opacity={layer.id === 'back' ? 0.5 : layer.id === 'middle' ? 0.75 : 1}>
          {isXor && <path className="svsch-node-shape gate-back-curve" d={backCurve} fill="none" />}
          <path className="svsch-node-shape" d={path} />
          {negated && <circle className="svsch-node-shape" cx={bubbleCx} cy={midY} r={gateBubbleRadius} />}
        </g>
      ))}
      {isXor && <path className="svsch-node-shape hdl-node-gate node-skin-body gate-back-curve" d={backCurve} fill="none" />}
      <path className="svsch-node-shape hdl-node-gate node-skin-body" d={path} />
      {negated && <circle className="svsch-node-shape hdl-node-gate node-skin-body gate-bubble" cx={bubbleCx} cy={midY} r={gateBubbleRadius} />}

      {/* Array stack leads */}
      {isArray && inputs.map((input, index) => (
        hasArrayConnection(input.id, 'target') && (
          <SvgArrayStackLeads
            key={input.id}
            wide={stackWide}
            thick={arrayConnectionThick(input.id, 'target')}
            side="left"
            width={width}
            y={gateInputPortCenterY(index, inputs.length, height)}
            trimSink
          />
        )
      ))}
      {isArray && outputs[0] && hasArrayConnection(outputs[0].id, 'source') && (
        <SvgArrayStackLeads wide={stackWide} thick={arrayConnectionThick(outputs[0].id, 'source')} side="right" width={width} y={height / 2} />
      )}
      <path className="node-skin-selection" d={selectionPath} />
      {negated && <circle className="node-skin-selection gate-bubble-selection" cx={bubbleCx} cy={midY} r={gateBubbleRadius} />}
    </>
  );
}
