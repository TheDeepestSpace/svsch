import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import { portSkinPath } from '../../../diagram/interfaceGeometry';
import { diagramSizing } from '../../../diagram/constants';
import { nodeIsArrayNode } from '../../../ir/nodeMetadata';
import { ARRAY_STACK_SKIN_LAYERS } from '../../arrayStackGeometry';
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

  return (
    <>
      {isArray && ARRAY_STACK_SKIN_LAYERS.map(layer => (
        <path
          key={layer.id}
          className={`svsch-node-shape svsch-array-layer-${layer.id}`}
          transform={`translate(${layer.dx}, ${layer.dy})`}
          d={d}
          opacity={layer.id === 'back' ? 0.5 : layer.id === 'middle' ? 0.75 : 1}
        />
      ))}
      <path
        className={`svsch-node-shape port-skin-body port-skin-${skinDirection}`}
        d={d}
      />
      <text
        className="svsch-node-title"
        x={width / 2}
        y={height / 2}
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {node.label}
      </text>

      {/* Array stack leads */}
      {isArray && skinDirection === 'output' && port && hasArrayConnection(port.id, 'target') && (
        <SvgArrayStackLeads
          side={leadSide}
          width={width}
          y={diagramSizing.portHeight / 2}
          trimSink
        />
      )}
      {isArray && skinDirection !== 'output' && port && hasArrayConnection(port.id, 'source') && (
        <SvgArrayStackLeads
          side={leadSide}
          width={width}
          y={diagramSizing.portHeight / 2}
        />
      )}
    </>
  );
}
