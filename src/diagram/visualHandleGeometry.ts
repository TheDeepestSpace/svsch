import type { DiagramNode, DiagramPort } from '../ir/types';
import { structRole } from '../ir/nodeMetadata';
import { diagramNodeDimensions } from './nodeSizing';
import { diagramSizing } from './constants';
import { busTapPortCenterY } from './busGeometry';
import {
  distributedInterfaceSideCenters,
  interfaceTopHatHeight,
  interfaceSkinPath,
  interfaceTopPortX,
  orderedInterfaceSidePorts,
} from './interfaceGeometry';
import { isInputSidePort } from './portDirection';

export type VisualHandleSide = 'NORTH' | 'SOUTH' | 'EAST' | 'WEST';

export interface VisualHandleGeometry {
  offset: { x: number; y: number };
  side: VisualHandleSide;
}

export function visualHandleGeometry(
  node: DiagramNode,
  portId: string | undefined,
): VisualHandleGeometry | undefined {
  const port = portId ? node.ports.find((candidate) => candidate.id === portId) : node.ports[0];
  if (!port) {
    return undefined;
  }

  if (node.kind === 'bus' || node.kind === 'struct') {
    return busSingleHandleGeometry(node, port);
  }

  if (
    node.kind === 'interface' &&
    structRole(node) !== 'modport' &&
    structRole(node) !== 'port' &&
    !node.id.startsWith('interface_type:')
  ) {
    return interfaceInstanceScalarHandleGeometry(node, port);
  }

  return undefined;
}

function busSingleHandleGeometry(
  node: DiagramNode,
  port: DiagramPort,
): VisualHandleGeometry | undefined {
  const role = structRole(node);
  const inputs = node.ports.filter(isInputSidePort);
  const outputs = node.ports.filter((candidate) => candidate.direction === 'output');
  const isComposition = node.kind === 'struct' ? role === 'composition' : inputs.length > 1;
  const singlePort = isComposition ? outputs[0] : inputs[0];
  if (port.id !== singlePort?.id) {
    return undefined;
  }

  const { width } = nodeDimensions(node);
  const taps = isComposition ? inputs : outputs;
  const firstTapCenter = busTapPortCenterY(0);
  const lastTapCenter = busTapPortCenterY(Math.max(0, taps.length - 1));
  const isArrayComposition =
    node.kind === 'bus' && isComposition && node.metadata?.aggregateKind === 'array';
  const isArrayBreakout =
    node.kind === 'bus' && !isComposition && node.metadata?.aggregateKind === 'array';
  const y =
    isArrayComposition || isArrayBreakout ? lastTapCenter + diagramSizing.gridSize : firstTapCenter;
  // The pipe sits flush with the single-port edge, so scalar aggregates plug
  // in at the node border; array breakouts keep a grid for the diagonal exit.
  const x = isComposition ? width : diagramSizing.gridSize * (isArrayBreakout ? 1.5 : 0);

  return {
    offset: { x, y },
    side: isComposition ? 'EAST' : 'WEST',
  };
}

function interfaceInstanceScalarHandleGeometry(
  node: DiagramNode,
  port: DiagramPort,
): VisualHandleGeometry | undefined {
  if (port.width === 'interface') {
    return undefined;
  }

  const { width, height } = nodeDimensions(node);
  const aggregatePorts = node.ports.filter(
    (candidate) => candidate.width !== 'interface' || candidate.preferredSide,
  );
  const topPorts = aggregatePorts.filter(
    (candidate) => candidate.direction === 'input' && candidate.width !== 'interface',
  );
  const bottomPorts = aggregatePorts.filter(
    (candidate) => candidate.direction === 'output' && candidate.width !== 'interface',
  );
  const capPortCount = Math.max(topPorts.length, bottomPorts.length);

  if (port.direction === 'input') {
    const portIndex = topPorts.findIndex((candidate) => candidate.id === port.id);
    if (portIndex < 0) {
      return undefined;
    }
    return {
      offset: {
        x: interfaceTopPortX(width, topPorts.length, portIndex, capPortCount),
        y: interfaceInstanceTopHatY(node, height),
      },
      side: 'NORTH',
    };
  }

  if (port.direction === 'output') {
    const portIndex = bottomPorts.findIndex((candidate) => candidate.id === port.id);
    if (portIndex < 0) {
      return undefined;
    }
    return {
      offset: {
        x: interfaceTopPortX(width, bottomPorts.length, portIndex, capPortCount),
        y: height,
      },
      side: 'SOUTH',
    };
  }

  return undefined;
}

export function interfaceInstanceTopHatY(node: DiagramNode, height: number): number {
  const { width } = nodeDimensions(node);
  const aggregatePorts = node.ports.filter(
    (candidate) => candidate.width !== 'interface' || candidate.preferredSide,
  );
  const topPorts = aggregatePorts.filter(
    (candidate) => candidate.direction === 'input' && candidate.width !== 'interface',
  );
  const bottomPorts = aggregatePorts.filter(
    (candidate) => candidate.direction === 'output' && candidate.width !== 'interface',
  );
  const sidePorts = aggregatePorts.filter(
    (candidate) =>
      candidate.width === 'interface' ||
      (candidate.direction !== 'input' && candidate.direction !== 'output'),
  );
  const orderedSide = orderedInterfaceSidePorts(sidePorts);
  const topHatHeight = interfaceTopHatHeight(topPorts.length > 0);
  const bottomHatHeight = interfaceTopHatHeight(bottomPorts.length > 0);
  const shiftY = diagramSizing.interfaceInstanceShiftY;
  const unshiftedHeight = Math.max(diagramSizing.gridSize, height - shiftY);
  const leftCenters = distributedInterfaceSideCenters(
    orderedSide.left.length,
    unshiftedHeight,
    topHatHeight,
    bottomHatHeight,
  ).map((center) => center + shiftY);
  const rightCenters = distributedInterfaceSideCenters(
    orderedSide.right.length,
    unshiftedHeight,
    topHatHeight,
    bottomHatHeight,
  ).map((center) => center + shiftY);
  return interfaceSkinPath({
    width,
    height,
    leftCenters,
    rightCenters,
    topPortCount: topPorts.length,
    bottomPortCount: bottomPorts.length,
  }).topHatTop;
}

function nodeDimensions(node: DiagramNode): { width: number; height: number } {
  return diagramNodeDimensions(node);
}
