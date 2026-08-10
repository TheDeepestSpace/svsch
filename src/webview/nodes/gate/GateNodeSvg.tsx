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
  const leftBow = left + span * 0.18;
  const midCtrlX = left + span * 0.55;
  return [
    `M ${left} 0`,
    `Q ${leftBow} ${midY} ${left} ${height}`,
    `Q ${midCtrlX} ${height * 0.82} ${right} ${midY}`,
    `Q ${midCtrlX} ${height * 0.18} ${left} 0`,
    'Z'
  ].join(' ');
}

/** The extra back-curve XOR/XNOR draw just left of the OR body, echoing its concave edge. */
export function xorBackCurvePath(height: number): string {
  const midY = height / 2;
  const leftBow = gateXorGap * 0.7;
  return `M 0 0 Q ${leftBow} ${midY} 0 ${height}`;
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

  const path = bodyOp === 'and' ? andBodyPath(left, right, height) : orBodyPath(left, right, height);
  const bubbleCx = right + gateBubbleGap + gateBubbleRadius;

  return (
    <>
      {isArray && skinLayers.map(layer => (
        <g key={layer.id}
           className={`hdl-node-array-layer hdl-node-array-${layer.id} svsch-array-layer-${layer.id}`}
           transform={`translate(${layer.dx}, ${layer.dy})`}
           opacity={layer.id === 'back' ? 0.5 : layer.id === 'middle' ? 0.75 : 1}>
          {isXor && <path className="svsch-node-shape gate-back-curve" d={xorBackCurvePath(height)} fill="none" />}
          <path className="svsch-node-shape" d={path} />
          {negated && <circle className="svsch-node-shape" cx={bubbleCx} cy={midY} r={gateBubbleRadius} />}
        </g>
      ))}
      {isXor && <path className="svsch-node-shape hdl-node-gate node-skin-body gate-back-curve" d={xorBackCurvePath(height)} fill="none" />}
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
      {isXor && <path className="node-skin-selection gate-back-curve" d={xorBackCurvePath(height)} fill="none" />}
      <path className="node-skin-selection" d={path} />
      {negated && <circle className="node-skin-selection gate-bubble-selection" cx={bubbleCx} cy={midY} r={gateBubbleRadius} />}
    </>
  );
}
