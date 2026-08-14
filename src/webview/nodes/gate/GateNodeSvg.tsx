import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import { gateBubbleGap, gateBubbleRadius, gateXorGap } from '../../../diagram/nodeSizing';
import { gateInputPortCenterY } from '../../../diagram/muxGeometry';
import { nodeIsArrayNode, gateBodyOperation, gateIsNegated } from '../../../ir/nodeMetadata';
import { nodeStackIsWide } from '../../../ir/edgeStyle';
import { arrayStackSkinLayersFor } from '../../arrayStackGeometry';
import { SvgArrayStackLeads } from '../shared/SvgArrayStackLeads';
import type { DiagramPort } from '../../../ir/types';

/** Body path for an AND gate: flat left edge, right side bulges into a D-shaped dome. */
export function andBodyPath(left: number, right: number, height: number): string {
  const domeRadius = height / 2;
  const flatRight = right - domeRadius;
  return `M ${left} 0 L ${flatRight} 0 A ${domeRadius} ${domeRadius} 0 0 1 ${flatRight} ${height} L ${left} ${height} Z`;
}

/** Body path for an OR/XOR gate: concave left edge, curved back tapering to a point on the right. */
export function orBodyPath(left: number, right: number, height: number): string {
  const midY = height / 2;
  const span = right - left;
  const backCtrlX = left + span * 0.1821041667;
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
  const ctrlX = span * 0.1821041667;
  const ctrl1Y = height * 0.3030833333;
  const ctrl2Y = height * 0.6969166667;
  return `M 0 0 C ${ctrlX} ${ctrl1Y} ${ctrlX} ${ctrl2Y} 0 ${height}`;
}

/**
 * Selection outline for an XOR/XNOR gate as a single closed path: it runs the tip's two
 * bulge curves but swaps the body's own concave edge for a line out to the detached
 * back-curve and back, so the outline follows the back-curve instead of doubling the
 * body's edge — while staying one unbroken contour.
 */
export function xorSelectionPath(left: number, right: number, height: number): string {
  const span = right - left;
  const midY = height / 2;
  const bulgeCtrl1X = left + span * 0.4160312500;
  const bulgeCtrl1Y = height * 0.9771354167;
  const bulgeCtrl2X = left + span * 0.7620937500;
  const bulgeCtrl2Y = height * 0.8853020833;
  const backCtrlX = span * 0.1821041667;
  const backCtrl1Y = height * 0.3030833333;
  const backCtrl2Y = height * 0.6969166667;
  return [
    `M ${right} ${midY}`,
    `C ${bulgeCtrl2X} ${height - bulgeCtrl2Y} ${bulgeCtrl1X} ${height - bulgeCtrl1Y} ${left} 0`,
    'L 0 0',
    `C ${backCtrlX} ${backCtrl1Y} ${backCtrlX} ${backCtrl2Y} 0 ${height}`,
    `L ${left} ${height}`,
    `C ${bulgeCtrl1X} ${bulgeCtrl1Y} ${bulgeCtrl2X} ${bulgeCtrl2Y} ${right} ${midY}`,
    'Z'
  ].join(' ');
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
  const selectionPath = isXor ? xorSelectionPath(left, right, height) : path;
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
