import React from 'react';
import { useNodes, type MiniMapNodeProps } from '@xyflow/react';
import { diagramSizing } from '../../diagram/constants';
import { diagramNodeDimensions } from '../../diagram/nodeSizing';
import {
  distributedInterfaceSideCenters,
  interfaceSkinPath,
  interfaceTopHatHeight,
  orderedInterfaceSidePorts
} from '../../diagram/interfaceGeometry';
import { structRole } from '../../ir/nodeMetadata';
import type { HdlFlowNode } from './types';

export function MiniMapNode({ id, x, y, width, height, className }: MiniMapNodeProps): React.ReactElement | null {
  const nodes = useNodes<HdlFlowNode>();
  const flowNode = nodes.find((n: HdlFlowNode) => n.id === id);
  const node = flowNode?.data.node;

  if (!node) {
    return <rect x={x} y={y} width={width} height={height} className={className} fill="var(--vscode-editor-foreground)" />;
  }

  if (node.kind === 'netLabel') {
    return null;
  }

  const noseLength = node.kind === 'port' ? (diagramSizing.portNoseLength / diagramSizing.portWidth) * width : 0;
  const midY = y + height / 2;

  let path = `M ${x} ${y} h ${width} v ${height} h ${-width} Z`;

  if (node.kind === 'port') {
    const portDirection = node.ports[0]?.direction ?? 'unknown';
    if (portDirection === 'input') {
      path = `M ${x} ${y} H ${x + width - noseLength} L ${x + width} ${midY} L ${x + width - noseLength} ${y + height} H ${x} Z`;
    } else if (portDirection === 'output') {
      path = `M ${x + noseLength} ${y} H ${x + width} V ${y + height} H ${x + noseLength} L ${x} ${midY} Z`;
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
      path = `M ${x} ${y} L ${x + width} ${rightTop} V ${rightBottom} L ${x} ${y + height} V ${notchBottomY} L ${x + notchX} ${midY} L ${x} ${notchTopY} Z`;
    }
  } else if (node.kind === 'inverter') {
    const side = height / 2;
    const bubbleRadius = Math.min(width / 12, side / 3);
    const bodyRight = x + side * Math.sqrt(3) / 2;
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
      `a ${bubbleRadius} ${bubbleRadius} 0 1 0 ${-bubbleRadius * 2} 0`
    ].join(' ');
  } else if (node.kind === 'interface') {
    const role = structRole(node);
    const isInterfaceInstance = role !== 'modport' && role !== 'port' && !node.id.startsWith('interface_type:');
    if (isInterfaceInstance) {
      const { width: actualWidth, height: actualHeight } = diagramNodeDimensions(node);
      const scaleX = width / actualWidth;
      const scaleY = height / actualHeight;
      const aggregatePorts = node.ports.filter((port) => port.width !== 'interface' || port.preferredSide);
      const topPorts = aggregatePorts.filter(p => p.direction === 'input' && p.width !== 'interface');
      const bottomPorts = aggregatePorts.filter(p => p.direction === 'output' && p.width !== 'interface');
      const sidePorts = aggregatePorts.filter(p => p.width === 'interface' || (p.direction !== 'input' && p.direction !== 'output'));
      const orderedSide = orderedInterfaceSidePorts(sidePorts);
      const topHatHeight = interfaceTopHatHeight(topPorts.length > 0);
      const bottomHatHeight = interfaceTopHatHeight(bottomPorts.length > 0);
      const shiftY = diagramSizing.gridSize * 3 + diagramSizing.gridSize / 2;
      const unshiftedHeight = Math.max(diagramSizing.gridSize, actualHeight - shiftY);
      const leftCenters = distributedInterfaceSideCenters(orderedSide.left.length, unshiftedHeight, topHatHeight, bottomHatHeight).map(c => c + shiftY);
      const rightCenters = distributedInterfaceSideCenters(orderedSide.right.length, unshiftedHeight, topHatHeight, bottomHatHeight).map(c => c + shiftY);
      const { path: skinPath } = interfaceSkinPath({
        width: actualWidth,
        height: actualHeight,
        leftCenters,
        rightCenters,
        topPortCount: topPorts.length,
        bottomPortCount: bottomPorts.length
      });
      return (
        <g transform={`translate(${x}, ${y}) scale(${scaleX}, ${scaleY})`}>
          <path
            d={skinPath}
            className={className}
            fill="var(--vscode-editor-foreground)"
            stroke="var(--vscode-editor-foreground)"
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
      fill="var(--vscode-editor-foreground)"
      stroke="var(--vscode-editor-foreground)"
      strokeOpacity={0.4}
    />
  );
}
