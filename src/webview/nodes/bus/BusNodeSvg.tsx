import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import { diagramSizing } from '../../../diagram/constants';
import {
  structRole,
  nodeIsArrayNode,
  nodeTypeName,
  nodeTypeSource,
  nodeModportName,
  nodeModportSource
} from '../../../ir/nodeMetadata';
import {
  interfaceSkinPath,
  distributedInterfaceSideCenters,
  interfaceTopHatHeight,
  interfaceTopPortX,
  orderedInterfaceSidePorts
} from '../../../diagram/interfaceGeometry';
import { ARRAY_STACK_SKIN_LAYERS } from '../../arrayStackGeometry';
import { busTapPortCenterY } from '../../../diagram/busGeometry';
import type { DiagramPort, SourceRange } from '../../../ir/types';
import { SvgArrayStackLeads } from '../shared/SvgArrayStackLeads';

export function BusNodeSvg({ node, width, height, arrayConnections, onNavigateToSource }: NodeSvgProps): React.ReactElement {
  const isArray = nodeIsArrayNode(node);
  const hasArrayConnection = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    (arrayConnections ?? []).some(c => c.portId === portId && c.role === role);
  const monoTextWidth = (text: string, fontSize: number) => text.length * fontSize * 0.62;
  const dottedUnderline = (
    key: string,
    text: string,
    x: number,
    y: number,
    fontSize: number,
    className: string,
    anchor: 'start' | 'middle' | 'end' = 'start'
  ) => {
    const w = monoTextWidth(text, fontSize);
    const x1 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
    return (
      <line
        key={key}
        className={`svsch-svg-link-underline ${className}`}
        x1={x1}
        x2={x1 + w}
        y1={y + fontSize * 0.62}
        y2={y + fontSize * 0.62}
      />
    );
  };
  const navigateSvgSource = (event: React.MouseEvent, source?: SourceRange) => {
    if (!source || !onNavigateToSource) return;
    event.stopPropagation();
    onNavigateToSource(source);
  };
  const stopSvgInteraction = (event: React.SyntheticEvent) => {
    if (onNavigateToSource) event.stopPropagation();
  };
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
    const allCenters = [...leftCenters, ...rightCenters];
    const titleY = allCenters.length > 0
      ? (Math.min(...allCenters) + Math.max(...allCenters)) / 2
      : height / 2;

    const {
      path: skinPath,
      topHatTop,
      topHatHeight,
      bottomHatTop,
      bottomHatHeight
    } = interfaceSkinPath({
      width,
      height,
      leftCenters,
      rightCenters,
      topPortCount: topPorts.length,
      bottomPortCount: bottomPorts.length,
    });

    const typeName = nodeTypeName(node);
    const typeSource = nodeTypeSource(node);
    const capPortCount = Math.max(topPorts.length, bottomPorts.length);
    const titleFontSize = 10;
    const typeFontSize = 9;
    const titleGap = typeName ? 4 : 0;
    const titleLabelWidth = monoTextWidth(node.label, titleFontSize);
    const titleTypeWidth = typeName ? monoTextWidth(typeName, typeFontSize) : 0;
    const titleStartX = width / 2 - (titleLabelWidth + titleGap + titleTypeWidth) / 2;
    const titleLabelX = typeName ? titleStartX : width / 2;
    const titleTypeX = titleStartX + titleLabelWidth + titleGap;

    return (
      <g className={`hdl-interface-skin${topPorts.length > 0 ? ' hdl-interface-skin-with-tophat' : ''}${bottomPorts.length > 0 ? ' hdl-interface-skin-with-bottomhat' : ''}`}>
        <path className="hdl-interface-skin-body" d={skinPath} />
        <path className="hdl-interface-skin-selection" d={skinPath} />
        <text
          className="svsch-node-title svsch-interface-instance-title"
          x={titleLabelX}
          y={titleY}
          textAnchor={typeName ? 'start' : 'middle'}
          dominantBaseline="middle"
        >
          {node.label}
        </text>
        {typeName && (
          <>
            <text
              className={`svsch-type-label svsch-interface-type-label${typeSource ? ' svsch-svg-link' : ''}`}
              x={titleTypeX}
              y={titleY}
              dominantBaseline="middle"
              onClick={(event) => navigateSvgSource(event, typeSource)}
              onDoubleClick={stopSvgInteraction}
              onMouseDown={stopSvgInteraction}
              onPointerDown={stopSvgInteraction}
            >
              {typeName}
            </text>
            {typeSource && dottedUnderline('title-type-underline', typeName, titleTypeX, titleY, typeFontSize, 'svsch-interface-type-link-underline')}
          </>
        )}
        {/* Side port labels */}
        {orderedSide.left.map((port: DiagramPort, i: number) => (
          <React.Fragment key={port.id}>
            <text
              className={`svsch-interface-side-label svsch-interface-side-left${port.width === 'interface' ? ' svsch-interface-side-modport-label' : ''}${port.source ? ' svsch-svg-link' : ''}`}
              data-port-id={port.id}
              x={g * 0.75}
              y={leftCenters[i]}
              dominantBaseline="middle"
              onClick={(event) => navigateSvgSource(event, port.source)}
              onDoubleClick={stopSvgInteraction}
              onMouseDown={stopSvgInteraction}
              onPointerDown={stopSvgInteraction}
            >
              {port.label ?? port.name}
            </text>
            {port.source && dottedUnderline(`side-left-underline-${port.id}`, port.label ?? port.name, g * 0.75, leftCenters[i], 12, 'svsch-interface-side-link-underline')}
          </React.Fragment>
        ))}
        {orderedSide.right.map((port: DiagramPort, i: number) => (
          <React.Fragment key={port.id}>
            <text
              className={`svsch-interface-side-label svsch-interface-side-right${port.width === 'interface' ? ' svsch-interface-side-modport-label' : ''}${port.source ? ' svsch-svg-link' : ''}`}
              data-port-id={port.id}
              x={width - g * 0.75}
              y={rightCenters[i]}
              textAnchor="end"
              dominantBaseline="middle"
              onClick={(event) => navigateSvgSource(event, port.source)}
              onDoubleClick={stopSvgInteraction}
              onMouseDown={stopSvgInteraction}
              onPointerDown={stopSvgInteraction}
            >
              {port.label ?? port.name}
            </text>
            {port.source && dottedUnderline(`side-right-underline-${port.id}`, port.label ?? port.name, width - g * 0.75, rightCenters[i], 12, 'svsch-interface-side-link-underline', 'end')}
          </React.Fragment>
        ))}
        {/* Top port labels */}
        {topPorts.map((port: DiagramPort, i: number) => (
          <text
            key={port.id}
            className="svsch-interface-port-label svsch-interface-top-label"
            data-port-id={port.id}
            x={interfaceTopPortX(width, topPorts.length, i, capPortCount)}
            y={topHatTop + topHatHeight / 2}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {port.label ?? port.name}
          </text>
        ))}
        {/* Bottom port labels */}
        {bottomPorts.map((port: DiagramPort, i: number) => (
          <text
            key={port.id}
            className="svsch-interface-port-label svsch-interface-bottom-label"
            data-port-id={port.id}
            x={interfaceTopPortX(width, bottomPorts.length, i, capPortCount)}
            y={bottomHatTop + bottomHatHeight / 2}
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
      </>
    );
  }

  const pipeY = tapCenters[0] - g / 2;
  const pipeH = tapCenters[tapCenters.length - 1] - tapCenters[0] + g;
  // Interface modport: pipe is centered (matching original CSS left:50% translateX(-50%))
  // Bus breakout: pipe on left (g*2). Bus composition: pipe on right (width - g*2 - 6).
  const pipeX = isInterfaceModport
    ? Math.round(width / 2) - 3
    : isComposition ? width - g * 2 - 6 : g * 2;
  const modportName = isInterfaceModport ? nodeModportName(node) : undefined;
  const modportSource = isInterfaceModport ? nodeModportSource(node) : undefined;
  const shouldShowModportHeader = isInterfaceModport && modportName && node.label === nodeTypeName(node);

  return (
    <>
      {shouldShowModportHeader && (
        <>
          <text
            className={`svsch-interface-modport-title${modportSource ? ' svsch-svg-link' : ''}`}
            x={width / 2}
            y={g * 0.65}
            textAnchor="middle"
            dominantBaseline="middle"
            onClick={(event) => navigateSvgSource(event, modportSource)}
            onDoubleClick={(event) => navigateSvgSource(event, modportSource)}
            onMouseDown={stopSvgInteraction}
            onPointerDown={stopSvgInteraction}
          >
            {modportName}
          </text>
          {modportSource && dottedUnderline('modport-title-underline', modportName, width / 2, g * 0.65, 11, 'svsch-interface-modport-link-underline', 'middle')}
        </>
      )}
      <rect className="svsch-bus-pipe" x={pipeX} y={pipeY} width={6} height={pipeH} rx={3} />
      {taps.map((port: DiagramPort, i: number) => {
        const cy = tapCenters[i];
        const label = port.label ?? port.name;
        // For interface modport: outputs go right, inputs go left (mirrors original bus-tap-right/left CSS)
        const tapGoesRight = isInterfaceModport
          ? (port.preferredSide === 'right' || port.direction === 'output')
          : !isComposition;
        const interfaceFieldClass = isInterface
          ? ` svsch-interface-field-label ${tapGoesRight ? 'svsch-interface-field-right' : 'svsch-interface-field-left'}${port.source ? ' svsch-svg-link' : ''}`
          : '';
        return !tapGoesRight ? (
          // Left tap: line from left edge to pipe, label left of pipe (text-anchor end)
          <g key={port.id} className="svsch-bus-tap">
            <line className="svsch-bus-tap-line" x1={3} y1={cy} x2={pipeX} y2={cy} />
            <text
              className={`svsch-bus-tap-label${interfaceFieldClass}`}
              data-port-id={port.id}
              x={pipeX - 6}
              y={cy}
              textAnchor="end"
              dominantBaseline="middle"
              onClick={(event) => isInterface && navigateSvgSource(event, port.source)}
              onDoubleClick={(event) => isInterface && navigateSvgSource(event, port.source)}
              onMouseDown={isInterface ? stopSvgInteraction : undefined}
              onPointerDown={isInterface ? stopSvgInteraction : undefined}
            >
              {label}
            </text>
            {isInterface && port.source && dottedUnderline(`field-left-underline-${port.id}`, label, pipeX - 6, cy, 12, 'svsch-interface-field-link-underline', 'end')}
          </g>
        ) : (
          // Right tap: line from pipe to right edge, label right of pipe
          <g key={port.id} className="svsch-bus-tap">
            <line className="svsch-bus-tap-line" x1={pipeX + 6} y1={cy} x2={width - 3} y2={cy} />
            <rect x={pipeX + 8} y={cy - 8} width={Math.max(20, label.length * 7 + 8)} height={16} fill="var(--vscode-editor-background)" />
            <text
              className={`svsch-bus-tap-label${interfaceFieldClass}`}
              data-port-id={port.id}
              x={pipeX + 12}
              y={cy}
              dominantBaseline="middle"
              onClick={(event) => isInterface && navigateSvgSource(event, port.source)}
              onDoubleClick={(event) => isInterface && navigateSvgSource(event, port.source)}
              onMouseDown={isInterface ? stopSvgInteraction : undefined}
              onPointerDown={isInterface ? stopSvgInteraction : undefined}
            >
              {label}
            </text>
            {isInterface && port.source && dottedUnderline(`field-right-underline-${port.id}`, label, pipeX + 12, cy, 12, 'svsch-interface-field-link-underline')}
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
