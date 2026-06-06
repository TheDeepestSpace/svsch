import React from 'react';
import { diagramSizing } from '../../../diagram/constants';
import { portSkinPath, interfaceSkinPath } from '../../../diagram/interfaceGeometry';
import { ARRAY_STACK_LAYERS, ARRAY_STACK_SKIN_LAYERS } from '../../arrayStackGeometry';

export function muxSkinPath(width: number, height: number): string {
  const rightSideHeight = Math.min(height, diagramSizing.muxRightSideHeight);
  const rightTop = (height - rightSideHeight) / 2;
  const rightBottom = rightTop + rightSideHeight;
  return `M 0 0 L ${width} ${rightTop} V ${rightBottom} L 0 ${height} Z`;
}

export function InputPortSkin({ title, width, isArray = false }: { title: React.ReactNode; width: number; isArray?: boolean }): React.ReactElement {
  return <PortSkin title={title} direction="input" width={width} isArray={isArray} />;
}

export function OutputPortSkin({ title, width, isArray = false }: { title: React.ReactNode; width: number; isArray?: boolean }): React.ReactElement {
  return <PortSkin title={title} direction="output" width={width} isArray={isArray} />;
}

export function PortSkin({ title, direction, width, isArray = false }: { title: React.ReactNode; direction: 'input' | 'output' | 'harness'; width: number; isArray?: boolean }): React.ReactElement {
  const height = diagramSizing.portHeight;
  const skinHeight = diagramSizing.portSkinHeight;
  const noseLength = diagramSizing.portNoseLength;
  const path = portSkinPath(direction, width, height, skinHeight, noseLength);

  return (
    <>
      <svg
        className={`port-skin port-skin-${direction}`}
        viewBox={`0 0 ${width} ${height}`}
        style={{ overflow: 'visible' }}
        aria-hidden="true"
        focusable="false"
      >
        {isArray && (
          <>
            <path className="port-skin-array-layer port-skin-array-back" d={path} />
          </>
        )}
        <path className={`port-skin-body${isArray ? ' port-skin-array-middle' : ''}`} d={path} />
        {isArray && <path className="port-skin-array-layer port-skin-array-front" d={path} />}
        {isArray ? (
          <path className="hdl-node-array-selection" d={arrayStackSelectionPath(direction, width, height)} />
        ) : (
          <path className="port-skin-selection" d={path} />
        )}
      </svg>
      <div className="port-skin-label">{title}</div>
    </>
  );
}

export function HarnessSkin({ title, width, isArray = false }: { title: React.ReactNode; width: number; isArray?: boolean }): React.ReactElement {
  return <PortSkin title={title} direction="harness" width={width} isArray={isArray} />;
}

export function InterfaceSkin({
  width,
  height,
  leftCenters = [],
  rightCenters = [],
  topPortCount = 0,
  bottomPortCount = 0,
  shiftY = 0
}: {
  width: number;
  height: number;
  leftCenters?: number[];
  rightCenters?: number[];
  topPortCount?: number;
  bottomPortCount?: number;
  shiftY?: number;
}): React.ReactElement {
  const { path } = interfaceSkinPath({
    width,
    height,
    leftCenters,
    rightCenters,
    topPortCount,
    bottomPortCount,
    shiftY
  });

  return (
    <svg
      className={`hdl-interface-skin${topPortCount > 0 ? ' hdl-interface-skin-with-tophat' : ''}${bottomPortCount > 0 ? ' hdl-interface-skin-with-bottomhat' : ''}`}
      viewBox={`0 0 ${width} ${height}`}
      style={{ overflow: 'visible' }}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path className="hdl-interface-skin-body" d={path} />
      <path className="hdl-interface-skin-selection" d={path} />
    </svg>
  );
}

export function MuxSkin({ width, height, showSelection = true }: { width: number; height: number; showSelection?: boolean }): React.ReactElement {
  const path = muxSkinPath(width, height);

  return (
    <svg
      className="node-skin mux-skin"
      viewBox={`0 0 ${width} ${height}`}
      style={{ overflow: 'visible' }}
      aria-hidden="true"
      focusable="false"
    >
      <path className="node-skin-body" d={path} />
      {showSelection && <path className="node-skin-selection" d={path} />}
    </svg>
  );
}

export function MuxArrayLayers({ width, height }: { width: number; height: number }): React.ReactElement {
  const path = muxSkinPath(width, height);

  return (
    <>
      {ARRAY_STACK_SKIN_LAYERS.map((layer) => (
        <svg
          key={layer.id}
          className={`hdl-node-array-layer hdl-node-array-${layer.id} mux-array-layer mux-skin`}
          viewBox={`0 0 ${width} ${height}`}
          style={{ overflow: 'visible' }}
          aria-hidden="true"
          focusable="false"
        >
          <path className="node-skin-body" d={path} />
        </svg>
      ))}
    </>
  );
}

export function arrayStackSelectionPath(kind: 'rect' | 'mux' | 'input' | 'output' | 'harness', width: number, height: number): string {
  const front = ARRAY_STACK_LAYERS.front;
  const back = ARRAY_STACK_LAYERS.back;

  if (kind === 'mux') {
    const rightSideHeight = Math.min(height, diagramSizing.muxRightSideHeight);
    const rightTop = (height - rightSideHeight) / 2;
    const rightBottom = rightTop + rightSideHeight;
    return [
      `M ${front.dx} ${front.dy}`,
      `L ${width + front.dx} ${rightTop + front.dy}`,
      `L ${width + back.dx} ${rightTop + back.dy}`,
      `V ${rightBottom + back.dy}`,
      `L ${back.dx} ${height + back.dy}`,
      `L ${front.dx} ${height + front.dy}`,
      'Z'
    ].join(' ');
  }

  if (kind === 'input' || kind === 'output' || kind === 'harness') {
    const skinHeight = diagramSizing.portSkinHeight;
    const noseLength = diagramSizing.portNoseLength;
    const top = (height - skinHeight) / 2;
    const midY = height / 2;
    const bottom = top + skinHeight;

    if (kind === 'input') {
      return [
        `M ${front.dx} ${top + front.dy}`,
        `H ${width - noseLength + front.dx}`,
        `L ${width + back.dx} ${midY + back.dy}`,
        `L ${width - noseLength + back.dx} ${bottom + back.dy}`,
        `H ${back.dx}`,
        `L ${front.dx} ${bottom + front.dy}`,
        'Z'
      ].join(' ');
    }

    if (kind === 'output') {
      return [
        `M ${front.dx} ${midY + front.dy}`,
        `L ${noseLength + front.dx} ${top + front.dy}`,
        `H ${width + front.dx}`,
        `L ${width + back.dx} ${top + back.dy}`,
        `V ${bottom + back.dy}`,
        `H ${noseLength + back.dx}`,
        `L ${front.dx} ${midY + front.dy}`,
        'Z'
      ].join(' ');
    }

    if (kind === 'harness') {
      return [
        `M ${front.dx} ${midY + front.dy}`,
        `L ${noseLength + front.dx} ${top + front.dy}`,
        `H ${width - noseLength + front.dx}`,
        `L ${width + back.dx} ${midY + back.dy}`,
        `L ${width - noseLength + back.dx} ${bottom + back.dy}`,
        `H ${noseLength + back.dx}`,
        `L ${front.dx} ${midY + front.dy}`,
        'Z'
      ].join(' ');
    }
  }

  return [
    `M ${front.dx} ${front.dy}`,
    `H ${width + front.dx}`,
    `L ${width + back.dx} ${back.dy}`,
    `V ${height + back.dy}`,
    `H ${back.dx}`,
    `L ${front.dx} ${height + front.dy}`,
    'Z'
  ].join(' ');
}

export function ArrayStackSelection({ kind, width, height }: { kind: 'rect' | 'mux' | 'input' | 'output' | 'harness'; width: number; height: number }): React.ReactElement {
  return (
    <svg
      className="hdl-node-array-selection-skin"
      viewBox={`0 0 ${width} ${height}`}
      style={{ overflow: 'visible' }}
      aria-hidden="true"
      focusable="false"
    >
      <path className="hdl-node-array-selection" d={arrayStackSelectionPath(kind, width, height)} />
    </svg>
  );
}

export function SelectSkin({ width, height }: { width: number; height: number }): React.ReactElement {
  const rightSideHeight = Math.min(height, diagramSizing.muxRightSideHeight);
  const rightTop = (height - rightSideHeight) / 2;
  const rightBottom = rightTop + rightSideHeight;
  const path = `M 0 0 L ${width} ${rightTop} V ${rightBottom} L 0 ${height} Z`;

  return (
    <svg
      className="node-skin select-skin"
      viewBox={`0 0 ${width} ${height}`}
      style={{ overflow: 'visible' }}
      aria-hidden="true"
      focusable="false"
    >
      <path className="node-skin-body" d={path} />
      <path className="node-skin-selection" d={path} />
    </svg>
  );
}

export function AluSkin({ width, height }: { width: number; height: number }): React.ReactElement {
  const rightSideHeight = Math.min(height, diagramSizing.muxRightSideHeight);
  const rightTop = (height - rightSideHeight) / 2;
  const rightBottom = rightTop + rightSideHeight;
  const notchX = width / 4;
  const midY = height / 2;

  const slope = rightTop / width;
  const deltaY = slope * notchX;
  const notchTopY = midY - deltaY;
  const notchBottomY = midY + deltaY;

  const path = [
    `M 0 0`,
    `L ${width} ${rightTop}`,
    `V ${rightBottom}`,
    `L 0 ${height}`,
    `V ${notchBottomY}`,
    `L ${notchX} ${midY}`,
    `L 0 ${notchTopY}`,
    `Z`
  ].join(' ');

  return (
    <svg
      className="node-skin alu-skin"
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      focusable="false"
    >
      <path className="node-skin-body" d={path} />
      <path className="node-skin-selection" d={path} />
    </svg>
  );
}

export function InverterSkin({ width, height }: { width: number; height: number }): React.ReactElement {
  const side = diagramSizing.gridSize;
  const bubbleRadius = Math.min(diagramSizing.gridSize / 4, side / 6);
  const bubbleGap = 2;
  const bodyRight = side * Math.sqrt(3) / 2;
  const midY = height / 2;
  const triTop = midY - side / 2;
  const triBottom = midY + side / 2;
  const path = `M 0 ${triTop} L ${bodyRight} ${midY} L 0 ${triBottom} Z`;
  const bubbleCx = bodyRight + bubbleGap + bubbleRadius;

  return (
    <svg
      className="node-skin inverter-skin"
      viewBox={`0 0 ${width} ${height}`}
      style={{ overflow: 'visible' }}
      aria-hidden="true"
      focusable="false"
    >
      <path className="node-skin-body" d={path} />
      <circle className="node-skin-body inverter-bubble" cx={bubbleCx} cy={midY} r={bubbleRadius} />
      <path className="node-skin-selection" d={path} />
      <circle className="node-skin-selection inverter-bubble-selection" cx={bubbleCx} cy={midY} r={bubbleRadius} />
    </svg>
  );
}
