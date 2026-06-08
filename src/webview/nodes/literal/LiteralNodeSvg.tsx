import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import { nodeArrayDimension, nodeIsArrayNode, nodeTypeName, nodeTypeSource, nodeWidth as metadataNodeWidth } from '../../../ir/nodeMetadata';
import { normalizeWidth } from '../../../diagram/constants';
import { ARRAY_STACK_LAYERS, ARRAY_STACK_SKIN_LAYERS } from '../../arrayStackGeometry';
import { SvgArrayStackLeads } from '../shared/SvgArrayStackLeads';
import { SvgParameterizedText, SvgParameterizedTextUnderlines } from '../shared/labels';
import type { DiagramPort } from '../../../ir/types';

export function LiteralNodeSvg({ node, width, height, arrayConnections, onNavigateToSource }: NodeSvgProps): React.ReactElement {
  const isArray = nodeIsArrayNode(node);
  const arrayDim = nodeArrayDimension(node);
  const hasArrayConnection = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    (arrayConnections ?? []).some(c => c.portId === portId && c.role === role);
  const outputs: DiagramPort[] = node.ports.filter((p: DiagramPort) => p.direction === 'output');
  const outputPort = outputs[0];
  const nodeDeclaredWidth = normalizeWidth(metadataNodeWidth(node));
  const portWidth = normalizeWidth(outputPort?.widthExpression ?? outputPort?.width);
  const displayWidth = nodeDeclaredWidth ?? portWidth;
  const typeName = nodeTypeName(node);
  const typeSource = nodeTypeSource(node);
  const widthSuffix = typeName ? undefined : displayWidth;
  const hasSuffix = Boolean(typeName || widthSuffix);
  const literalFontSize = 11;
  const typeFontSize = literalFontSize * 0.9;
  const monoTextWidth = (text: string, fontSize: number) => text.length * fontSize * 0.62;
  const labelWidth = monoTextWidth(node.label, literalFontSize);
  const suffixGap = hasSuffix ? 4 : 0;
  const suffixText = typeName ?? widthSuffix ?? '';
  const suffixFontSize = typeName ? typeFontSize : literalFontSize;
  const suffixWidth = hasSuffix ? monoTextWidth(suffixText, suffixFontSize) : 0;
  const textStartX = width / 2 - (labelWidth + suffixGap + suffixWidth) / 2;
  const suffixStartX = textStartX + labelWidth + suffixGap;
  const underlineY = height / 2 + typeFontSize * 0.62;
  const shapeWidth = Math.max(0, width - 1);
  const shapeHeight = Math.max(0, height - 1);
  const contentShiftX = isArray ? ARRAY_STACK_LAYERS.front.dx : 0;
  const contentShiftY = isArray ? ARRAY_STACK_LAYERS.front.dy : 0;
  const shapeTransform = isArray
    ? `translate(${ARRAY_STACK_LAYERS.front.dx}, ${ARRAY_STACK_LAYERS.front.dy})`
    : undefined;
  const stopSvgInteraction = (event: React.SyntheticEvent) => {
    if (onNavigateToSource) event.stopPropagation();
  };
  const navigateSvgType = (event: React.MouseEvent) => {
    if (!typeSource || !onNavigateToSource) return;
    event.stopPropagation();
    onNavigateToSource(typeSource);
  };

  return (
    <>
      {isArray && ARRAY_STACK_SKIN_LAYERS.filter(layer => layer.id !== 'front').map(layer => (
        <rect
          key={layer.id}
          className={`svsch-node-shape svsch-literal-shape hdl-node-array-layer hdl-node-array-${layer.id} svsch-array-layer-${layer.id}`}
          transform={`translate(${layer.dx}, ${layer.dy})`}
          x={0.5}
          y={0.5}
          width={shapeWidth}
          height={shapeHeight}
          opacity={layer.id === 'back' ? 0.5 : layer.id === 'middle' ? 0.75 : 1}
        />
      ))}
      <rect
        className={`svsch-node-shape svsch-literal-shape${isArray ? ' hdl-node-array-layer hdl-node-array-front svsch-array-layer-front' : ''}`}
        transform={shapeTransform}
        x={0.5}
        y={0.5}
        width={shapeWidth}
        height={shapeHeight}
      />
      <text className="svsch-node-title svsch-literal-content" x={Math.round(width / 2 + contentShiftX)} y={Math.round(height / 2 + contentShiftY)} textAnchor="middle" dominantBaseline="middle">
        <tspan>{node.label}</tspan>
        {typeName ? (
          <tspan
            className={`svsch-type-label svsch-literal-type-label${typeSource ? ' svsch-svg-link' : ''}`}
            dx={suffixGap}
            onClick={navigateSvgType}
            onDoubleClick={stopSvgInteraction}
            onMouseDown={stopSvgInteraction}
            onPointerDown={stopSvgInteraction}
          >
            {typeName}
          </tspan>
        ) : widthSuffix ? (
          <tspan dx={suffixGap}>
            <SvgParameterizedText text={widthSuffix} refs={outputPort?.parameterRefs} onNavigateToSource={onNavigateToSource} />
          </tspan>
        ) : null}
        {isArray && <tspan className="svsch-svg-array-index"> [0]</tspan>}
      </text>
      {typeName && typeSource && (
        <line
          className="svsch-svg-link-underline svsch-literal-type-link-underline"
          x1={Math.round(suffixStartX + contentShiftX)}
          x2={Math.round(suffixStartX + contentShiftX + suffixWidth)}
          y1={Math.round(underlineY + contentShiftY)}
          y2={Math.round(underlineY + contentShiftY)}
        />
      )}
      {widthSuffix && (
        <SvgParameterizedTextUnderlines
          text={widthSuffix}
          refs={outputPort?.parameterRefs}
          x={Math.round(suffixStartX + contentShiftX)}
          y={Math.round(height / 2 + contentShiftY)}
          fontSize={literalFontSize}
          textWidth={(part) => monoTextWidth(part, literalFontSize)}
          className="svsch-literal-type-link-underline"
        />
      )}
      {isArray && arrayDim && (
        <text className="svsch-node-kind svsch-array-badge" x={Math.round(width + 3)} y={-4} textAnchor="start">
          {arrayDim}
        </text>
      )}

      {/* Array stack leads */}
      {isArray && outputs.map((port: DiagramPort) =>
        hasArrayConnection(port.id, 'source') ? (
          <SvgArrayStackLeads key={port.id} side="right" width={width} y={Math.round(height / 2)} />
        ) : null
      )}
    </>
  );
}
