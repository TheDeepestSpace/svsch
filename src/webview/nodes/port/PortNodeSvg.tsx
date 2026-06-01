import React from 'react';
import type { NodeSvgProps } from '../shared/NodeSvgProps';
import { portSkinPath } from '../../../diagram/interfaceGeometry';
import { diagramSizing } from '../../../diagram/constants';

export function PortNodeSvg({ node, width, height }: NodeSvgProps): React.ReactElement {
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

  return (
    <>
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
    </>
  );
}
