import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import { portSkinPath } from '../../../diagram/interfaceGeometry';
import { diagramSizing, normalizeWidth } from '../../../diagram/constants';
import { nodeIsArrayNode } from '../../../ir/nodeMetadata';
import { ARRAY_STACK_LAYERS } from '../../arrayStackGeometry';
import { SvgArrayStackLeads } from '../shared/SvgArrayStackLeads';

export function PortNodeSvg({ node, width, height, arrayConnections }: NodeSvgProps): React.ReactElement {
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
  const displayLabel = portWidth ? `${node.label} ${portWidth}` : node.label;

  return (
    // Wrap in <g> with direction class so existing CSS rules
    // (.port-skin-input .port-skin-body) apply via descendant selector
    <g className={`port-skin port-skin-${skinDirection}`}>
      {/* Array back layer */}
      {isArray && (
        <path
          className={`port-skin-body port-skin-array-layer port-skin-array-back svsch-array-layer-back`}
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
          className={`port-skin-body port-skin-array-layer port-skin-array-front svsch-array-layer-front`}
          transform={`translate(${ARRAY_STACK_LAYERS.front.dx}, ${ARRAY_STACK_LAYERS.front.dy})`}
          d={d}
        />
      )}
      <path className="port-skin-selection" d={d} />
      <text
        className="svsch-node-title"
        x={width / 2}
        y={height / 2}
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {displayLabel}
      </text>

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
