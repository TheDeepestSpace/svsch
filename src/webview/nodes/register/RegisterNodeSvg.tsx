import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import { diagramSizing, normalizeWidth } from '../../../diagram/constants';
import { registerPortTop, registerExtraInputPortTop } from '../../../diagram/registerGeometry';
import {
  registerClockSignal,
  registerResetSignal,
  registerResetActiveLow,
  nodeArrayDimension,
  nodeIsArrayNode,
  nodeTypeName,
  nodeTypeSource,
  nodeWidth as metadataNodeWidth,
} from '../../../ir/nodeMetadata';
import { nodeStackIsWide } from '../../../ir/edgeStyle';
import { arrayStackLayersFor, arrayStackSkinLayersFor } from '../../arrayStackGeometry';
import { SvgArrayStackLeads } from '../shared/SvgArrayStackLeads';
import { SvgParameterizedText, SvgParameterizedTextUnderlines, SvgPortLabel } from '../shared/labels';
import type { DiagramPort } from '../../../ir/types';

export function RegisterNodeSvg({ node, width, height, arrayConnections, onNavigateToSource }: NodeSvgProps): React.ReactElement {
  const hasArrayConnection = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    (arrayConnections ?? []).some(c => c.portId === portId && c.role === role);
  const arrayConnectionThick = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    (arrayConnections ?? []).find(c => c.portId === portId && c.role === role)?.thick ?? false;
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
  const stackWide = isArray && nodeStackIsWide(node);
  const stackLayers = arrayStackLayersFor(stackWide);
  const skinLayers = arrayStackSkinLayersFor(stackWide);
  const arrayDim = nodeArrayDimension(node);
  const declaredWidth = normalizeWidth(metadataNodeWidth(node));
  const outputWidth = normalizeWidth(qPort?.width);
  const displayWidth = declaredWidth ?? outputWidth;
  const typeName = nodeTypeName(node);
  const typeSource = nodeTypeSource(node);
  const widthSuffix = typeName ? undefined : displayWidth;
  const hasTitleSuffix = Boolean(typeName || widthSuffix);
  const titleX = 10;
  const titleY = 26;
  const titleFontSize = 14;
  const typeFontSize = titleFontSize * 0.9;
  const monoTextWidth = (text: string, fontSize: number) => text.length * fontSize * 0.62;
  const typeLinkWidth = (text: string, fontSize: number) => text.length * fontSize * 0.55;
  const suffixGap = hasTitleSuffix ? 4 : 0;
  const labelWidth = monoTextWidth(node.label, titleFontSize);
  const suffixText = typeName ?? widthSuffix ?? '';
  const suffixFontSize = typeName ? typeFontSize : titleFontSize;
  const suffixStartX = titleX + labelWidth + suffixGap;
  const suffixWidth = hasTitleSuffix
    ? (typeName ? typeLinkWidth(suffixText, suffixFontSize) : monoTextWidth(suffixText, suffixFontSize))
    : 0;
  const underlineY = titleY + typeFontSize * 0.62;
  const contentShiftX = isArray ? stackLayers.front.dx : 0;
  const contentShiftY = isArray ? stackLayers.front.dy : 0;
  const shapeTransform = isArray
    ? `translate(${stackLayers.front.dx}, ${stackLayers.front.dy})`
    : undefined;
  const stopSvgInteraction = (event: React.SyntheticEvent) => {
    if (onNavigateToSource) event.stopPropagation();
  };
  const navigateSvgType = (event: React.MouseEvent) => {
    if (!typeSource || !onNavigateToSource) return;
    event.stopPropagation();
    onNavigateToSource(typeSource);
  };

  const dTop = registerPortTop('d', height, hasReset, hasRv);
  const qTop = registerPortTop('q', height, hasReset, hasRv);
  const clkTop = registerPortTop('clock', height, hasReset, hasRv);
  const rstTop = registerPortTop('reset', height, hasReset, hasRv);
  const rvTop = registerPortTop('rv', height, hasReset, hasRv);
  const targetStackLeads = (
    <>
      {isArray && dPort && hasArrayConnection(dPort.id, 'target') && (
        <SvgArrayStackLeads wide={stackWide} thick={arrayConnectionThick(dPort.id, 'target')} side="left" width={width} y={dTop + g / 2} trimSink />
      )}
      {isArray && clockPort && hasArrayConnection(clockPort.id, 'target') && (
        <SvgArrayStackLeads wide={stackWide} thick={arrayConnectionThick(clockPort.id, 'target')} side="left" width={width} y={clkTop + g / 2} trimSink />
      )}
    </>
  );

  return (
    <>
      {targetStackLeads}
      {/* Array stack layers (back→middle→front for correct z-order) */}
      {isArray && skinLayers.filter(layer => layer.id !== 'front').map(layer => (
        <rect
          key={layer.id}
          className={`svsch-node-shape hdl-node-array-layer hdl-node-array-${layer.id} svsch-array-layer-${layer.id}`}
          transform={`translate(${layer.dx}, ${layer.dy})`}
          width={width} height={height}
          opacity={layer.id === 'back' ? 0.5 : layer.id === 'middle' ? 0.75 : 1}
        />
      ))}

      {/* Background */}
      <rect
        className={`svsch-node-shape${isArray ? ' hdl-node-array-layer hdl-node-array-front svsch-array-layer-front' : ''}`}
        transform={shapeTransform}
        width={width}
        height={height}
      />

      {/* Kind + title in header */}
      <text className="svsch-node-kind" x={10 + contentShiftX} y={14 + contentShiftY} textAnchor="start" dominantBaseline="middle">REGISTER</text>
      <text className="svsch-node-title" x={titleX + contentShiftX} y={titleY + contentShiftY} textAnchor="start" dominantBaseline="middle">
        <tspan>{node.label}</tspan>
        {typeName ? (
          <tspan
            className={`svsch-type-label svsch-register-type-label${typeSource ? ' svsch-svg-link' : ''}`}
            dx={suffixGap}
            onClick={navigateSvgType}
            onDoubleClick={stopSvgInteraction}
            onMouseDown={stopSvgInteraction}
            onPointerDown={stopSvgInteraction}
          >
            {typeName}
          </tspan>
        ) : widthSuffix ? (
          <tspan className="svsch-register-width-suffix" dx={suffixGap}>
            <SvgParameterizedText text={widthSuffix} refs={qPort?.parameterRefs} onNavigateToSource={onNavigateToSource} />
          </tspan>
        ) : null}
        {isArray && <tspan className="svsch-svg-array-index"> [0]</tspan>}
      </text>
      {typeName && typeSource && (
        <line
          className="svsch-svg-link-underline svsch-register-type-link-underline"
          x1={suffixStartX + contentShiftX}
          x2={suffixStartX + contentShiftX + suffixWidth}
          y1={underlineY + contentShiftY}
          y2={underlineY + contentShiftY}
        />
      )}
      {widthSuffix && (
        <SvgParameterizedTextUnderlines
          text={widthSuffix}
          refs={qPort?.parameterRefs}
          x={suffixStartX + contentShiftX}
          y={titleY + contentShiftY}
          fontSize={titleFontSize}
          textWidth={(part) => monoTextWidth(part, titleFontSize)}
          className="svsch-register-type-link-underline"
        />
      )}

      {/* D port label (left side) */}
      {dPort && (
        <text className="svsch-port-label" x={g / 2 + contentShiftX} y={dTop + g / 2 + contentShiftY} dominantBaseline="middle">
          <SvgPortLabel port={dPort} />
        </text>
      )}

      {/* Q port label (right side) */}
      {qPort && (
        <text className="svsch-port-label" x={width - g / 2 + contentShiftX} y={qTop + g / 2 + contentShiftY} textAnchor="end" dominantBaseline="middle">
          <SvgPortLabel port={qPort} />
        </text>
      )}

      {/* Clock glyph: triangle chevron, left side */}
      {clockPort && (
        <g className="svsch-register-clock-port">
          <svg x={contentShiftX} y={clkTop + g / 2 - 6 + contentShiftY} width={12} height={12} viewBox="0 0 12 12" className="register-clock-glyph" aria-hidden={true}>
            <path d="M 1 1.5 L 9 6 L 1 10.5" />
          </svg>
        </g>
      )}

      {/* Reset label: centered at bottom, if present */}
      {resetPort && (
        <g className="svsch-register-reset-port">
          <text className="svsch-port-label svsch-register-reset-label" x={width / 2 + contentShiftX} y={rstTop + g / 2 + contentShiftY} textAnchor="middle" dominantBaseline="middle">
            {resetActiveLow ? 'R̅' : 'R'}
          </text>
        </g>
      )}

      {/* RV port */}
      {rvPort && (
        <text className="svsch-port-label" x={g / 2 + contentShiftX} y={rvTop + g / 2 + contentShiftY} dominantBaseline="middle">RV</text>
      )}

      {/* Extra input ports */}
      {extraInputPorts.map((port: DiagramPort, index: number) => {
        const top = registerExtraInputPortTop(index, height, hasRv);
        return (
          <text key={port.id} className="svsch-port-label" x={g * 0.75 + contentShiftX} y={top + g / 2 + contentShiftY} dominantBaseline="middle">
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
      {isArray && resetPort && hasArrayConnection(resetPort.id, 'target') && (
        <SvgArrayStackLeads wide={stackWide} thick={arrayConnectionThick(resetPort.id, 'target')} side="bottom" width={width} y={rstTop + g} trimSink />
      )}
      {isArray && qPort && hasArrayConnection(qPort.id, 'source') && (
        <SvgArrayStackLeads wide={stackWide} thick={arrayConnectionThick(qPort.id, 'source')} side="right" width={width} y={qTop + g / 2} />
      )}
    </>
  );
}
