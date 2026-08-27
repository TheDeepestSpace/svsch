import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import { portSkinPath } from '../../../diagram/interfaceGeometry';
import { diagramSizing, normalizeWidth } from '../../../diagram/constants';
import {
  nodeIsArrayNode,
  nodeArrayDimension,
  nodeModportName,
  nodeModportSource,
  nodeTypeName,
  nodeTypeSource,
} from '../../../ir/nodeMetadata';
import { nodeStackIsWide } from '../../../ir/edgeStyle';
import { arrayStackLayersFor } from '../../arrayStackGeometry';
import { SvgArrayStackLeads } from '../shared/SvgArrayStackLeads';
import { SvgParameterizedText, SvgParameterizedTextUnderlines } from '../shared/labels';
import {
  hasArrayConnection as sharedHasArrayConnection,
  arrayConnectionThick as sharedArrayConnectionThick,
} from '../shared/arrayConnections';

export function PortNodeSvg({
  node,
  width,
  height,
  arrayConnections,
  onNavigateToSource,
}: NodeSvgProps): React.ReactElement {
  const isArray = nodeIsArrayNode(node);
  const stackWide = isArray && nodeStackIsWide(node);
  const stackLayers = arrayStackLayersFor(stackWide);
  const arrayDim = nodeArrayDimension(node);
  const hasArrayConnection = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    sharedHasArrayConnection(arrayConnections, portId, role);
  const arrayConnectionThick = (portId: string | undefined, role: 'source' | 'target'): boolean =>
    sharedArrayConnectionThick(arrayConnections, portId, role);
  const port = node.ports[0];
  const direction = port?.direction ?? 'unknown';
  const isInterface = Boolean(
    (port?.typeName && port?.modportName !== undefined) ||
    port?.typeName?.endsWith('_if') ||
    port?.typeName?.endsWith('if'),
  );
  const skinDirection: 'input' | 'output' | 'inout' | 'harness' = isInterface
    ? 'harness'
    : direction === 'input' || direction === 'output' || direction === 'inout'
      ? direction
      : 'input';
  const inoutBodyStyle: React.CSSProperties | undefined =
    skinDirection === 'inout'
      ? {
          fill:
            'var(--svsch-inout-port-fill, color-mix(in srgb, var(--vscode-charts-green) 22%, ' +
            'var(--vscode-editor-background)))',
          stroke: 'var(--svsch-inout-port-stroke, var(--vscode-charts-green))',
          strokeLinejoin: 'round',
          strokeWidth: 1.5,
        }
      : undefined;

  const d = portSkinPath(
    skinDirection,
    width,
    height,
    diagramSizing.portSkinHeight,
    diagramSizing.portNoseLength,
  );

  // A target-role lead always exits the boundary node's left side (driven in, whether
  // it's a plain output port or the driven side of an inout); a source-role lead
  // always exits the right side (feeds outward, whether plain input or the read
  // side of an inout).
  const targetLeadSide = 'left';
  const sourceLeadSide = 'right';
  const portWidth = normalizeWidth(port?.widthExpression ?? port?.width);
  const displayWidth = portWidth && portWidth !== 'interface' ? portWidth : undefined;
  const typeName = nodeTypeName(node) ?? port?.typeName;
  const typeSource = nodeTypeSource(node) ?? port?.typeSource;
  const modportName = nodeModportName(node) ?? port?.modportName;
  const modportSource = nodeModportSource(node) ?? port?.modportSource;
  const widthSuffix = !typeName ? displayWidth : undefined;
  const labelFontSize = 12;
  const typeFontSize = labelFontSize * 0.9;
  const widthSuffixFontSize = typeFontSize;
  const monoTextWidth = (text: string, fontSize: number) => text.length * fontSize * 0.62;
  const linkTextWidth = (text: string, fontSize: number) => text.length * fontSize * 0.55;
  const typeText = typeName ?? '';
  const modportText = modportName ? `.${modportName}` : '';
  const labelGap = typeName
    ? monoTextWidth(' ', labelFontSize)
    : widthSuffix
      ? monoTextWidth(' ', widthSuffixFontSize)
      : 0;
  const labelWidth =
    monoTextWidth(node.label, labelFontSize) +
    labelGap +
    (typeName
      ? monoTextWidth(typeText, typeFontSize) + monoTextWidth(modportText, typeFontSize)
      : widthSuffix
        ? monoTextWidth(widthSuffix, widthSuffixFontSize)
        : 0);
  const labelStartX = width / 2 - labelWidth / 2;
  const typeStartX = labelStartX + monoTextWidth(node.label, labelFontSize) + labelGap;
  const typeWidth = monoTextWidth(typeText, typeFontSize);
  const typeUnderlineWidth = linkTextWidth(typeText, typeFontSize);
  const modportStartX = typeStartX + typeWidth;
  const modportUnderlineWidth = linkTextWidth(modportText, typeFontSize);
  const underlineY = height / 2 + typeFontSize * 0.62;
  const labelShiftX = isArray ? stackLayers.front.dx : 0;
  const labelShiftY = isArray ? stackLayers.front.dy : 0;
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
          className={
            'port-skin-body port-skin-array-layer port-skin-array-back ' + 'svsch-array-layer-back'
          }
          transform={`translate(${stackLayers.back.dx}, ${stackLayers.back.dy})`}
          d={d}
          opacity={0.5}
          style={inoutBodyStyle}
        />
      )}
      {/* Main body (also serves as middle array layer) */}
      <path
        className={`port-skin-body${isArray ? ' port-skin-array-middle' : ''} svsch-array-layer-middle`}
        d={d}
        style={inoutBodyStyle}
      />
      {/* Array front layer */}
      {isArray && (
        <path
          className={
            'port-skin-body port-skin-array-layer port-skin-array-front ' +
            'svsch-array-layer-front'
          }
          transform={`translate(${stackLayers.front.dx}, ${stackLayers.front.dy})`}
          d={d}
          style={inoutBodyStyle}
        />
      )}
      {!isArray && <path className="port-skin-selection" d={d} />}
      {/* Keep IO/interface port labels full in SVG; collapsed designators belong to internal
          block ports. */}
      <text
        className="svsch-port-label svsch-port-node-label"
        x={width / 2 + labelShiftX}
        y={height / 2 + labelShiftY}
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
          <tspan className="svsch-port-width-suffix">
            {' '}
            <SvgParameterizedText
              text={widthSuffix}
              refs={port?.parameterRefs}
              onNavigateToSource={onNavigateToSource}
            />
          </tspan>
        ) : null}
        {isArray && <tspan className="svsch-svg-array-index"> [0]</tspan>}
      </text>
      {typeName && typeSource && (
        <line
          className="svsch-svg-link-underline svsch-port-type-link-underline"
          x1={typeStartX + labelShiftX}
          x2={typeStartX + labelShiftX + typeUnderlineWidth}
          y1={underlineY + labelShiftY}
          y2={underlineY + labelShiftY}
        />
      )}
      {typeName && modportName && modportSource && (
        <line
          className="svsch-svg-link-underline svsch-port-type-link-underline"
          x1={modportStartX + labelShiftX}
          x2={modportStartX + labelShiftX + modportUnderlineWidth}
          y1={underlineY + labelShiftY}
          y2={underlineY + labelShiftY}
        />
      )}
      {widthSuffix && (
        <SvgParameterizedTextUnderlines
          text={widthSuffix}
          refs={port?.parameterRefs}
          x={typeStartX + labelShiftX}
          y={height / 2 + labelShiftY}
          fontSize={widthSuffixFontSize}
          textWidth={(part) => monoTextWidth(part, widthSuffixFontSize)}
          className="svsch-port-type-link-underline"
        />
      )}
      {isArray && arrayDim && (
        <text className="svsch-node-kind svsch-array-badge" x={width + 3} y={-4} textAnchor="start">
          {arrayDim}
        </text>
      )}

      {/* Array stack leads */}
      {isArray &&
        (skinDirection === 'output' || skinDirection === 'inout') &&
        port &&
        hasArrayConnection(port.id, 'target') && (
          <SvgArrayStackLeads
            wide={stackWide}
            thick={arrayConnectionThick(port.id, 'target')}
            side={targetLeadSide}
            width={width}
            y={diagramSizing.portHeight / 2}
            trimSink
          />
        )}
      {isArray && skinDirection !== 'output' && port && hasArrayConnection(port.id, 'source') && (
        <SvgArrayStackLeads
          wide={stackWide}
          thick={arrayConnectionThick(port.id, 'source')}
          side={sourceLeadSide}
          width={width}
          y={diagramSizing.portHeight / 2}
        />
      )}
    </g>
  );
}
