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
import { ARRAY_STACK_SKIN_LAYERS } from '../../arrayStackGeometry';
import { SvgArrayStackLeads } from '../shared/SvgArrayStackLeads';
import { SvgPortLabel } from '../shared/labels';
import type { DiagramPort } from '../../../ir/types';

export function LatchNodeSvg({ node, width, height, arrayConnections }: NodeSvgProps): React.ReactElement {
  const hasArrayConnection = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    (arrayConnections ?? []).some(c => c.portId === portId && c.role === role);
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
      {/* Array stack layers (back→middle→front for correct z-order) */}
      {isArray && ARRAY_STACK_SKIN_LAYERS.map(layer => (
        <rect
          key={layer.id}
          className={`svsch-node-shape hdl-node-array-layer hdl-node-array-${layer.id} svsch-array-layer-${layer.id}`}
          transform={`translate(${layer.dx}, ${layer.dy})`}
          width={width} height={height}
          opacity={layer.id === 'back' ? 0.5 : layer.id === 'middle' ? 0.75 : 1}
        />
      ))}

      {/* Background */}
      <rect className="svsch-node-shape" width={width} height={height} />

      {/* Kind + title in header */}
      <text className="svsch-node-kind" x={10} y={14} textAnchor="start" dominantBaseline="middle">LATCH</text>
      <text className="svsch-node-title" x={10} y={26} textAnchor="start" dominantBaseline="middle">{node.label}</text>

      {/* D port label (left side) */}
      {dPort && (
        <text className="svsch-port-label" x={g / 2} y={dTop + g / 2} dominantBaseline="middle">
          <SvgPortLabel port={dPort} />
        </text>
      )}

      {/* Q port label (right side) */}
      {qPort && (
        <text className="svsch-port-label" x={width - g / 2} y={qTop + g / 2} textAnchor="end" dominantBaseline="middle">
          <SvgPortLabel port={qPort} />
        </text>
      )}

      {/* Clock glyph: triangle chevron, left side */}
      {clockPort && (
        <g className="svsch-register-clock-port">
          <svg x={-2} y={clkTop + g / 2 - 6} width={12} height={12} viewBox="0 0 12 12" className="register-clock-glyph" aria-hidden={true}>
            <path d="M 1 1.5 L 9 6 L 1 10.5" />
          </svg>
        </g>
      )}

      {/* Reset label: centered at bottom, if present */}
      {resetPort && (
        <g className="svsch-register-reset-port">
          <text className="svsch-port-label svsch-register-reset-label" x={width / 2} y={rstTop + g / 2} textAnchor="middle" dominantBaseline="middle">
            {resetActiveLow ? 'R̅' : 'R'}
          </text>
        </g>
      )}

      {/* RV port */}
      {rvPort && (
        <text className="svsch-port-label" x={g / 2} y={rvTop + g / 2} dominantBaseline="middle">RV</text>
      )}

      {/* Extra input ports */}
      {extraInputPorts.map((port: DiagramPort, index: number) => {
        const top = registerExtraInputPortTop(index, height, hasRv);
        return (
          <text key={port.id} className="svsch-port-label" x={g * 0.75} y={top + g / 2} dominantBaseline="middle">
            <SvgPortLabel port={port} />
          </text>
        );
      })}

      {/* Array badge */}
      {isArray && arrayDim && (
        <text className="svsch-node-kind svsch-array-badge" x={width + 3} y={-4} textAnchor="start">
          {arrayDim}
        </text>
      )}

      {/* Array stack leads */}
      {isArray && dPort && hasArrayConnection(dPort.id, 'target') && (
        <SvgArrayStackLeads side="left" width={width} y={dTop + g / 2} trimSink />
      )}
      {isArray && clockPort && hasArrayConnection(clockPort.id, 'target') && (
        <SvgArrayStackLeads side="left" width={width} y={clkTop + g / 2} trimSink />
      )}
      {isArray && resetPort && hasArrayConnection(resetPort.id, 'target') && (
        <SvgArrayStackLeads side="bottom" width={width} y={rstTop + g} trimSink />
      )}
      {isArray && qPort && hasArrayConnection(qPort.id, 'source') && (
        <SvgArrayStackLeads side="right" width={width} y={qTop + g / 2} />
      )}
    </>
  );
}
