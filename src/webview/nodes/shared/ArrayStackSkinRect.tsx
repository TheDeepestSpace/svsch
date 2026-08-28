import React from 'react';
import type { ArrayStackLayer } from '../../arrayStackGeometry';

interface ArrayStackSkinRectProps {
  isArray: boolean;
  skinLayers: ArrayStackLayer[];
  shapeTransform?: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  /** Extra shape class beyond "svsch-node-shape", e.g. "svsch-literal-shape". */
  className?: string;
}

/**
 * Back/middle array-stack layers plus the front/main shape rect, shared by
 * every rect-bodied node skin (register, latch, instance, comb, loop,
 * replicate, literal). Kept as one component so the z-order and per-layer
 * opacity/class rules can't drift between kinds the way copy-pasted JSX did.
 */
export function ArrayStackSkinRect({
  isArray,
  skinLayers,
  shapeTransform,
  width,
  height,
  x,
  y,
  className,
}: ArrayStackSkinRectProps): React.ReactElement {
  const baseClass = className ? `svsch-node-shape ${className}` : 'svsch-node-shape';

  return (
    <>
      {isArray &&
        skinLayers
          .filter((layer) => layer.id !== 'front')
          .map((layer) => (
            <rect
              key={layer.id}
              className={`${baseClass} hdl-node-array-layer hdl-node-array-${layer.id} svsch-array-layer-${layer.id}`}
              transform={`translate(${layer.dx}, ${layer.dy})`}
              x={x}
              y={y}
              width={width}
              height={height}
              opacity={layer.id === 'back' ? 0.5 : layer.id === 'middle' ? 0.75 : 1}
            />
          ))}
      <rect
        className={`${baseClass}${isArray ? ' hdl-node-array-layer hdl-node-array-front svsch-array-layer-front' : ''}`}
        transform={shapeTransform}
        x={x}
        y={y}
        width={width}
        height={height}
      />
    </>
  );
}
