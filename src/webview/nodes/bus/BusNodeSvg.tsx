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
import { SvgPortLabel, portDisplayLabel, SvgStructFieldAnnotation, getSvgStructFieldAnnotation } from '../shared/labels';

export function BusNodeSvg({ node, width, height, arrayConnections, onNavigateToSource }: NodeSvgProps): React.ReactElement {
  const isArray = nodeIsArrayNode(node);
  const hasArrayConnection = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    (arrayConnections ?? []).some(c => c.portId === portId && c.role === role);
  const monoTextWidth = (text: string, fontSize: number) => text.length * fontSize * 0.62;
  const linkTextWidth = (text: string, fontSize: number) => text.length * fontSize * 0.55;
  const dottedUnderline = (
    key: string,
    text: string,
    x: number,
    y: number,
    fontSize: number,
    className: string,
    anchor: 'start' | 'middle' | 'end' = 'start'
  ) => {
    const w = linkTextWidth(text, fontSize);
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
    console.log('navigateSvgSource called with source:', source);
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
        {orderedSide.left.map((port: DiagramPort, i: number) => {
          const isStructBreakout = port.width !== 'interface';
          const annotation = isStructBreakout ? getSvgStructFieldAnnotation(node, port) : undefined;
          const displayLabel = portDisplayLabel(port, { annotation, hideInterfaceSuffix: isInterface });
          return (
            <React.Fragment key={port.id}>
              <text
                className={`svsch-interface-side-label svsch-interface-side-left${port.width === 'interface' ? ' svsch-interface-side-modport-label' : ''}${port.source ? ' svsch-svg-link' : ''}`}
                data-port-id={port.id}
                x={g * 0.75}
                y={leftCenters[i]}
                dominantBaseline="middle"
                onDoubleClick={(event) => navigateSvgSource(event, port.source)}
                onMouseDown={stopSvgInteraction}
                onPointerDown={stopSvgInteraction}
              >
                <SvgPortLabel port={port} hideInterfaceSuffix={isInterface} />
                {isStructBreakout && <SvgStructFieldAnnotation node={node} port={port} />}
              </text>
              {port.source && dottedUnderline(`side-left-underline-${port.id}`, displayLabel, g * 0.75, leftCenters[i], 12, 'svsch-interface-side-link-underline')}
            </React.Fragment>
          );
        })}
        {orderedSide.right.map((port: DiagramPort, i: number) => {
          const isStructBreakout = port.width !== 'interface';
          const annotation = isStructBreakout ? getSvgStructFieldAnnotation(node, port) : undefined;
          const displayLabel = portDisplayLabel(port, { annotation, hideInterfaceSuffix: isInterface });
          return (
            <React.Fragment key={port.id}>
              <text
                className={`svsch-interface-side-label svsch-interface-side-right${port.width === 'interface' ? ' svsch-interface-side-modport-label' : ''}${port.source ? ' svsch-svg-link' : ''}`}
                data-port-id={port.id}
                x={width - g * 0.75}
                y={rightCenters[i]}
                textAnchor="end"
                dominantBaseline="middle"
                onDoubleClick={(event) => navigateSvgSource(event, port.source)}
                onMouseDown={stopSvgInteraction}
                onPointerDown={stopSvgInteraction}
              >
                <SvgPortLabel port={port} hideInterfaceSuffix={isInterface} />
                {isStructBreakout && <SvgStructFieldAnnotation node={node} port={port} />}
              </text>
              {port.source && dottedUnderline(`side-right-underline-${port.id}`, displayLabel, width - g * 0.75, rightCenters[i], 12, 'svsch-interface-side-link-underline', 'end')}
            </React.Fragment>
          );
        })}
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
            <SvgPortLabel port={port} />
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
            <SvgPortLabel port={port} />
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
  const isArrayAggregate = node.kind === 'bus' && node.metadata?.aggregateKind === 'array';

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

  const isModuleInterfaceModport = isInterfaceModport && node.label !== nodeTypeName(node);
  const pipeY = isModuleInterfaceModport ? 0 : tapCenters[0] - g / 2;
  const pipeH = isModuleInterfaceModport ? tapCenters[tapCenters.length - 1] + g / 2 : tapCenters[tapCenters.length - 1] - tapCenters[0] + g;
  // Interface modport: pipe is centered (matching original CSS left:50% translateX(-50%))
  // Bus breakout: pipe on left (g*2). Bus composition: pipe on right (width - g*2 - 6).
  const pipeX = isArrayAggregate
    ? isComposition
      ? width - g * 2.5 - 3
      : g * 1.5 - 3
    : isInterfaceModport
    ? Math.round(width / 2) - 3
    : isComposition ? width - g * 2 - 6 : g * 2;

  const pipeWidth = 6;
  const pipeCapWidth = 34;
  const pipeCapHeight = 6;
  const pipeCapCenterX = pipeX + 2;
  const pipeCapCenterY = pipeY + pipeH - 3;
  const pipeCapGradientId = `svsch-bus-array-cap-${node.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  // labelMaskPaddingX is how far the background mask extends left of the label text.
  // labelGapFromPipeEdge = labelMaskPaddingX + g/2 so the visible stub (colored line between
  // pipe edge and mask) is exactly g/2, matching the old HTML/CSS rendering.
  const labelMaskPaddingX = 10;
  const labelGapFromPipeEdge = isArrayAggregate ? g / 2 + 10 : labelMaskPaddingX + g / 2;

  const modportName = isInterfaceModport ? nodeModportName(node) : undefined;
  const modportSource = isInterfaceModport ? nodeModportSource(node) : undefined;
  const shouldShowModportHeader = isInterfaceModport && modportName && node.label === nodeTypeName(node);

  return (
    <>
      {shouldShowModportHeader && (
        <text
          className="svsch-interface-modport-title"
          x={width / 2}
          y={g * 0.65}
          textAnchor="middle"
          dominantBaseline="middle"
          onDoubleClick={(event) => navigateSvgSource(event, modportSource)}
          onClick={(event) => navigateSvgSource(event, modportSource)}
          onMouseDown={stopSvgInteraction}
          onPointerDown={stopSvgInteraction}
        >
          {modportName}
        </text>
      )}
      {isArrayAggregate && (
        <defs>
          <linearGradient id={pipeCapGradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" className="svsch-bus-array-cap-stop-strong" />
            <stop offset="100%" className="svsch-bus-array-cap-stop-dim" />
          </linearGradient>
        </defs>
      )}
      <rect className={`svsch-bus-pipe${isArrayAggregate ? ' svsch-bus-pipe-array' : ''}`} x={pipeX} y={pipeY} width={pipeWidth} height={pipeH} rx={3} />
      {isArrayAggregate && (
        <rect
          className="svsch-bus-array-pipe-cap"
          x={pipeCapCenterX}
          y={pipeCapCenterY - pipeCapHeight / 2}
          width={pipeCapWidth}
          height={pipeCapHeight}
          rx={pipeCapHeight / 2}
          fill={`url(#${pipeCapGradientId})`}
          transform={`rotate(45 ${pipeCapCenterX} ${pipeCapCenterY})`}
        />
      )}
      {taps.map((port: DiagramPort, i: number) => {
        const cy = tapCenters[i];
        const isStructBreakout = node.kind === 'struct' || (node.kind === 'interface' && port.width !== 'interface');
        const annotation = isStructBreakout ? getSvgStructFieldAnnotation(node, port) : undefined;
        // Aggregate taps already encode slice/range text in their labels.
        const showCollapsedDesignator = false;
        const displayLabel = portDisplayLabel(port, {
          annotation,
          showWidth: showCollapsedDesignator,
          collapseWidth: showCollapsedDesignator,
          hideInterfaceSuffix: isInterface
        });
        const labelMaskWidth = Math.max(20, monoTextWidth(displayLabel, 12) + labelMaskPaddingX * 2);
        const leftLabelX = pipeX - labelGapFromPipeEdge;
        const rightLabelX = pipeX + pipeWidth + labelGapFromPipeEdge;
        // For interface modport: outputs go right, inputs go left (mirrors original bus-tap-right/left CSS)
        const tapGoesRight = isInterfaceModport
          ? (port.preferredSide === 'right' || port.direction === 'output')
          : !isComposition;
        const interfaceFieldClass = isInterface
          ? ` svsch-interface-field-label ${tapGoesRight ? 'svsch-interface-field-right' : 'svsch-interface-field-left'}`
          : '';
        return !tapGoesRight ? (
          // Left tap: line from left edge to pipe, label left of pipe (text-anchor end)
          <g key={port.id} className="svsch-bus-tap" data-port-id={port.id}>
            <line className="svsch-bus-tap-line" x1={0} y1={cy} x2={pipeX} y2={cy} />
            <rect x={leftLabelX + labelMaskPaddingX - labelMaskWidth} y={cy - 8} width={labelMaskWidth} height={16} fill="var(--vscode-editor-background)" />
            <text
              className={`svsch-bus-tap-label${interfaceFieldClass}`}
              data-port-id={port.id}
              x={leftLabelX}
              y={cy}
              textAnchor="end"
              dominantBaseline="middle"
              onDoubleClick={(event) => navigateSvgSource(event, port.source)}
              onMouseDown={isInterface ? stopSvgInteraction : undefined}
              onPointerDown={isInterface ? stopSvgInteraction : undefined}
            >
              <SvgPortLabel
                port={port}
                showWidth={showCollapsedDesignator}
                collapseWidth={showCollapsedDesignator}
                hideInterfaceSuffix={isInterface}
              />
              {isStructBreakout && <SvgStructFieldAnnotation node={node} port={port} />}
            </text>
          </g>
        ) : (
          // Right tap: line from pipe to right edge, label right of pipe
          <g key={port.id} className="svsch-bus-tap" data-port-id={port.id}>
            <line className="svsch-bus-tap-line" x1={pipeX + pipeWidth} y1={cy} x2={width} y2={cy} />
            <rect x={rightLabelX - labelMaskPaddingX} y={cy - 8} width={labelMaskWidth} height={16} fill="var(--vscode-editor-background)" />
            <text
              className={`svsch-bus-tap-label${interfaceFieldClass}`}
              data-port-id={port.id}
              x={rightLabelX}
              y={cy}
              dominantBaseline="middle"
              onDoubleClick={(event) => navigateSvgSource(event, port.source)}
              onMouseDown={isInterface ? stopSvgInteraction : undefined}
              onPointerDown={isInterface ? stopSvgInteraction : undefined}
            >
              <SvgPortLabel
                port={port}
                showWidth={showCollapsedDesignator}
                collapseWidth={showCollapsedDesignator}
                hideInterfaceSuffix={isInterface}
              />
              {isStructBreakout && <SvgStructFieldAnnotation node={node} port={port} />}
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
