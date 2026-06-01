import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import { diagramSizing } from '../../../diagram/constants';
import { structRole, nodeIsArrayNode } from '../../../ir/nodeMetadata';
import { ARRAY_STACK_SKIN_LAYERS } from '../../arrayStackGeometry';
import { busTapPortCenterY } from '../../../diagram/busGeometry';
import type { DiagramPort } from '../../../ir/types';

export function BusNodeSvg({ node, width, height }: NodeSvgProps): React.ReactElement {
  const isArray = nodeIsArrayNode(node);
  const g = diagramSizing.gridSize;
  const role = structRole(node);
  const isInterface = node.kind === 'interface';
  const isInterfaceModport = isInterface && role === 'modport';
  const isInterfaceInstance =
    isInterface && role !== 'modport' && role !== 'port' && !node.id.startsWith('interface_type:');

  const aggregatePorts: DiagramPort[] = isInterface
    ? node.ports.filter((p: DiagramPort) => p.width !== 'interface' || p.preferredSide)
    : node.ports;

  const sidePorts: DiagramPort[] = isInterfaceInstance
    ? aggregatePorts.filter(
        (p: DiagramPort) =>
          p.width === 'interface' || (p.direction !== 'input' && p.direction !== 'output')
      )
    : aggregatePorts;

  const aggregateInputs: DiagramPort[] = sidePorts.filter(
    (p: DiagramPort) => p.direction === 'input' || p.direction === 'inout' || p.direction === 'unknown'
  );
  const aggregateOutputs: DiagramPort[] = sidePorts.filter(
    (p: DiagramPort) => p.direction === 'output'
  );

  const isComposition =
    node.kind === 'struct'
      ? role === 'composition'
      : isInterface
        ? false
        : aggregateInputs.length > 1;

  const taps: DiagramPort[] = isInterfaceModport
    ? [...sidePorts]
    : isInterface
      ? [...aggregateInputs, ...aggregateOutputs]
      : isComposition
        ? aggregateInputs
        : aggregateOutputs;

  const tapCenters = taps.map((_: DiagramPort, i: number) =>
    busTapPortCenterY(i, isInterfaceModport ? 2 : 1)
  );

  if (taps.length === 0) {
    return (
      <>
        {isArray && ARRAY_STACK_SKIN_LAYERS.map(layer => (
          <rect
            key={layer.id}
            className={`svsch-node-shape svsch-array-layer-${layer.id}`}
            transform={`translate(${layer.dx}, ${layer.dy})`}
            width={width} height={height}
            opacity={layer.id === 'back' ? 0.5 : layer.id === 'middle' ? 0.75 : 1}
          />
        ))}
        <rect className="svsch-node-shape" width={width} height={height} />
      </>
    );
  }

  const pipeY = tapCenters[0] - g / 2;
  const pipeH = tapCenters[tapCenters.length - 1] - tapCenters[0] + g;
  const pipeX = isComposition ? width - g * 2 - 6 : g * 2;

  const kindLabel =
    node.kind === 'struct'
      ? 'STRUCT'
      : node.kind === 'bus'
        ? 'BUS'
        : isInterfaceModport
          ? 'MODPORT'
          : 'INTERFACE';

  return (
    <>
      {isArray && ARRAY_STACK_SKIN_LAYERS.map(layer => (
        <rect
          key={layer.id}
          className={`svsch-node-shape svsch-array-layer-${layer.id}`}
          transform={`translate(${layer.dx}, ${layer.dy})`}
          width={width} height={height}
          opacity={layer.id === 'back' ? 0.5 : layer.id === 'middle' ? 0.75 : 1}
        />
      ))}
      <rect
        className={`svsch-node-shape hdl-bus-node ${isComposition ? 'hdl-bus-composition' : 'hdl-bus-breakout'}`}
        width={width}
        height={height}
      />
      <text className="svsch-node-kind" x={width / 2} y={8} textAnchor="middle" dominantBaseline="middle">
        {kindLabel}
      </text>
      {!isInterfaceInstance && (
        <rect className="svsch-bus-pipe" x={pipeX} y={pipeY} width={6} height={pipeH} rx={3} />
      )}
      {taps.map((port: DiagramPort, i: number) => {
        const cy = tapCenters[i];
        const label = port.label ?? port.name;
        return isComposition ? (
          <g key={port.id}>
            <line className="svsch-bus-tap-line" x1={3} y1={cy} x2={pipeX} y2={cy} />
            <text
              className="svsch-bus-tap-label"
              x={pipeX - 6}
              y={cy}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {label}
            </text>
          </g>
        ) : (
          <g key={port.id}>
            <line className="svsch-bus-tap-line" x1={pipeX + 6} y1={cy} x2={width - 3} y2={cy} />
            <text
              className="svsch-bus-tap-label"
              x={pipeX + 12}
              y={cy}
              dominantBaseline="middle"
            >
              {label}
            </text>
          </g>
        );
      })}
    </>
  );
}
