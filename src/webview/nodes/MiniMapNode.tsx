import React from 'react';
import { useNodes, type MiniMapNodeProps } from '@xyflow/react';
import { diagramSizing } from '../../diagram/constants';
import { diagramNodeDimensions } from '../../diagram/nodeSizing';
import {
  distributedInterfaceSideCenters,
  interfaceSkinPath,
  interfaceTopHatHeight,
  orderedInterfaceSidePorts,
} from '../../diagram/interfaceGeometry';
import { structRole, nodeTypeName, gateBodyOperation, gateIsNegated } from '../../ir/nodeMetadata';
import { busTapPortCenterY } from '../../diagram/busGeometry';
import { andBodyPath, orBodyPath, xorBackCurvePath } from './gate/GateNodeSvg';
import type { HdlFlowNode } from './types';

export function MiniMapNode({
  id,
  x,
  y,
  width,
  height,
  className,
}: MiniMapNodeProps): React.ReactElement | null {
  const nodes = useNodes<HdlFlowNode>();
  const flowNode = nodes.find((n: HdlFlowNode) => n.id === id);
  const node = flowNode?.data.node;

  if (!node) {
    return (
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        className={className}
        data-minimap-node-id={id}
        fill="var(--vscode-editor-foreground)"
      />
    );
  }

  if (node.kind === 'netLabel') {
    return null;
  }

  // Blocks flagged with the shared error style render in the same red on the minimap.
  const color = node.invalid ? 'var(--svsch-error-highlight)' : 'var(--vscode-editor-foreground)';

  const isBus = node.kind === 'bus';
  const isStruct = node.kind === 'struct';
  const isInterface = node.kind === 'interface';
  const role = structRole(node);
  const isInterfaceModport = isInterface && role === 'modport';

  if (isBus || isStruct || isInterfaceModport) {
    const g = diagramSizing.gridSize;
    const aggregatePorts = isInterface
      ? (node.ports ?? []).filter((p) => p.width !== 'interface' || p.preferredSide)
      : (node.ports ?? []);

    const sidePorts = aggregatePorts;
    const aggregateInputs = sidePorts.filter(
      (p) => p.direction === 'input' || p.direction === 'inout' || p.direction === 'unknown',
    );
    const aggregateOutputs = sidePorts.filter((p) => p.direction === 'output');

    const isComposition = isStruct
      ? role === 'composition'
      : isInterface
        ? false
        : aggregateInputs.length > 1;

    const isArrayAggregate = isBus && node.metadata?.aggregateKind === 'array';

    const taps = isInterfaceModport
      ? [...sidePorts]
      : isInterface
        ? [...aggregateInputs, ...aggregateOutputs]
        : isComposition
          ? aggregateInputs
          : aggregateOutputs;

    if (taps.length > 0) {
      const { width: actualWidth, height: actualHeight } = diagramNodeDimensions(node);
      const tapCenters = taps.map((_, i) => busTapPortCenterY(i, isInterfaceModport ? 2 : 1));

      const isModuleInterfaceModport = isInterfaceModport && node.label !== nodeTypeName(node);
      const pipeY = isModuleInterfaceModport ? 0 : tapCenters[0] - g / 2;
      const pipeH = isModuleInterfaceModport
        ? tapCenters[tapCenters.length - 1] + g / 2
        : tapCenters[tapCenters.length - 1] - tapCenters[0] + g;

      const pipeX = isArrayAggregate
        ? isComposition
          ? actualWidth - g * 0.5 - 3
          : g * 0.5 - 3
        : isInterfaceModport
          ? Math.round(actualWidth / 2) - 3
          : isComposition
            ? actualWidth - (isStruct ? 8 : 6)
            : 0;

      const pipeWidth = isStruct ? 8 : 6;

      const scaleX = width / actualWidth;
      const scaleY = height / actualHeight;

      const pipeCapCenterX = pipeX + 2;
      const pipeCapCenterY = pipeY + pipeH - 3;
      const pipeCapWidth = 34;
      const pipeCapHeight = 6;

      return (
        <g transform={`translate(${x}, ${y}) scale(${scaleX}, ${scaleY})`}>
          <rect
            x={pipeX}
            y={pipeY}
            width={pipeWidth}
            height={pipeH}
            rx={3}
            className={className}
            data-minimap-node-id={id}
            data-minimap-node-kind={node.kind}
            fill={color}
            stroke={color}
            strokeOpacity={0.4}
          />
          {isArrayAggregate && (
            <rect
              x={pipeCapCenterX}
              y={pipeCapCenterY - pipeCapHeight / 2}
              width={pipeCapWidth}
              height={pipeCapHeight}
              rx={pipeCapHeight / 2}
              className={className}
              data-minimap-node-id={id}
              data-minimap-node-kind={node.kind}
              fill={color}
              stroke={color}
              strokeOpacity={0.4}
              transform={`rotate(45 ${pipeCapCenterX} ${pipeCapCenterY})`}
            />
          )}
        </g>
      );
    }
  }

  const noseLength =
    node.kind === 'port' ? (diagramSizing.portNoseLength / diagramSizing.portWidth) * width : 0;
  const midY = y + height / 2;

  let path = `M ${x} ${y} h ${width} v ${height} h ${-width} Z`;

  if (node.kind === 'port') {
    const portDirection = node.ports[0]?.direction ?? 'unknown';
    if (portDirection === 'input') {
      path =
        `M ${x} ${y} H ${x + width - noseLength} L ${x + width} ${midY} ` +
        `L ${x + width - noseLength} ${y + height} H ${x} Z`;
    } else if (portDirection === 'output') {
      path =
        `M ${x + noseLength} ${y} H ${x + width} V ${y + height} ` +
        `H ${x + noseLength} L ${x} ${midY} Z`;
    }
  } else if (node.kind === 'mux' || node.kind === 'alu') {
    const totalHeight = diagramNodeDimensions(node).height;
    const muxRightSideRatio = diagramSizing.muxRightSideHeight / totalHeight;
    const rightSideHeight = height * muxRightSideRatio;
    const rightTopRel = (height - rightSideHeight) / 2;
    const rightTop = y + rightTopRel;
    const rightBottom = rightTop + rightSideHeight;

    if (node.kind === 'mux') {
      path = `M ${x} ${y} L ${x + width} ${rightTop} V ${rightBottom} L ${x} ${y + height} Z`;
    } else {
      const notchX = width / 4;
      const midY = y + height / 2;
      const slope = rightTopRel / width;
      const deltaY = slope * notchX;
      const notchTopY = midY - deltaY;
      const notchBottomY = midY + deltaY;
      path =
        `M ${x} ${y} L ${x + width} ${rightTop} V ${rightBottom} ` +
        `L ${x} ${y + height} V ${notchBottomY} ` +
        `L ${x + notchX} ${midY} L ${x} ${notchTopY} Z`;
    }
  } else if (node.kind === 'inverter') {
    const side = height / 2;
    const bubbleRadius = Math.min(width / 12, side / 3);
    const bodyRight = x + (side * Math.sqrt(3)) / 2;
    const bubbleCx = bodyRight + bubbleRadius;
    const triTop = midY - side / 2;
    const triBottom = midY + side / 2;
    path = [
      `M ${x} ${triTop}`,
      `L ${bodyRight} ${midY}`,
      `L ${x} ${triBottom}`,
      'Z',
      `M ${bubbleCx - bubbleRadius} ${midY}`,
      `a ${bubbleRadius} ${bubbleRadius} 0 1 0 ${bubbleRadius * 2} 0`,
      `a ${bubbleRadius} ${bubbleRadius} 0 1 0 ${-bubbleRadius * 2} 0`,
    ].join(' ');
  } else if (node.kind === 'gate') {
    const bodyOp = gateBodyOperation(node);
    const negated = gateIsNegated(node);
    const isXor = bodyOp === 'xor';

    // Sized relative to the minimap box (not the node's real pixel geometry) so the
    // negation bubble and XOR back-curve stay legible even when heavily zoomed out.
    const bubbleRadius = negated ? Math.min(width / 12, height / 6) : 0;
    const xorGap = isXor ? Math.min(width / 10, height / 6) : 0;

    const left = xorGap;
    const right = width - bubbleRadius * 2;
    const gateMidY = height / 2;
    const bodyPath =
      bodyOp === 'and' ? andBodyPath(left, right, height) : orBodyPath(left, right, height);
    const bubbleCx = right + bubbleRadius;

    return (
      <g transform={`translate(${x}, ${y})`}>
        {isXor && (
          <path
            d={xorBackCurvePath(right - left, height)}
            className={className}
            data-minimap-node-id={id}
            data-minimap-node-kind={node.kind}
            fill="none"
            stroke={color}
            strokeOpacity={0.4}
          />
        )}
        <path
          d={bodyPath}
          className={className}
          data-minimap-node-id={id}
          data-minimap-node-kind={node.kind}
          fill={color}
          stroke={color}
          strokeOpacity={0.4}
        />
        {negated && (
          <circle
            cx={bubbleCx}
            cy={gateMidY}
            r={bubbleRadius}
            className={className}
            data-minimap-node-id={id}
            data-minimap-node-kind={node.kind}
            fill={color}
            stroke={color}
            strokeOpacity={0.4}
          />
        )}
      </g>
    );
  } else if (node.kind === 'interface') {
    const role = structRole(node);
    const isInterfaceInstance =
      role !== 'modport' && role !== 'port' && !node.id.startsWith('interface_type:');
    if (isInterfaceInstance) {
      const { width: actualWidth, height: actualHeight } = diagramNodeDimensions(node);
      const scaleX = width / actualWidth;
      const scaleY = height / actualHeight;
      const aggregatePorts = node.ports.filter(
        (port) => port.width !== 'interface' || port.preferredSide,
      );
      const topPorts = aggregatePorts.filter(
        (p) => p.direction === 'input' && p.width !== 'interface',
      );
      const bottomPorts = aggregatePorts.filter(
        (p) => p.direction === 'output' && p.width !== 'interface',
      );
      const sidePorts = aggregatePorts.filter(
        (p) => p.width === 'interface' || (p.direction !== 'input' && p.direction !== 'output'),
      );
      const orderedSide = orderedInterfaceSidePorts(sidePorts);
      const topHatHeight = interfaceTopHatHeight(topPorts.length > 0);
      const bottomHatHeight = interfaceTopHatHeight(bottomPorts.length > 0);
      const shiftY = diagramSizing.interfaceInstanceShiftY;
      const unshiftedHeight = Math.max(diagramSizing.gridSize, actualHeight - shiftY);
      const leftCenters = distributedInterfaceSideCenters(
        orderedSide.left.length,
        unshiftedHeight,
        topHatHeight,
        bottomHatHeight,
      ).map((c) => c + shiftY);
      const rightCenters = distributedInterfaceSideCenters(
        orderedSide.right.length,
        unshiftedHeight,
        topHatHeight,
        bottomHatHeight,
      ).map((c) => c + shiftY);
      const { path: skinPath } = interfaceSkinPath({
        width: actualWidth,
        height: actualHeight,
        leftCenters,
        rightCenters,
        topPortCount: topPorts.length,
        bottomPortCount: bottomPorts.length,
      });
      return (
        <g transform={`translate(${x}, ${y}) scale(${scaleX}, ${scaleY})`}>
          <path
            d={skinPath}
            className={className}
            data-minimap-node-id={id}
            data-minimap-node-kind={node.kind}
            fill={color}
            stroke={color}
            strokeOpacity={0.4}
          />
        </g>
      );
    }
  }

  return (
    <path
      d={path}
      className={className}
      data-minimap-node-id={id}
      data-minimap-node-kind={node.kind}
      fill={color}
      stroke={color}
      strokeOpacity={0.4}
    />
  );
}
