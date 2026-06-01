import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import { diagramSizing } from '../../../diagram/constants';
import {
  structRole,
  nodeIsArrayNode,
  nodeTypeName
} from '../../../ir/nodeMetadata';
import {
  interfaceSkinPath,
  distributedInterfaceSideCenters,
  interfaceTopHatHeight,
  interfaceTopHatTop,
  orderedInterfaceSidePorts
} from '../../../diagram/interfaceGeometry';
import { ARRAY_STACK_SKIN_LAYERS } from '../../arrayStackGeometry';
import { busTapPortCenterY } from '../../../diagram/busGeometry';
import type { DiagramPort } from '../../../ir/types';
import { SvgArrayStackLeads } from '../shared/SvgArrayStackLeads';

export function BusNodeSvg({ node, width, height, arrayConnections }: NodeSvgProps): React.ReactElement {
  const isArray = nodeIsArrayNode(node);
  const hasArrayConnection = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    (arrayConnections ?? []).some(c => c.portId === portId && c.role === role);
  const g = diagramSizing.gridSize;
  const role = structRole(node);
  const isInterface = node.kind === 'interface';
  const isInterfaceModport = isInterface && role === 'modport';
  const isInterfaceInstance =
    isInterface && role !== 'modport' && role !== 'port' && !node.id.startsWith('interface_type:');

  const aggregatePorts: DiagramPort[] = isInterface
    ? node.ports.filter((p: DiagramPort) => p.width !== 'interface' || p.preferredSide)
    : node.ports;

  // Interface instance: render using interfaceSkinPath (chevron shape)
  if (isInterfaceInstance) {
    const topPorts = aggregatePorts.filter((p: DiagramPort) => p.direction === 'input' && p.width !== 'interface');
    const bottomPorts = aggregatePorts.filter((p: DiagramPort) => p.direction === 'output' && p.width !== 'interface');
    const sidePorts = aggregatePorts.filter((p: DiagramPort) => p.width === 'interface' || (p.direction !== 'input' && p.direction !== 'output'));
    const orderedSide = orderedInterfaceSidePorts(sidePorts);
    const topHatH = interfaceTopHatHeight(topPorts.length > 0);
    const bottomHatH = interfaceTopHatHeight(bottomPorts.length > 0);
    const shiftY = g * 3 + g / 2;
    const unshiftedH = Math.max(g, height - shiftY);
    const leftCenters = distributedInterfaceSideCenters(orderedSide.left.length, unshiftedH, topHatH, bottomHatH).map(c => c + shiftY);
    const rightCenters = distributedInterfaceSideCenters(orderedSide.right.length, unshiftedH, topHatH, bottomHatH).map(c => c + shiftY);
    const topHatY = interfaceTopHatTop([...leftCenters, ...rightCenters], topHatH);
    const allCenters = [...leftCenters, ...rightCenters];
    const titleY = allCenters.length > 0
      ? (Math.min(...allCenters) + Math.max(...allCenters)) / 2
      : height / 2;

    const { path: skinPath } = interfaceSkinPath({
      width,
      height,
      leftCenters,
      rightCenters,
      topPortCount: topPorts.length,
      bottomPortCount: bottomPorts.length,
    });

    const typeName = nodeTypeName(node);

    return (
      <g className={`hdl-interface-skin${topPorts.length > 0 ? ' hdl-interface-skin-with-tophat' : ''}${bottomPorts.length > 0 ? ' hdl-interface-skin-with-bottomhat' : ''}`}>
        <path className="hdl-interface-skin-body" d={skinPath} />
        <path className="hdl-interface-skin-selection" d={skinPath} />
        <text
          className="svsch-node-title"
          x={width / 2}
          y={titleY}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {node.label}{typeName ? ` ${typeName}` : ''}
        </text>
        {/* Side port labels */}
        {orderedSide.left.map((port: DiagramPort, i: number) => (
          <text
            key={port.id}
            className="svsch-bus-tap-label"
            x={g * 0.5}
            y={leftCenters[i]}
            dominantBaseline="middle"
          >
            {port.label ?? port.name}
          </text>
        ))}
        {orderedSide.right.map((port: DiagramPort, i: number) => (
          <text
            key={port.id}
            className="svsch-bus-tap-label"
            x={width - g * 0.5}
            y={rightCenters[i]}
            textAnchor="end"
            dominantBaseline="middle"
          >
            {port.label ?? port.name}
          </text>
        ))}
        {/* Top port labels */}
        {topPorts.map((port: DiagramPort, i: number) => (
          <text
            key={port.id}
            className="svsch-bus-tap-label"
            x={width * (i + 1) / (Math.max(topPorts.length, bottomPorts.length) + 1)}
            y={topHatY + topHatH / 2}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {port.label ?? port.name}
          </text>
        ))}
      </g>
    );
  }

  const sidePorts: DiagramPort[] = aggregatePorts;
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

  const kindLabel =
    node.kind === 'struct'
      ? 'STRUCT'
      : node.kind === 'bus'
        ? 'BUS'
        : isInterfaceModport
          ? 'MODPORT'
          : 'INTERFACE';

  if (taps.length === 0) {
    return (
      <>
        {isArray && ARRAY_STACK_SKIN_LAYERS.map(layer => (
          <rect
            key={layer.id}
            className={`svsch-node-shape hdl-node-array-layer hdl-node-array-${layer.id} svsch-array-layer-${layer.id}`}
            transform={`translate(${layer.dx}, ${layer.dy})`}
            width={width} height={height}
            opacity={layer.id === 'back' ? 0.5 : layer.id === 'middle' ? 0.75 : 1}
          />
        ))}
        <rect className="svsch-node-shape" width={width} height={height} />
        <text className="svsch-node-kind" x={12} y={14} textAnchor="start" dominantBaseline="middle">
          {kindLabel}
        </text>
      </>
    );
  }

  const pipeY = tapCenters[0] - g / 2;
  const pipeH = tapCenters[tapCenters.length - 1] - tapCenters[0] + g;
  const pipeX = isComposition ? width - g * 2 - 6 : g * 2;

  return (
    <>
      {isArray && ARRAY_STACK_SKIN_LAYERS.map(layer => (
        <rect
          key={layer.id}
          className={`svsch-node-shape hdl-node-array-layer hdl-node-array-${layer.id} svsch-array-layer-${layer.id}`}
          transform={`translate(${layer.dx}, ${layer.dy})`}
          width={width} height={height}
          opacity={layer.id === 'back' ? 0.5 : layer.id === 'middle' ? 0.75 : 1}
        />
      ))}
      <rect
        className="svsch-node-shape"
        width={width}
        height={height}
      />
      <text className="svsch-node-kind" x={12} y={14} textAnchor="start" dominantBaseline="middle">
        {kindLabel}
      </text>
      <rect className="svsch-bus-pipe" x={pipeX} y={pipeY} width={6} height={pipeH} rx={3} />
      {taps.map((port: DiagramPort, i: number) => {
        const cy = tapCenters[i];
        const label = port.label ?? port.name;
        return isComposition ? (
          <g key={port.id}>
            <line className="svsch-bus-tap-line" x1={3} y1={cy} x2={pipeX} y2={cy} />
            <text className="svsch-bus-tap-label" x={pipeX - 6} y={cy} textAnchor="end" dominantBaseline="middle">
              {label}
            </text>
          </g>
        ) : (
          <g key={port.id}>
            <line className="svsch-bus-tap-line" x1={pipeX + 6} y1={cy} x2={width - 3} y2={cy} />
            <text className="svsch-bus-tap-label" x={pipeX + 12} y={cy} dominantBaseline="middle">
              {label}
            </text>
          </g>
        );
      })}
      {/* Array leads for bus breakout/composition */}
      {isArray && taps.map((port: DiagramPort, i: number) => {
        const cy = tapCenters[i];
        return isComposition
          ? hasArrayConnection(port.id, 'target')
            ? <SvgArrayStackLeads key={`lead-${port.id}`} side="left" width={width} y={cy} trimSink />
            : null
          : hasArrayConnection(port.id, 'source')
            ? <SvgArrayStackLeads key={`lead-${port.id}`} side="right" width={width} y={cy} />
            : null;
      })}
    </>
  );
}
