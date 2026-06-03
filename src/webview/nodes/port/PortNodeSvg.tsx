import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import { portSkinPath } from '../../../diagram/interfaceGeometry';
import { diagramSizing, normalizeWidth } from '../../../diagram/constants';
import {
  nodeIsArrayNode,
  nodeModportName,
  nodeModportSource,
  nodeTypeName,
  nodeTypeSource
} from '../../../ir/nodeMetadata';
import { ARRAY_STACK_LAYERS } from '../../arrayStackGeometry';
import { SvgArrayStackLeads } from '../shared/SvgArrayStackLeads';
import { SvgParameterizedText } from '../shared/labels';

export function PortNodeSvg({ node, width, height, arrayConnections, onNavigateToSource }: NodeSvgProps): React.ReactElement {
  const isArray = nodeIsArrayNode(node);
  const hasArrayConnection = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    (arrayConnections ?? []).some(c => c.portId === portId && c.role === role);
  const port = node.ports[0];
  const direction = port?.direction ?? 'unknown';
  const isInterface = Boolean(
    port?.typeName && port?.modportName !== undefined ||
    port?.typeName?.endsWith('_if') ||
    port?.typeName?.endsWith('if')
  );
  const skinDirection: 'input' | 'output' | 'harness' = isInterface
    ? 'harness'
    : direction === 'input' || direction === 'output'
      ? direction
      : 'input';

  const d = portSkinPath(
    skinDirection,
    width,
    height,
    diagramSizing.portSkinHeight,
    diagramSizing.portNoseLength
  );

  const leadSide = skinDirection === 'output' ? 'left' : 'right';
  const portWidth = normalizeWidth(port?.widthExpression ?? port?.width);
  const displayWidth = (portWidth && portWidth !== 'interface') ? portWidth : undefined;
  const typeName = nodeTypeName(node) ?? port?.typeName;
  const typeSource = nodeTypeSource(node) ?? port?.typeSource;
  const modportName = nodeModportName(node) ?? port?.modportName;
  const modportSource = nodeModportSource(node) ?? port?.modportSource;
  const widthSuffix = !typeName ? displayWidth : undefined;
  const labelFontSize = 12;
  const typeFontSize = labelFontSize * 0.9;
  const monoTextWidth = (text: string, fontSize: number) => text.length * fontSize * 0.62;
  const typeText = typeName ?? '';
  const modportText = modportName ? `.${modportName}` : '';
  const labelGap = typeName || widthSuffix ? monoTextWidth(' ', labelFontSize) : 0;
  const labelWidth = monoTextWidth(node.label, labelFontSize)
    + labelGap
    + (typeName
      ? monoTextWidth(typeText, typeFontSize) + monoTextWidth(modportText, typeFontSize)
      : widthSuffix
        ? monoTextWidth(widthSuffix, labelFontSize)
        : 0);
  const labelStartX = width / 2 - labelWidth / 2;
  const typeStartX = labelStartX + monoTextWidth(node.label, labelFontSize) + labelGap;
  const typeWidth = monoTextWidth(typeText, typeFontSize);
  const modportStartX = typeStartX + typeWidth;
  const underlineY = height / 2 + typeFontSize * 0.62;
  const stopSvgInteraction = (event: React.SyntheticEvent) => {
    if (onNavigateToSource) event.stopPropagation();
  };
  const navigateSvgSource = (event: React.MouseEvent, source: typeof typeSource) => {
    if (!source || !onNavigateToSource) return;
    event.stopPropagation();
    onNavigateToSource(source);
  };

  return (
    // Wrap in <g> with direction class so existing CSS rules
    // (.port-skin-input .port-skin-body) apply via descendant selector
    <g className={`port-skin port-skin-${skinDirection}`}>
      {/* Array back layer */}
      {isArray && (
        <path
          className="port-skin-body port-skin-array-layer port-skin-array-back svsch-array-layer-back"
          transform={`translate(${ARRAY_STACK_LAYERS.back.dx}, ${ARRAY_STACK_LAYERS.back.dy})`}
          d={d}
          opacity={0.5}
        />
      )}
      {/* Main body (also serves as middle array layer) */}
      <path
        className={`port-skin-body${isArray ? ' port-skin-array-middle' : ''} svsch-array-layer-middle`}
        d={d}
      />
      {/* Array front layer */}
      {isArray && (
        <path
          className="port-skin-body port-skin-array-layer port-skin-array-front svsch-array-layer-front"
          transform={`translate(${ARRAY_STACK_LAYERS.front.dx}, ${ARRAY_STACK_LAYERS.front.dy})`}
          d={d}
        />
      )}
      <path className="port-skin-selection" d={d} />
      {/* Keep IO/interface port labels full in SVG; collapsed designators belong to internal block ports. */}
      <text
        className="svsch-port-label svsch-port-node-label"
        x={width / 2}
        y={height / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        fontWeight={600}
        fontSize={12}
      >
        <tspan className="svsch-port-node-name">{node.label}</tspan>
        {typeName ? (
          <>
            <tspan> </tspan>
            <tspan
              className={`svsch-type-label svsch-port-type-label${typeSource ? ' svsch-svg-link' : ''}`}
              onClick={(event) => navigateSvgSource(event, typeSource)}
              onDoubleClick={stopSvgInteraction}
              onMouseDown={stopSvgInteraction}
              onPointerDown={stopSvgInteraction}
            >
              {typeName}
            </tspan>
            {modportName && (
              <tspan
                className={`svsch-modport-label svsch-port-modport-label${modportSource ? ' svsch-svg-link' : ''}`}
                onClick={(event) => navigateSvgSource(event, modportSource)}
                onDoubleClick={stopSvgInteraction}
                onMouseDown={stopSvgInteraction}
                onPointerDown={stopSvgInteraction}
              >
                .{modportName}
              </tspan>
            )}
          </>
        ) : widthSuffix ? (
          <tspan className="svsch-port-width-suffix"> <SvgParameterizedText text={widthSuffix} refs={port?.parameterRefs} onNavigateToSource={onNavigateToSource} /></tspan>
        ) : null}
      </text>
      {typeName && typeSource && (
        <line
          className="svsch-svg-link-underline svsch-port-type-link-underline"
          x1={typeStartX}
          x2={typeStartX + typeWidth}
          y1={underlineY}
          y2={underlineY}
        />
      )}
      {typeName && modportName && modportSource && (
        <line
          className="svsch-svg-link-underline svsch-port-type-link-underline"
          x1={modportStartX}
          x2={modportStartX + monoTextWidth(modportText, typeFontSize)}
          y1={underlineY}
          y2={underlineY}
        />
      )}

      {/* Array stack leads */}
      {isArray && skinDirection === 'output' && port && hasArrayConnection(port.id, 'target') && (
        <SvgArrayStackLeads side={leadSide} width={width} y={diagramSizing.portHeight / 2} trimSink />
      )}
      {isArray && skinDirection !== 'output' && port && hasArrayConnection(port.id, 'source') && (
        <SvgArrayStackLeads side={leadSide} width={width} y={diagramSizing.portHeight / 2} />
      )}
    </g>
  );
}
