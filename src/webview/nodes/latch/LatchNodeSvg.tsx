import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import { diagramSizing } from '../../../diagram/constants';
import { registerPortTop, registerExtraInputPortTop } from '../../../diagram/registerGeometry';
import {
  registerClockSignal,
  registerResetSignal,
  registerResetActiveLow,
  nodeArrayDimension,
  nodeIsArrayNode,
} from '../../../ir/nodeMetadata';
import type { DiagramPort } from '../../../ir/types';

export function LatchNodeSvg({ node, width, height }: NodeSvgProps): React.ReactElement {
  const g = diagramSizing.gridSize;

  const inputs: DiagramPort[] = (node.ports ?? []).filter((p: DiagramPort) => p.direction === 'input');
  const outputs: DiagramPort[] = (node.ports ?? []).filter((p: DiagramPort) => p.direction === 'output');

  const clockSignal = registerClockSignal(node);
  const resetSignal = registerResetSignal(node);
  const resetActiveLow = registerResetActiveLow(node);
  const hasReset = Boolean(resetSignal);
  const dPort = inputs.find((p: DiagramPort) => p.name === 'D') ?? inputs[0];
  const qPort = outputs.find((p: DiagramPort) => p.name === 'Q') ?? outputs[0];
  const clockPort =
    inputs.find((p: DiagramPort) => p.name === clockSignal) ??
    inputs.find((p: DiagramPort) => p.name !== 'D' && p.name !== resetSignal);
  const resetPort = resetSignal
    ? inputs.find((p: DiagramPort) => p.name === resetSignal)
    : undefined;
  const rvPort = inputs.find((p: DiagramPort) => p.name === 'RV');
  const hasRv = Boolean(rvPort);
  const renderedInputPortIds = new Set(
    [dPort?.id, clockPort?.id, resetPort?.id, rvPort?.id].filter(Boolean)
  );
  const extraInputPorts = inputs.filter((p: DiagramPort) => !renderedInputPortIds.has(p.id));

  const isArray = nodeIsArrayNode(node);
  const arrayDim = nodeArrayDimension(node);

  const dTop = registerPortTop('d', height, hasReset, hasRv);
  const qTop = registerPortTop('q', height, hasReset, hasRv);
  const clkTop = registerPortTop('clock', height, hasReset, hasRv);
  const rstTop = registerPortTop('reset', height, hasReset, hasRv);
  const rvTop = registerPortTop('rv', height, hasReset, hasRv);

  return (
    <>
      {/* Background */}
      <rect className="svsch-node-shape hdl-node-latch" width={width} height={height} rx={4} />

      {/* Kind + title in header */}
      <text className="svsch-node-kind" x={width / 2} y={8} textAnchor="middle" dominantBaseline="middle">LATCH</text>
      <text className="svsch-node-title" x={width / 2} y={26} textAnchor="middle" dominantBaseline="middle">{node.label}</text>

      {/* D port label (left side) */}
      {dPort && (
        <text className="svsch-port-label" x={g * 0.75} y={dTop + g / 2} dominantBaseline="middle">
          {dPort.label ?? dPort.name}
        </text>
      )}

      {/* Q port label (right side) */}
      {qPort && (
        <text className="svsch-port-label" x={width - g * 0.75} y={qTop + g / 2} textAnchor="end" dominantBaseline="middle">
          {qPort.label ?? qPort.name}
        </text>
      )}

      {/* Clock glyph: triangle chevron, left side */}
      {clockPort && (
        <svg x={2} y={clkTop + g / 2 - 6} width={12} height={12} viewBox="0 0 12 12" className="register-clock-glyph" aria-hidden={true}>
          <path d="M 1 1.5 L 9 6 L 1 10.5" />
        </svg>
      )}

      {/* Reset label: centered at bottom, if present */}
      {resetPort && (
        <text className="svsch-port-label register-reset-label" x={width / 2} y={rstTop + g / 2} textAnchor="middle" dominantBaseline="middle">
          {resetActiveLow ? 'R̅' : 'R'}
        </text>
      )}

      {/* RV port */}
      {rvPort && (
        <text className="svsch-port-label" x={g * 0.75} y={rvTop + g / 2} dominantBaseline="middle">RV</text>
      )}

      {/* Extra input ports */}
      {extraInputPorts.map((port: DiagramPort, index: number) => {
        const top = registerExtraInputPortTop(index, height, hasRv);
        return (
          <text key={port.id} className="svsch-port-label" x={g * 0.75} y={top + g / 2} dominantBaseline="middle">
            {port.label ?? port.name}
          </text>
        );
      })}

      {/* Array badge */}
      {isArray && arrayDim && (
        <text className="svsch-node-kind svsch-array-badge" x={width + 3} y={-4} textAnchor="start">
          {arrayDim}
        </text>
      )}
    </>
  );
}
