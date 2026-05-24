import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
  type MiniMapNodeProps,
  useReactFlow,
  useEdgesState,
  useNodesState,
  useNodes
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { diagramSizing, normalizeWidth } from '../diagram/constants';
import { diagramNodeDimensions, instanceParameterRows } from '../diagram/nodeSizing';
import { selectPortLabel } from '../diagram/selectLabels';
import {
  distributedInterfaceSideCenters,
  interfaceSkinPath,
  interfaceTopHatBounds,
  interfaceTopHatHeight,
  interfaceTopHatTop,
  interfaceTopPortX,
  orderedInterfaceSidePorts,
  portSkinPath
} from '../diagram/interfaceGeometry';
import { OrthogonalEdge, type OrthogonalPoint, type RouteChange } from './orthogonal';
import { LineJumpProvider } from './react-flow-line-jumps';
import { ARRAY_STACK_LAYERS, ARRAY_STACK_LEAD_EDGE_GAP, ARRAY_STACK_LEAD_LAYERS, ARRAY_STACK_SKIN_LAYERS, arrayStackLayerTrim } from './arrayStackGeometry';
import type { 
  DiagramNodeKind, 
  DiagramNode, 
  PositionedNode, 
  DiagramViewModel, 
  DiagramPort,
  DiagramEdge,
  InstanceParameter,
  ParameterDecl,
  ParameterRef
} from '../ir/types';
import {
  nodeOperation,
  nodeModportName,
  nodeModportSource,
  nodeTypeName,
  nodeTypeSource,
  nodeWidth as metadataNodeWidth,
  registerClockSignal,
  registerResetActiveLow,
  registerResetSignal,
  nodeArrayDimension,
  nodeIsArrayNode,
  repeatExpression,
  repeatExpressionSource,
  structFields,
  structRole
} from '../ir/nodeMetadata';

interface HdlNodeData {
  [key: string]: unknown;
  node: PositionedNode;
  arrayConnections?: ArrayStackConnection[];
}

type HdlFlowNode = Node<HdlNodeData>;

const EDGE_Z_INDEX = 1;
const ARRAY_NODE_Z_INDEX = 2;
const BLOCK_NODE_Z_INDEX = 2;

interface ArrayStackConnection {
  portId?: string;
  role: 'source' | 'target';
}

interface GraphMessage {
  type: 'graph';
  view: DiagramViewModel;
  modules: string[];
}

interface StatusMessage {
  type: 'status';
  status: 'idle' | 'rebuilding';
}

function edgeNetKey(edge: DiagramEdge): string {
  if (edge.source.startsWith('literal:')) {
    return edge.source;
  }
  return `${edge.source}:${edge.sourcePort ?? ''}`;
}

import { getVscodeApi } from './vscodeApi';

const vscode = getVscodeApi();

export const InteractionContext = React.createContext<{
  hoveredNetKey?: string;
  setHovered: (netKey?: string) => void;
}>({ setHovered: () => {} });

function InputPortSkin({ title, width, isArray = false }: { title: React.ReactNode; width: number; isArray?: boolean }): React.ReactElement {
  return <PortSkin title={title} direction="input" width={width} isArray={isArray} />;
}

function OutputPortSkin({ title, width, isArray = false }: { title: React.ReactNode; width: number; isArray?: boolean }): React.ReactElement {
  return <PortSkin title={title} direction="output" width={width} isArray={isArray} />;
}

function PortSkin({ title, direction, width, isArray = false }: { title: React.ReactNode; direction: 'input' | 'output' | 'harness'; width: number; isArray?: boolean }): React.ReactElement {
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

function HarnessSkin({ title, width, isArray = false }: { title: React.ReactNode; width: number; isArray?: boolean }): React.ReactElement {
  return <PortSkin title={title} direction="harness" width={width} isArray={isArray} />;
}

function InterfaceSkin({
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

function muxSkinPath(width: number, height: number): string {
  const rightSideHeight = Math.min(height, diagramSizing.muxRightSideHeight);
  const rightTop = (height - rightSideHeight) / 2;
  const rightBottom = rightTop + rightSideHeight;
  return `M 0 0 L ${width} ${rightTop} V ${rightBottom} L 0 ${height} Z`;
}

function MuxSkin({ width, height, showSelection = true }: { width: number; height: number; showSelection?: boolean }): React.ReactElement {
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

function MuxArrayLayers({ width, height }: { width: number; height: number }): React.ReactElement {
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

function arrayStackSelectionPath(kind: 'rect' | 'mux' | 'input' | 'output' | 'harness', width: number, height: number): string {
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

function ArrayStackSelection({ kind, width, height }: { kind: 'rect' | 'mux' | 'input' | 'output' | 'harness'; width: number; height: number }): React.ReactElement {
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

function SelectSkin({ width, height }: { width: number; height: number }): React.ReactElement {
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

function AluSkin({ width, height }: { width: number; height: number }): React.ReactElement {
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

function muxInputPortCenterY(index: number, count: number, height: number): number {
  const grid = diagramSizing.gridSize;
  const heightUnits = Math.max(1, Math.round(height / grid));
  const startUnit = Math.max(1, Math.ceil((heightUnits - count + 1) / 2));
  return grid * (startUnit + index);
}

function muxTopPortSkinEdgeY(index: number, count: number, height: number): number {
  const xFraction = (index + 1) / (count + 1);
  const rightSideHeight = Math.min(height, diagramSizing.muxRightSideHeight);
  const rightTop = (height - rightSideHeight) / 2;
  return rightTop * xFraction;
}

function muxTopPortLabelOffsetY(index: number, count: number, height: number): number {
  return Math.max(0, muxTopPortSkinEdgeY(index, count, height) - diagramSizing.gridSize) + 8;
}

function muxTopPortLeadLengthY(index: number, count: number, height: number): number {
  return Math.max(0, muxTopPortSkinEdgeY(index, count, height) - diagramSizing.gridSize);
}

function shouldLowerMuxTopPortLabel(node: DiagramNode, port: DiagramPort): boolean {
  return node.kind === 'select'
    || Boolean(normalizeWidth(port.width))
    || (node.kind === 'mux' && (node.label.startsWith('if ') || (port.connectedSignal?.length ?? 0) > 24));
}

function busTapPortCenterY(index: number, startUnits = 1): number {
  return diagramSizing.gridSize * (index * 2 + startUnits);
}

function TypeLabel({ typeName, width, source, modportName, modportSource, parameterRefs }: { typeName?: string; width?: string; source?: any; modportName?: string; modportSource?: any; parameterRefs?: ParameterRef[] }) {
  const stopDrag = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  const handleTypeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (source) {
      const msg = { type: 'navigateToSource', source };
      console.log('NAVIGATE:', JSON.stringify(msg));
      vscode.postMessage(msg);
    }
  };

  if (typeName) {
    return (
      <span
        onClick={handleTypeClick}
        onDoubleClick={stopDrag}
        onMouseDown={stopDrag}
        onPointerDown={stopDrag}
        className="svsch-type-label nodrag nopan"
        style={{
          color: 'var(--vscode-descriptionForeground)',
          fontSize: '0.9em',
          cursor: source ? 'pointer' : 'default',
          textDecoration: source ? 'underline' : 'none',
          textDecorationStyle: 'dotted',
          marginLeft: '4px',
          fontWeight: 'normal'
        }}
        title={source ? `Go to definition of ${typeName}` : undefined}
      >
        {typeName}
        {modportName && (
          <span
            onClick={(event) => {
              event.stopPropagation();
              if (modportSource) {
                const msg = { type: 'navigateToSource', source: modportSource };
                console.log('NAVIGATE:', JSON.stringify(msg));
                vscode.postMessage(msg);
              }
            }}
            className="svsch-modport-label nodrag nopan"
            style={{
              cursor: modportSource ? 'pointer' : 'default',
              textDecoration: modportSource ? 'underline' : 'none',
              textDecorationStyle: 'dotted'
            }}
            title={modportSource ? `Go to definition of ${modportName}` : undefined}
          >
            .{modportName}
          </span>
        )}
      </span>
    );
  }
  if (width) {
    return <span style={{ marginLeft: '4px', fontWeight: 'normal' }}><ParameterizedText text={width} refs={parameterRefs} /></span>;
  }
  return null;
}

function navigateToSource(source: any): void {
  if (!source) return;
  const msg = { type: 'navigateToSource', source };
  console.log('NAVIGATE:', JSON.stringify(msg));
  vscode.postMessage(msg);
}

function ParameterToken({ text, refInfo }: { text: string; refInfo?: ParameterRef }): React.ReactElement {
  const source = refInfo?.declarationSource ?? refInfo?.source;
  const stopDrag = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  if (!source) {
    return <span>{text}</span>;
  }

  return (
    <span
      className="svsch-param-token nodrag nopan"
      onClick={(event) => {
        event.stopPropagation();
        navigateToSource(source);
      }}
      onDoubleClick={stopDrag}
      onMouseDown={stopDrag}
      onPointerDown={stopDrag}
      title={`Go to definition of ${text}`}
    >
      {text}
    </span>
  );
}

function ParameterizedText({ text, refs = [] }: { text: string; refs?: ParameterRef[] }): React.ReactElement {
  if (refs.length === 0) {
    return <>{text}</>;
  }

  const byName = new Map(refs.map((ref) => [ref.name, ref]));
  const names = [...byName.keys()].sort((a, b) => b.length - a.length);
  if (names.length === 0) return <>{text}</>;

  const pattern = new RegExp(`\\b(${names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g');
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push(text.slice(lastIndex, index));
    const name = match[1];
    parts.push(<ParameterToken key={`${name}-${index}`} text={name} refInfo={byName.get(name)} />);
    lastIndex = index + name.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));

  return <>{parts}</>;
}

function ModuleParameterTable({ moduleName, parameters = [] }: { moduleName: string; parameters?: ParameterDecl[] }): React.ReactElement | null {
  const metaParameters = parameters.filter((param) => param.kind === 'parameter');
  const localparams = parameters.filter((param) => param.kind === 'localparam');
  const title = moduleParameterTableTitle(moduleName);

  const renderRows = (items: ParameterDecl[]) => items.map((param) => (
    <button
      key={`${param.kind}:${param.name}`}
      className="module-parameter-row"
      title={`${param.kind} ${param.name}${param.defaultValue ? ` = ${param.defaultValue}` : ''}`}
      onClick={() => navigateToSource(param.source)}
      disabled={!param.source}
    >
      <span className="module-parameter-name">{param.name}</span>
      <span className="module-parameter-default">{param.defaultValue ?? ''}</span>
    </button>
  ));

  return (
    <div className="module-parameter-table nodrag nopan" aria-label="Module parameters">
      <div className="module-parameter-line">
        <span>{title.label}: </span>
        <span className="module-parameter-mono">{title.name}</span>
      </div>
      {metaParameters.length > 0 && (
        <>
          <div className="module-parameter-rule" />
          <div className="module-parameter-section-title">Meta-parameters:</div>
          <div className="module-parameter-rows">{renderRows(metaParameters)}</div>
        </>
      )}
      {localparams.length > 0 && (
        <>
          <div className="module-parameter-rule" />
          <div className="module-parameter-section-title">Localparams:</div>
          <div className="module-parameter-rows">{renderRows(localparams)}</div>
        </>
      )}
    </div>
  );
}

function moduleParameterTableTitle(moduleName: string): { label: string; name: string } {
  if (moduleName.startsWith('interface ')) {
    return { label: 'Interface', name: moduleName.slice('interface '.length) };
  }
  if (moduleName.startsWith('struct ')) {
    return { label: 'Struct', name: moduleName.slice('struct '.length) };
  }
  return { label: 'Module', name: moduleName };
}

function InstanceParameterList({ parameters = [] }: { parameters?: InstanceParameter[] }): React.ReactElement | null {
  if (parameters.length === 0) return null;

  return (
    <div className="instance-parameter-list">
      {parameters.map((param) => (
        <span key={param.name} className="instance-parameter-chip" title={`${param.name} = ${param.value ?? ''}`}>
          <span className="instance-parameter-name">{param.name}</span>
          {param.value && (
            <>
              <span className="instance-parameter-equals">=</span>
              <span className="instance-parameter-value">
                <ParameterizedText text={param.value} refs={param.parameterRefs} />
              </span>
            </>
          )}
        </span>
      ))}
    </div>
  );
}

function RepeatLabel({ node }: { node: DiagramNode }) {
  const source = repeatExpressionSource(node);
  const expression = repeatExpression(node);
  const symbolicLabel = source && expression && node.label === `x ${expression}`;

  const stopDrag = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (source) {
      const msg = { type: 'navigateToSource', source };
      console.log('NAVIGATE:', JSON.stringify(msg));
      vscode.postMessage(msg);
    }
  };

  if (symbolicLabel) {
    return (
      <span className="svsch-repeat-label">
        <span>x </span>
        <span
          className="svsch-repeat-label-clickable nodrag nopan"
          onClick={handleClick}
          onMouseDown={stopDrag}
          onPointerDown={stopDrag}
        title={`Go to definition of ${expression}`}
      >
          {expression}
        </span>
      </span>
    );
  }

  return (
    <span
      className="svsch-repeat-label"
      onMouseDown={stopDrag}
      onPointerDown={stopDrag}
    >
      {node.label}
    </span>
  );
}

function PortTypeSuffix({ port }: { port: { width?: string; typeName?: string; modportName?: string } }) {
  const width = normalizeWidth(port.width);
  const isInterface = width === 'interface' || port.modportName !== undefined;
  const isStruct = !isInterface && port.typeName !== undefined;

  if (isInterface) {
    return <span className="svsch-port-type-suffix-blue">{"{}"}</span>;
  }
  if (isStruct) {
    return <span className="svsch-port-type-suffix">{"{}"}</span>;
  }
  return null;
}

function PortLabel({ port, showWidth = true, showType = true, collapseWidth = false }: { port: { name: string; label?: string; width?: string; widthExpression?: string; parameterRefs?: ParameterRef[]; typeName?: string; typeSource?: any; modportName?: string; modportSource?: any }; showWidth?: boolean; showType?: boolean; collapseWidth?: boolean }) {
  const width = normalizeWidth(port.widthExpression ?? port.width);
  const displayWidth = collapseWidth && width ? '[]' : width;
  const label = normalizeWidth(port.label ?? port.name) === undefined && (port.label ?? port.name).startsWith('[') ? '' : (port.label ?? port.name);
  
  const isInterface = width === 'interface' || port.modportName !== undefined;
  const isStruct = !isInterface && port.typeName !== undefined;
  const renderType = showType && Boolean(port.typeName);

  if (label === '' && !showWidth) {
    const rawLabel = port.label ?? port.name;
    if (rawLabel === '[0:0]') return null;
    return <span>{rawLabel}</span>;
  }

  return (
    <span>
      {label}
      <PortTypeSuffix port={port} />
      {(showWidth && !collapseWidth && !isInterface && !isStruct && (port.typeName || displayWidth)) || (!showWidth && renderType && !isInterface && !isStruct) ? ' ' : ''}
      {showWidth && !isInterface && !isStruct && (
        renderType
          ? <TypeLabel typeName={port.typeName} width={displayWidth} source={port.typeSource} modportName={port.modportName} modportSource={port.modportSource} />
          : (!port.typeName && displayWidth ? (
            collapseWidth
              ? <span className="svsch-port-type-suffix">{displayWidth}</span>
              : <span style={{ marginLeft: '4px', fontWeight: 'normal' }}><ParameterizedText text={displayWidth} refs={port.parameterRefs} /></span>
          ) : null)
      )}
      {!showWidth && renderType && !isInterface && !isStruct && (
        <TypeLabel typeName={port.typeName} source={port.typeSource} modportName={port.modportName} modportSource={port.modportSource} />
      )}
    </span>
  );
}

function structFieldAnnotation(node: DiagramNode, port: DiagramPort): React.ReactNode {
  const fields = structFields(node);
  const fieldName = (port.label ?? port.name.split('.').pop());
  const field = fields.find((candidate) => candidate.name === fieldName);

  if (field && typeof field.typeName === 'string') {
    return <TypeLabel typeName={field.typeName} />;
  }
  if (field && typeof field.bitRange === 'string') return field.bitRange;
  if (field && typeof field.width === 'string') return normalizeWidth(field.width);
  return normalizeWidth(port.width);
}

function formatNodeKind(node: DiagramNode): string {
  if (node.kind === 'alu') return 'ALU';
  if (node.kind === 'comb') return 'COMBINATIONAL';
  if (node.kind === 'replicate') return node.label;
  if (node.kind === 'bus') return 'BUS';
  if (node.kind === 'struct') return 'STRUCT';
  if (node.kind === 'interface') return nodeModportName(node) ? 'MODPORT' : 'INTERFACE';
  if (node.kind === 'loop') return 'LOOP';
  if (node.kind === 'instance' && node.instanceOf) return node.instanceOf;
  return node.kind;
}

function RegisterClockGlyph(): React.ReactElement {
  return (
    <svg className="register-clock-glyph" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M 1 1.5 L 9 6 L 1 10.5" />
    </svg>
  );
}

function ArrayStackLeads({
  side,
  width,
  y,
  x,
  trimSink = false
}: {
  side: 'left' | 'right' | 'top';
  width: number;
  y: number;
  x?: number;
  trimSink?: boolean;
}): React.ReactElement {
  return (
    <svg
      className={`svsch-array-stack-leads svsch-array-stack-leads-${trimSink ? 'target' : 'source'} svsch-array-stack-leads-${side}`}
      aria-hidden="true"
      focusable="false"
    >
      {ARRAY_STACK_LEAD_LAYERS.map((layer) => {
        const trim = arrayStackLayerTrim(layer.id);
        const shapeX = side === 'top'
          ? (x ?? width / 2) + layer.dx
          : side === 'left'
            ? layer.dx
            : width + layer.dx;
        const shapeY = y + layer.dy;
        const endY = side === 'top' && trimSink ? shapeY - ARRAY_STACK_LEAD_EDGE_GAP : shapeY;
        const sourceRightExitX = width + ARRAY_STACK_LAYERS.back.dx + ARRAY_STACK_LEAD_EDGE_GAP;
        const leadX = side === 'top'
          ? shapeX
          : side === 'left'
            ? shapeX - trim
            : trimSink
              ? shapeX + trim
              : Math.max(shapeX + trim, sourceRightExitX);
        const leadY = side === 'top' ? endY - trim : shapeY;
        return (
          <path
            key={layer.id}
            className={`svsch-array-stack-lead svsch-array-stack-lead-${layer.id} svsch-array-stack-lead-${trimSink ? 'target' : 'source'}-${side}`}
            d={`M ${leadX} ${leadY} L ${shapeX} ${endY}`}
          />
        );
      })}
    </svg>
  );
}

function HdlNode({ data }: NodeProps<HdlFlowNode>): React.ReactElement {
  const node = data.node;
  const arrayConnections = data.arrayConnections ?? [];
  const isArray = nodeIsArrayNode(node);
  const width = normalizeWidth(metadataNodeWidth(node));
  const fallbackNodeWidth = node.kind === 'port'
    ? normalizeWidth(node.ports[0]?.widthExpression ?? node.ports[0]?.width)
    : (node.kind === 'register' || node.kind === 'latch')
      ? normalizeWidth(node.ports.find((port) => port.direction === 'output')?.width)
      : node.kind === 'literal'
        ? normalizeWidth(node.ports.find((port) => port.direction === 'output')?.width)
        : undefined;
  const typeName = nodeTypeName(node)
    ?? (node.kind === 'port' ? node.ports[0]?.typeName : undefined);
  const typeSource = nodeTypeSource(node) ?? (node.kind === 'port' ? node.ports[0]?.typeSource : undefined);
  const modportName = nodeModportName(node) ?? (node.kind === 'port' ? node.ports[0]?.modportName : undefined);
  const modportSource = nodeModportSource(node) ?? (node.kind === 'port' ? node.ports[0]?.modportSource : undefined);
  const nodeRole = structRole(node);
  const instanceParameters = node.kind === 'instance' ? (node.instanceParameters ?? node.metadata?.instanceParameters ?? []) : [];
  const showTitleTypeLabel = node.kind !== 'comb'
    && node.kind !== 'bus'
    && node.kind !== 'struct'
    && (node.kind !== 'interface' || nodeRole === 'port');

  const title = (
    <div className="svsch-node-title-container">
      <span className="svsch-node-label">{node.label}</span>
      {showTitleTypeLabel && (
        <TypeLabel typeName={typeName} width={width ?? fallbackNodeWidth} source={typeSource} modportName={modportName} modportSource={modportSource} parameterRefs={node.kind === 'port' ? node.ports[0]?.parameterRefs : undefined} />
      )}
      {isArray && <span className="hdl-node-array-index">[0]</span>}
    </div>
  );

  const inputs = node.ports.filter((port: DiagramPort) => port.direction === 'input' || port.direction === 'inout' || port.direction === 'unknown');
  const outputs = node.ports.filter((port: DiagramPort) => port.direction === 'output');
  const showPortTypes = node.kind !== 'instance';
  const muxTopPorts = node.kind === 'select'
    ? inputs.filter((port: DiagramPort) => port.name === 's' || port.name === 'sel' || port.name === 'width')
    : (node.kind === 'mux'
      ? (inputs.some((port: DiagramPort) => port.name === 'sel') ? inputs.filter((port: DiagramPort) => port.name === 'sel').slice(0, 1) : inputs.slice(0, 1))
      : []);
  const muxSelectPort = muxTopPorts[0];
  const sideInputs = muxTopPorts.length > 0 ? inputs.filter((port: DiagramPort) => !muxTopPorts.some((topPort) => topPort.id === port.id)) : inputs;
  const portDirection = node.kind === 'port' ? node.ports[0]?.direction ?? 'unknown' : undefined;
  const { width: nodeWidth, height: nodeHeight } = diagramNodeDimensions(node);
  const parameterRows = instanceParameterRows(node);
  const isInterfacePortNode = node.kind === 'interface' && nodeRole === 'port';
  const nodeStyle = {
    '--svsch-node-width': `${nodeWidth}px`,
    '--svsch-node-height': `${nodeHeight}px`,
    '--svsch-instance-param-height': `${diagramSizing.gridSize * parameterRows}px`,
    '--svsch-port-width': `${node.kind === 'port' || isInterfacePortNode ? nodeWidth : diagramSizing.portWidth}px`
  } as React.CSSProperties;

  const nodeSelection = isArray
    ? <ArrayStackSelection kind="rect" width={nodeWidth} height={nodeHeight} />
    : <div className="hdl-node-selection-rect" aria-hidden="true" />;
  const hasArrayConnection = (portId: string | undefined, role: 'source' | 'target'): boolean => {
    return arrayConnections.some((connection) => connection.portId === portId && connection.role === role);
  };

  // Array stacking layers sit above the routed wires; cosmetic leads redraw the short
  // connection pieces that would otherwise disappear under the skins.
  const arrayDim = nodeArrayDimension(node);
  const arrayLayers = isArray
    ? node.kind === 'mux'
      ? <MuxArrayLayers width={nodeWidth} height={nodeHeight} />
      : (
        <>
          <div className="hdl-node-array-layer hdl-node-array-back" aria-hidden="true" />
          <div className="hdl-node-array-layer hdl-node-array-middle" aria-hidden="true" />
          <div className="hdl-node-array-layer hdl-node-array-front" aria-hidden="true" />
        </>
      )
    : null;
  const arrayBadge = isArray && arrayDim ? (
    <div className="hdl-node-array-badge" aria-hidden="true">{arrayDim}</div>
  ) : null;

  const handleDoubleClick = () => {
    let msg: any = null;
    const isInterface = node.kind === 'interface' || (node.kind === 'port' && Boolean(typeName && (modportName !== undefined || typeName.endsWith('_if') || typeName.endsWith('if'))));

    if (isInterface && typeName && nodeRole !== 'modport') {
      msg = { type: 'openModule', moduleName: `interface ${typeName}` };
    } else if (node.kind === 'instance' && node.moduleName) {
      msg = { type: 'openModule', moduleName: node.moduleName };
    } else if (node.source) {
      msg = { type: 'navigateToSource', source: node.source };
    }
    if (msg) {
      console.log('NAVIGATE:', JSON.stringify(msg));
      vscode.postMessage(msg);
    }
  };

  if (node.kind === 'port') {
    const isOutput = portDirection === 'output';
    const isInput = portDirection === 'input';
    const isInterfacePort = Boolean(node.ports[0]?.typeName && node.ports[0]?.modportName !== undefined || node.ports[0]?.typeName?.endsWith('_if') || node.ports[0]?.typeName?.endsWith('if'));
    const isSkinnedPort = isInput || isOutput || isInterfacePort;
    return (
      <button
        className={`hdl-node hdl-node-port hdl-port-${portDirection}${isSkinnedPort ? ' hdl-port-skinned' : ''}${isInterfacePort ? ' hdl-port-interface' : ''}${isArray ? ' hdl-node-array' : ''}`}
        data-node-id={node.id}
        data-node-kind={node.kind}
        style={nodeStyle}
        title={node.source ? `${node.source.file}${node.source.startLine ? `:${node.source.startLine}` : ''}` : 'port'}
        onDoubleClick={(event) => {
          if (event.target instanceof Element && event.target.closest('.bus-tap')) {
            return;
          }
          handleDoubleClick();
        }}
      >
        {isArray && !isSkinnedPort && arrayLayers}
        {!isSkinnedPort && nodeSelection}
        {arrayBadge}
        {isOutput && <Handle type="target" id={node.ports[0]?.id} position={Position.Left} />}
        {isOutput && <Handle type="source" id={node.ports[0]?.id} position={Position.Left} />}
        {isSkinnedPort && isOutput && hasArrayConnection(node.ports[0]?.id, 'target') && (
          <ArrayStackLeads
            side="left"
            width={nodeWidth}
            y={diagramSizing.portHeight / 2}
            trimSink
          />
        )}
        {isInterfacePort ? (
          <HarnessSkin title={title} width={nodeWidth} isArray={isArray} />
        ) : isInput ? (
          <InputPortSkin title={title} width={nodeWidth} isArray={isArray} />
        ) : isOutput ? (
          <OutputPortSkin title={title} width={nodeWidth} isArray={isArray} />
        ) : (
          <>
            <div className="port-direction">{portDirection}</div>
            <div className="port-title">{title}</div>
          </>
        )}
        {isSkinnedPort && !isOutput && hasArrayConnection(node.ports[0]?.id, 'source') && (
          <ArrayStackLeads
            side="right"
            width={nodeWidth}
            y={diagramSizing.portHeight / 2}
          />
        )}
        {!isOutput && <Handle type="source" id={node.ports[0]?.id} position={Position.Right} />}
      </button>
    );
  }

  if (isInterfacePortNode) {
    const port = node.ports[0];
    const handlePosition = port?.preferredSide === 'left'
      ? Position.Left
      : port?.preferredSide === 'right'
        ? Position.Right
        : port?.direction === 'output'
          ? Position.Right
          : Position.Left;

    return (
      <button
        className={`hdl-node hdl-node-port hdl-port-${port?.direction ?? 'unknown'} hdl-port-skinned hdl-port-interface hdl-interface-node`}
        data-node-id={node.id}
        data-node-kind={node.kind}
        style={nodeStyle}
        title={node.source ? `${node.source.file}${node.source.startLine ? `:${node.source.startLine}` : ''}` : 'interface port'}
        onDoubleClick={(event) => {
          if (event.target instanceof Element && event.target.closest('.bus-tap')) {
            return;
          }
          handleDoubleClick();
        }}
      >
        <Handle type="target" id={port?.id} position={handlePosition} />
        <Handle type="source" id={port?.id} position={handlePosition} />
        <HarnessSkin title={title} width={nodeWidth} />
      </button>
    );
  }

  if (node.kind === 'bus' || node.kind === 'struct' || node.kind === 'interface') {
    const role = nodeRole;
    const isInterface = node.kind === 'interface';
    const isInterfaceModport = isInterface && role === 'modport';
    const isModuleInterfaceModport = isInterfaceModport && node.label !== typeName;
    const isInterfaceInstance = isInterface && role !== 'modport' && role !== 'port' && !node.id.startsWith('interface_type:');
    const interfaceBundlePorts = isInterfaceModport ? node.ports.filter((port) => port.width === 'interface') : [];
    const aggregatePorts = isInterface ? node.ports.filter((port) => port.width !== 'interface' || port.preferredSide) : node.ports;

    const topPorts = isInterfaceInstance ? aggregatePorts.filter(p => p.direction === 'input' && p.width !== 'interface') : [];
    const bottomPorts = isInterfaceInstance ? aggregatePorts.filter(p => p.direction === 'output' && p.width !== 'interface') : [];
    const sidePorts = isInterfaceInstance
      ? aggregatePorts.filter(p => p.width === 'interface' || (p.direction !== 'input' && p.direction !== 'output'))
      : aggregatePorts;
    const orderedSidePorts = orderedInterfaceSidePorts(sidePorts);
    const leftSidePorts = isInterfaceInstance ? orderedSidePorts.left : [];
    const rightSidePorts = isInterfaceInstance ? orderedSidePorts.right : [];
    const capPortCount = Math.max(topPorts.length, bottomPorts.length);
    const topHatHeight = isInterfaceInstance ? interfaceTopHatHeight(topPorts.length > 0) : 0;
    const bottomHatHeight = isInterfaceInstance ? interfaceTopHatHeight(bottomPorts.length > 0) : 0;
    const shiftY = isInterfaceInstance ? diagramSizing.gridSize * 3 + diagramSizing.gridSize / 2 : 0;
    const unshiftedHeight = Math.max(diagramSizing.gridSize, nodeHeight - shiftY);
    const leftInterfaceCenters = distributedInterfaceSideCenters(leftSidePorts.length, unshiftedHeight, topHatHeight, bottomHatHeight).map(c => c + shiftY);
    const rightInterfaceCenters = distributedInterfaceSideCenters(rightSidePorts.length, unshiftedHeight, topHatHeight, bottomHatHeight).map(c => c + shiftY);
    const interfaceTopHatY = interfaceTopHatTop([...leftInterfaceCenters, ...rightInterfaceCenters], topHatHeight);
    const interfaceTapCenterById = new Map<string, number>();
    leftSidePorts.forEach((port, index) => interfaceTapCenterById.set(port.id, leftInterfaceCenters[index]));
    rightSidePorts.forEach((port, index) => interfaceTapCenterById.set(port.id, rightInterfaceCenters[index]));

    const aggregateInputs = sidePorts.filter((port: DiagramPort) => port.direction === 'input' || port.direction === 'inout' || port.direction === 'unknown');
    const aggregateOutputs = sidePorts.filter((port: DiagramPort) => port.direction === 'output');

    const isComposition = node.kind === 'struct'
      ? role === 'composition'
      : node.kind === 'interface'
        ? false
        : aggregateInputs.length > 1;

    const taps = isInterfaceModport ? [...sidePorts] : isInterfaceInstance ? [...leftSidePorts, ...rightSidePorts] : isInterface ? [...aggregateInputs, ...aggregateOutputs] : isComposition ? aggregateInputs : aggregateOutputs;
    const singlePort = isComposition ? aggregateOutputs[0] : aggregateInputs[0];

    const tapCenters = taps.map((_: DiagramPort, index: number) => (
      isInterfaceInstance
        ? interfaceTapCenterById.get(taps[index].id) ?? nodeHeight / 2
        : busTapPortCenterY(index, isInterfaceModport ? 2 : 1)
    ));
    const firstTapCenter = tapCenters[0] ?? nodeHeight / 2;
    const lastTapCenter = tapCenters[tapCenters.length - 1] ?? nodeHeight / 2;
    const interfaceTitleCenters = [...leftInterfaceCenters, ...rightInterfaceCenters];
    const interfaceTitleY = interfaceTitleCenters.length > 0
      ? (Math.min(...interfaceTitleCenters) + Math.max(...interfaceTitleCenters)) / 2
      : nodeHeight / 2;
    const busStyle = {
      ...nodeStyle,
      '--svsch-bus-single-y': `${firstTapCenter}px`
    } as React.CSSProperties;
    const navigatePortSource = (event: React.MouseEvent, port: DiagramPort) => {
      if (port.source) {
        event.stopPropagation();
        const msg = { type: 'navigateToSource', source: port.source };
        console.log('NAVIGATE:', JSON.stringify(msg));
        vscode.postMessage(msg);
      }
    };
    const navigateTapFromEvent = (event: React.MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const tap = event.target.closest('.bus-tap') as HTMLElement | null;
      const portId = tap?.dataset.portId;
      const port = portId ? taps.find((candidate) => candidate.id === portId) : undefined;
      if (port?.source) {
        event.stopPropagation();
        const msg = { type: 'navigateToSource', source: port.source };
        console.log('NAVIGATE:', JSON.stringify(msg));
        vscode.postMessage(msg);
      }
    };

    return (
      <button
        className={`hdl-bus-node ${node.kind === 'struct' ? 'hdl-struct-node' : ''} ${isInterface ? 'hdl-interface-node' : ''} ${isInterfaceModport ? 'hdl-interface-modport' : ''} ${isInterfaceInstance ? 'hdl-interface-instance' : ''} ${isComposition ? 'hdl-bus-composition' : 'hdl-bus-breakout'}`}
        data-node-id={node.id}
        data-node-kind={node.kind}
        style={busStyle}
        title={node.source ? `${node.source.file}${node.source.startLine ? `:${node.source.startLine}` : ''}` : node.kind}
        onClickCapture={navigateTapFromEvent}
        onDoubleClickCapture={navigateTapFromEvent}
        onDoubleClick={(event) => {
          if (event.target instanceof Element && event.target.closest('.bus-tap')) {
            return;
          }
          handleDoubleClick();
        }}
      >
        {isInterfaceInstance ? <InterfaceSkin width={nodeWidth} height={nodeHeight} leftCenters={leftInterfaceCenters} rightCenters={rightInterfaceCenters} topPortCount={topPorts.length} bottomPortCount={bottomPorts.length} /> : nodeSelection}
        {!isInterfaceModport && !isInterfaceInstance && isComposition && singlePort ? (
          <Handle type="source" id={singlePort?.id} position={Position.Right} />
        ) : !isInterfaceModport && !isInterfaceInstance && singlePort ? (
          <Handle type="target" id={singlePort?.id} position={Position.Left} />
        ) : null}
        {isInterfaceInstance && (
          <div className="interface-instance-title" style={{ top: `${interfaceTitleY}px` }}>
            <span
              className="interface-instance-title-button nodrag nopan"
            >
              {node.label}
              <TypeLabel typeName={typeName} source={typeSource} />
            </span>
          </div>
        )}
        {isInterfaceModport && !isModuleInterfaceModport && (
          <div className="interface-modport-title">
            <span
              role="button"
              tabIndex={0}
              className="interface-modport-title-button nodrag nopan"
              onClick={(event) => {
                event.stopPropagation();
                if (modportSource) {
                  const msg = { type: 'navigateToSource', source: modportSource };
                  console.log('NAVIGATE:', JSON.stringify(msg));
                  vscode.postMessage(msg);
                }
              }}
              onDoubleClick={(event) => event.stopPropagation()}
              aria-disabled={!modportSource}
            >
              {node.id.startsWith('interface_modport:')
                ? modportName ?? node.label
                : (
                  <>
                    {node.label}
                    <TypeLabel typeName={typeName} source={typeSource} modportName={modportName} modportSource={modportSource} />
                  </>
                )}
            </span>
          </div>
        )}
        {topPorts.map((port, index) => (
          <div key={port.id} className="interface-top-port" style={{ left: `${interfaceTopPortX(nodeWidth, topPorts.length, index, capPortCount)}px`, top: `${interfaceTopHatY}px` }}>
            <Handle type="target" id={port.id} position={Position.Top} />
            <Handle type="source" id={port.id} position={Position.Top} />
            <span className="interface-port-label">{port.label ?? port.name}</span>
          </div>
        ))}
        {bottomPorts.map((port, index) => (
          <div key={port.id} className="interface-bottom-port" style={{ left: `${interfaceTopPortX(nodeWidth, bottomPorts.length, index, capPortCount)}px`, top: `${nodeHeight}px` }}>
            <Handle type="target" id={port.id} position={Position.Bottom} />
            <Handle type="source" id={port.id} position={Position.Bottom} />
            <span className="interface-port-label">{port.label ?? port.name}</span>
          </div>
        ))}
        {interfaceBundlePorts.map((port) => {
          const position = isModuleInterfaceModport ? Position.Top : (port.direction === 'output' ? Position.Right : Position.Left);
          return (
            <div
              key={port.id}
              className="interface-bundle-port"
              style={{
                ...(position === Position.Top
                  ? { left: `${nodeWidth / 2 - diagramSizing.gridSize / 2}px`, top: `${shiftY}px` }
                  : {
                    top: `${nodeHeight / 2 - diagramSizing.gridSize / 2}px`,
                    ...(position === Position.Right ? { right: 0 } : { left: 0 })
                  })
              }}
            >
              <Handle type="target" id={port.id} position={position} />
              <Handle type="source" id={port.id} position={position} />
            </div>
          );
        })}
        {!isInterfaceInstance && (
          <div
            className="bus-pipe"
            style={{
              top: isModuleInterfaceModport ? `${shiftY}px` : `${firstTapCenter - diagramSizing.gridSize / 2}px`,
              bottom: `${nodeHeight - lastTapCenter - diagramSizing.gridSize / 2}px`
            }}
          />
        )}
        <div className="bus-taps">
          {taps.map((port: DiagramPort, index: number) => (
            <div
              className={`bus-tap ${isInterfaceModport || isInterfaceInstance ? (port.preferredSide === 'right' || port.direction === 'output' ? 'bus-tap-right' : 'bus-tap-left') : ''}`}
              data-port-id={port.id}
              key={port.id}
              style={{ top: `${tapCenters[index] - diagramSizing.gridSize / 2}px` }}
              onDoubleClick={(event) => navigatePortSource(event, port)}
            >
              <span
                className={isInterfaceInstance && port.width === 'interface' ? 'interface-side-modport-label' : undefined}
                onClick={(event) => {
                  if (isInterfaceInstance && port.width === 'interface') navigatePortSource(event, port);
                }}
                onDoubleClick={(event) => navigatePortSource(event, port)}
              >
                {isInterfaceInstance && port.width === 'interface'
                  ? port.label ?? port.name
                  : <PortLabel port={port} showWidth={false} />}
                {(node.kind === 'struct' || (node.kind === 'interface' && port.width !== 'interface')) && structFieldAnnotation(node, port) && (
                  <span className="struct-field-annotation"> {structFieldAnnotation(node, port)}</span>
                )}
              </span>
              {isInterfaceModport ? (
                <>
                  <Handle type="source" id={port.id} position={port.direction === 'output' ? Position.Right : Position.Left} />
                  <Handle type="target" id={port.id} position={port.direction === 'output' ? Position.Right : Position.Left} />
                </>
              ) : isInterfaceInstance && port.width === 'interface' ? (
                <>
                  <Handle type="source" id={port.direction === 'input' ? `in:${port.name}` : `out:${port.name}`} position={port.preferredSide === 'left' ? Position.Left : Position.Right} />
                  <Handle type="target" id={port.direction === 'input' ? `in:${port.name}` : `out:${port.name}`} position={port.preferredSide === 'left' ? Position.Left : Position.Right} />
                </>
              ) : isInterfaceInstance ? null : isComposition ? (
                <Handle type="target" id={port.id} position={Position.Left} />
              ) : (
                <Handle type="source" id={port.id} position={Position.Right} />
              )}
            </div>
          ))}
        </div>
      </button>
    );
  }

  if (node.kind === 'register') {
    const clockSignal = registerClockSignal(node);
    const resetSignal = registerResetSignal(node);
    const resetActiveLow = registerResetActiveLow(node);
    const hasReset = Boolean(resetSignal);
    const dPort = inputs.find((port: DiagramPort) => port.name === 'D') ?? inputs[0];
    const qPort = outputs.find((port: DiagramPort) => port.name === 'Q') ?? outputs[0];
    const clockPort = inputs.find((port: DiagramPort) => port.name === clockSignal)
      ?? inputs.find((port: DiagramPort) => port.name !== 'D' && port.name !== resetSignal);
    const resetPort = resetSignal
      ? inputs.find((port: DiagramPort) => port.name === resetSignal)
      : undefined;
    const rvPort = inputs.find((port: DiagramPort) => port.name === 'RV');
    const hasRv = Boolean(rvPort);
    const renderedInputPortIds = new Set([dPort?.id, clockPort?.id, resetPort?.id, rvPort?.id].filter(Boolean));
    const extraInputPorts = inputs.filter((port: DiagramPort) => !renderedInputPortIds.has(port.id));

    return (
      <button
        className={`hdl-node hdl-node-register hdl-register-node${isArray ? ' hdl-node-array' : ''}`}
        data-node-id={node.id}
        data-node-kind={node.kind}
        style={{
          ...nodeStyle,
          '--svsch-register-d-top': `${registerPortTop('d', nodeHeight, hasReset, hasRv)}px`,
          '--svsch-register-q-top': `${registerPortTop('q', nodeHeight, hasReset, hasRv)}px`,
          '--svsch-register-clock-top': `${registerPortTop('clock', nodeHeight, hasReset, hasRv)}px`,
          '--svsch-register-reset-top': `${registerPortTop('reset', nodeHeight, hasReset, hasRv)}px`,
          '--svsch-register-rv-top': `${registerPortTop('rv', nodeHeight, hasReset, hasRv)}px`
        } as React.CSSProperties}
        title={node.source ? `${node.source.file}${node.source.startLine ? `:${node.source.startLine}` : ''}` : node.kind}
        onDoubleClick={handleDoubleClick}
      >
        {dPort && hasArrayConnection(dPort.id, 'target') && (
          <ArrayStackLeads
            side="left"
            width={nodeWidth}
            y={registerPortTop('d', nodeHeight, hasReset, hasRv) + diagramSizing.gridSize / 2}
            trimSink
          />
        )}
        {clockPort && hasArrayConnection(clockPort.id, 'target') && (
          <ArrayStackLeads
            side="left"
            width={nodeWidth}
            y={registerPortTop('clock', nodeHeight, hasReset, hasRv) + diagramSizing.gridSize / 2}
            trimSink
          />
        )}
        {arrayLayers}
        {nodeSelection}
        {arrayBadge}
        <div className="node-kind">REGISTER</div>
        <div className="node-title">{title}</div>
        <div className="register-port-layer">
          {dPort && (
            <div className="register-port register-port-d">
              <Handle type="target" id={dPort.id} position={Position.Left} />
              <span><PortLabel port={dPort} showWidth={false} /></span>
            </div>
          )}
          {qPort && (
            <div className="register-port register-port-q">
              <span><PortLabel port={qPort} showWidth={false} /></span>
              <Handle type="source" id={qPort.id} position={Position.Right} />
            </div>
          )}
          {clockPort && (
            <div className="register-port register-clock-port">
              <Handle type="target" id={clockPort.id} position={Position.Left} />
              <RegisterClockGlyph />
            </div>
          )}
          {resetPort && (
            <div className="register-port register-reset-port">
              <span className="register-reset-label">{resetActiveLow ? 'R\u0305' : 'R'}</span>
              <Handle type="target" id={resetPort.id} position={Position.Bottom} />
            </div>
          )}
          {rvPort && (
            <div className="register-port register-port-rv">
              <Handle type="target" id={rvPort.id} position={Position.Left} />
              <span>RV</span>
            </div>
          )}
          {extraInputPorts.map((port: DiagramPort, index: number) => (
            <div
              className="register-port register-extra-input-port"
              key={port.id}
              style={{ top: `${registerExtraInputPortTop(index, nodeHeight, hasRv)}px` }}
            >
              <Handle type="target" id={port.id} position={Position.Left} />
              <span><PortLabel port={port} showWidth={false} /></span>
            </div>
          ))}
        </div>
        {qPort && hasArrayConnection(qPort.id, 'source') && (
          <ArrayStackLeads
            side="right"
            width={nodeWidth}
            y={registerPortTop('q', nodeHeight, hasReset, hasRv) + diagramSizing.gridSize / 2}
          />
        )}
      </button>
    );
  }

  if (node.kind === 'replicate') {
    return (
      <button
        className="hdl-node hdl-node-replicate"
        data-node-id={node.id}
        data-node-kind={node.kind}
        style={nodeStyle}
        title={node.source ? `${node.source.file}${node.source.startLine ? `:${node.source.startLine}` : ''}` : node.kind}
        onDoubleClick={handleDoubleClick}
      >
        {nodeSelection}
        <div className="literal-content"><RepeatLabel node={node} /></div>
        {sideInputs.map((port: DiagramPort) => (
          <Handle key={port.id} type="target" id={port.id} position={Position.Left} />
        ))}
        {outputs.map((port: DiagramPort) => (
          <Handle key={port.id} type="source" id={port.id} position={Position.Right} />
        ))}
      </button>
    );
  }

  if (node.kind === 'literal') {
    return (
      <button
        className="hdl-node hdl-node-literal"
        data-node-id={node.id}
        data-node-kind={node.kind}
        style={nodeStyle}
        title={node.source ? `${node.source.file}${node.source.startLine ? `:${node.source.startLine}` : ''}` : node.kind}
        onDoubleClick={handleDoubleClick}
      >
        {nodeSelection}
        <div className="literal-content">{title}</div>
        {outputs.map((port: DiagramPort) => (
          <Handle key={port.id} type="source" id={port.id} position={Position.Right} />
        ))}
      </button>
    );
  }


  return (
    <button
      className={`hdl-node hdl-node-${node.kind}${instanceParameters.length > 0 ? ' hdl-node-has-params' : ''}${isArray ? ' hdl-node-array' : ''}`}
      data-node-id={node.id}
      data-node-kind={node.kind}
      style={nodeStyle}
      title={node.source ? `${node.source.file}${node.source.startLine ? `:${node.source.startLine}` : ''}` : node.kind}
      onDoubleClick={handleDoubleClick}
    >
      {(node.kind === 'mux' || node.kind === 'select') && muxTopPorts.map((port: DiagramPort, index: number) => (
        hasArrayConnection(port.id, 'target') ? (
          <ArrayStackLeads
            key={`stack-leads-${port.id}`}
            side="top"
            width={nodeWidth}
            x={nodeWidth * (index + 1) / (muxTopPorts.length + 1)}
            y={muxTopPortSkinEdgeY(index, muxTopPorts.length, nodeHeight)}
            trimSink
          />
        ) : null
      ))}
      {(node.kind === 'mux' || node.kind === 'select') && sideInputs.map((port: DiagramPort, index: number) => (
        hasArrayConnection(port.id, 'target') ? (
          <ArrayStackLeads
            key={`stack-leads-${port.id}`}
            side="left"
            width={nodeWidth}
            y={muxInputPortCenterY(index, sideInputs.length, nodeHeight)}
            trimSink
          />
        ) : null
      ))}
      {(node.kind === 'mux' || node.kind === 'select') && outputs.slice(0, 1).map((port: DiagramPort) => (
        hasArrayConnection(port.id, 'source') ? (
          <ArrayStackLeads
            key={`stack-leads-${port.id}`}
            side="right"
            width={nodeWidth}
            y={nodeHeight / 2}
          />
        ) : null
      ))}
      {isArray && arrayLayers}
      {node.kind !== 'mux' && node.kind !== 'alu' && node.kind !== 'select' && nodeSelection}
      {node.kind === 'mux' && <MuxSkin width={nodeWidth} height={nodeHeight} showSelection={!isArray} />}
      {node.kind === 'mux' && isArray && <ArrayStackSelection kind="mux" width={nodeWidth} height={nodeHeight} />}
      {node.kind === 'select' && <SelectSkin width={nodeWidth} height={nodeHeight} />}
      {node.kind === 'alu' && <AluSkin width={nodeWidth} height={nodeHeight} />}
      {muxTopPorts.map((port: DiagramPort, index: number) => {
        const leadLengthY = (node.kind === 'mux' || node.kind === 'select') && (normalizeWidth(port.width) || (port.connectedSignal?.length ?? 0) > 24)
          ? muxTopPortLeadLengthY(index, muxTopPorts.length, nodeHeight)
          : 0;
        const labelOffsetY = shouldLowerMuxTopPortLabel(node, port)
          ? muxTopPortLabelOffsetY(index, muxTopPorts.length, nodeHeight)
          : 0;
        return (
          <div className="mux-select-port" key={port.id} style={{ left: `${((index + 1) / (muxTopPorts.length + 1)) * 100}%` }}>
            {leadLengthY > 0 && <i aria-hidden="true" className="mux-select-lead" style={{ height: `${leadLengthY}px` }} />}
            <Handle type="target" id={port.id} position={Position.Top} />
            <span style={{
              top: `${labelOffsetY}px`,
              ...(node.kind === 'mux' && isArray ? { left: `${diagramSizing.gridSize * 0.7}px` } : {})
            }}>
              {node.kind === 'select' ? selectPortLabel(node, port.name === 'width' ? 'w' : 's') : port.label ?? 's'}
            </span>
          </div>
        );
      })}
      <div className="node-kind">{formatNodeKind(node)}</div>
      {node.kind === 'instance' && <InstanceParameterList parameters={instanceParameters} />}
      {node.kind !== 'comb' && node.kind !== 'alu' && node.kind !== 'loop' && <div className="node-title">{title}</div>}
      {node.kind === 'alu' ? (
        <div className="alu-port-layer">
          {sideInputs.slice(0, 2).map((port: DiagramPort, index: number) => (
            <div
              className="alu-input-port"
              key={port.id}
              style={{ top: `${(index === 0 ? diagramSizing.gridSize : diagramSizing.gridSize * 3) - diagramSizing.gridSize / 2}px` }}
            >
              <Handle type="target" id={port.id} position={Position.Left} />
            </div>
          ))}
          <div className="alu-operation">{nodeOperation(node) ?? '+'}</div>
          {outputs.slice(0, 1).map((port: DiagramPort) => (
            <div
              className="alu-output-port"
              key={port.id}
              style={{ top: `${nodeHeight / 2 - diagramSizing.gridSize / 2}px` }}
            >
              <Handle type="source" id={port.id} position={Position.Right} />
            </div>
          ))}
        </div>
      ) : (node.kind === 'mux' || node.kind === 'select') ? (
        <div className="mux-port-layer">
          {sideInputs.map((port: DiagramPort, index: number) => (
            <div
              className="mux-side-port"
              key={port.id}
              style={{ top: `${muxInputPortCenterY(index, sideInputs.length, nodeHeight) - diagramSizing.gridSize / 2}px` }}
            >
              <Handle type="target" id={port.id} position={Position.Left} />
              <span>{node.kind === 'select' ? selectPortLabel(node, port) : <PortLabel port={port} showWidth={node.kind === 'mux'} />}</span>
            </div>
          ))}
          {outputs.slice(0, 1).map((port: DiagramPort) => (
            <div
              className="mux-output-port"
              key={port.id}
              style={{ top: `${nodeHeight / 2 - diagramSizing.gridSize / 2}px` }}
            >
              <span>{node.kind === 'select' ? selectPortLabel(node, port) : port.label ?? port.name}</span>
              <Handle type="source" id={port.id} position={Position.Right} />
            </div>
          ))}
        </div>
      ) : (
        <div className="node-ports">
          <div>
            {sideInputs.map((port: DiagramPort) => (
              <div className="node-port" key={port.id}>
                <Handle type="target" id={port.id} position={Position.Left} />
                {node.kind === 'comb' || node.kind === 'loop' ? '' : <PortLabel port={port} showWidth={true} showType={showPortTypes} collapseWidth={node.kind === 'instance'} />}
                {port.direction === 'inout' && <Handle type="source" id={port.id} position={Position.Right} />}
              </div>
            ))}
          </div>
          <div>
            {outputs.map((port: DiagramPort) => (
              <div className="node-port node-port-out" key={port.id}>
                {node.kind === 'comb' || node.kind === 'loop' ? '' : <PortLabel port={port} showWidth={true} showType={showPortTypes} collapseWidth={node.kind === 'instance'} />}
                <Handle type="source" id={port.id} position={Position.Right} />
              </div>
            ))}
          </div>
        </div>
      )}
    </button>
  );
}

function registerPortTop(role: 'd' | 'q' | 'clock' | 'reset' | 'rv', nodeHeight: number, _hasReset: boolean, hasRv: boolean): number {
  const grid = diagramSizing.gridSize;
  if (role === 'd' || role === 'q') {
    return diagramSizing.nodeHeaderHeight;
  }
  if (role === 'clock') {
    return diagramSizing.nodeHeaderHeight + grid;
  }
  if (role === 'rv') {
    return diagramSizing.nodeHeaderHeight + grid * 2;
  }
  return nodeHeight - grid;
}

function registerExtraInputPortTop(index: number, nodeHeight: number, hasRv: boolean): number {
  const grid = diagramSizing.gridSize;
  const offset = hasRv ? 3 : 2;
  return Math.min(diagramSizing.nodeHeaderHeight + grid * (index + offset), nodeHeight - grid);
}

function MiniMapNode({ id, x, y, width, height, className }: MiniMapNodeProps): React.ReactElement {
  const nodes = useNodes<HdlFlowNode>();
  const flowNode = nodes.find((n: HdlFlowNode) => n.id === id);
  const node = flowNode?.data.node;

  if (!node) {
    return <rect x={x} y={y} width={width} height={height} className={className} fill="var(--vscode-editor-foreground)" />;
  }

  const noseLength = node.kind === 'port' ? (diagramSizing.portNoseLength / diagramSizing.portWidth) * width : 0;
  const midY = y + height / 2;

  let path = `M ${x} ${y} h ${width} v ${height} h ${-width} Z`;

  if (node.kind === 'port') {
    const portDirection = node.ports[0]?.direction ?? 'unknown';
    if (portDirection === 'input') {
      path = `M ${x} ${y} H ${x + width - noseLength} L ${x + width} ${midY} L ${x + width - noseLength} ${y + height} H ${x} Z`;
    } else if (portDirection === 'output') {
      path = `M ${x + noseLength} ${y} H ${x + width} V ${y + height} H ${x + noseLength} L ${x} ${midY} Z`;
    }
  } else if (node.kind === 'mux' || node.kind === 'alu') {
    const totalHeight = diagramNodeDimensions(node).height;
    const muxRightSideRatio = diagramSizing.muxRightSideHeight / totalHeight;
    const rightSideHeight = height * muxRightSideRatio;
    const rightTopRel = (height - rightSideHeight) / 2;
    const rightTop = y + rightTopRel;
    const rightBottom = rightTop + rightSideHeight;

    if (node.kind === 'mux') {
      path = `M ${x} ${y} L ${x + width} ${rightTop} V ${rightBottom} L ${x} ${y + height} Z`;
    } else {
      const notchX = width / 4;
      const midY = y + height / 2;
      const slope = rightTopRel / width;
      const deltaY = slope * notchX;
      const notchTopY = midY - deltaY;
      const notchBottomY = midY + deltaY;
      path = `M ${x} ${y} L ${x + width} ${rightTop} V ${rightBottom} L ${x} ${y + height} V ${notchBottomY} L ${x + notchX} ${midY} L ${x} ${notchTopY} Z`;
    }
  } else if (node.kind === 'interface') {
    const role = structRole(node);
    const isInterfaceInstance = role !== 'modport' && role !== 'port' && !node.id.startsWith('interface_type:');
    if (isInterfaceInstance) {
      const { width: actualWidth, height: actualHeight } = diagramNodeDimensions(node);
      const scaleX = width / actualWidth;
      const scaleY = height / actualHeight;
      const aggregatePorts = node.ports.filter((port) => port.width !== 'interface' || port.preferredSide);
      const topPorts = aggregatePorts.filter(p => p.direction === 'input' && p.width !== 'interface');
      const bottomPorts = aggregatePorts.filter(p => p.direction === 'output' && p.width !== 'interface');
      const sidePorts = aggregatePorts.filter(p => p.width === 'interface' || (p.direction !== 'input' && p.direction !== 'output'));
      const orderedSide = orderedInterfaceSidePorts(sidePorts);
      const topHatHeight = interfaceTopHatHeight(topPorts.length > 0);
      const bottomHatHeight = interfaceTopHatHeight(bottomPorts.length > 0);
      const shiftY = diagramSizing.gridSize * 3 + diagramSizing.gridSize / 2;
      const unshiftedHeight = Math.max(diagramSizing.gridSize, actualHeight - shiftY);
      const leftCenters = distributedInterfaceSideCenters(orderedSide.left.length, unshiftedHeight, topHatHeight, bottomHatHeight).map(c => c + shiftY);
      const rightCenters = distributedInterfaceSideCenters(orderedSide.right.length, unshiftedHeight, topHatHeight, bottomHatHeight).map(c => c + shiftY);
      const { path: skinPath } = interfaceSkinPath({
        width: actualWidth,
        height: actualHeight,
        leftCenters,
        rightCenters,
        topPortCount: topPorts.length,
        bottomPortCount: bottomPorts.length
      });
      return (
        <g transform={`translate(${x}, ${y}) scale(${scaleX}, ${scaleY})`}>
          <path
            d={skinPath}
            className={className}
            fill="var(--vscode-editor-foreground)"
            stroke="var(--vscode-editor-foreground)"
            strokeOpacity={0.4}
          />
        </g>
      );
    }
  }

  return (
    <path
      d={path}
      className={className}
      fill="var(--vscode-editor-foreground)"
      stroke="var(--vscode-editor-foreground)"
      strokeOpacity={0.4}
    />
  );
}

function App(): React.ReactElement {
  return (
    <ReactFlowProvider>
      <DiagramApp />
    </ReactFlowProvider>
  );
}

function DiagramApp(): React.ReactElement {
  const [view, setView] = useState<DiagramViewModel | undefined>();
  const [modules, setModules] = useState<string[]>([]);
  const [status, setStatus] = useState<'idle' | 'rebuilding'>('idle');
  const [nodes, setNodes, onNodesChangeRaw] = useNodesState<HdlFlowNode>([]);
  const onNodesChange = useCallback((changes: any[]) => {
    const adjusted = changes.map((change) => {
      if (change.type === 'position' && change.position) {
        const node = nodes.find((candidate) => candidate.id === change.id);
        const kind = node?.data?.node?.kind;
        const role = node?.data?.node?.metadata?.role;
        const isHalfGrid = kind === 'port' || kind === 'literal' || (kind === 'interface' && role === 'port');
        if (isHalfGrid) {
          return {
            ...change,
            position: {
              ...change.position,
              y: Math.round((change.position.y - 12) / 24) * 24 + 12
            }
          };
        }
      }
      return change;
    });
    onNodesChangeRaw(adjusted);
  }, [nodes, onNodesChangeRaw]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const reactFlow = useReactFlow();
  const [hasFitInitialView, setHasFitInitialView] = useState(false);
  const [hoveredNetKey, setHoveredNetKey] = useState<string | undefined>();

  const setHovered = useCallback((netKey?: string) => {
    setHoveredNetKey(netKey);
  }, []);

  const handleRouteChange = useCallback((changes: RouteChange[], commit: boolean) => {
    const changeMap = new Map(changes.map(c => [c.edgeId, c.routePoints]));

    setEdges((currentEdges: Edge[]) => currentEdges.map((edge: Edge) => {
      const routePoints = changeMap.get(edge.id);
      if (routePoints) {
        return { ...edge, data: { ...edge.data, routePoints } };
      }
      return edge;
    }));

    if (commit && view) {
      vscode.postMessage({
        type: 'edgeRoutesChanged',
        moduleName: view.moduleName,
        changes
      });
    }
  }, [setEdges, view]);

  const onEdgeMouseEnter = useCallback((_event: React.MouseEvent, edge: Edge) => {
    const diagramEdge = edge.data?.edge as DiagramEdge | undefined;
    const netKey = diagramEdge ? edgeNetKey(diagramEdge) : undefined;
    setHovered(netKey);
  }, [setHovered]);

  const onEdgeMouseLeave = useCallback(() => {
    setHovered(undefined);
  }, [setHovered]);

  useEffect(() => {
    const listener = (event: MessageEvent<GraphMessage | StatusMessage>) => {
      if (event.data.type === 'graph') {
        const view = event.data.view;
        setView(view);
        setModules(event.data.modules);
        setHovered(undefined);
      } else if (event.data.type === 'status') {
        setStatus(event.data.status);
      }
    };
    window.addEventListener('message', listener);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', listener);
  }, [setHovered]);

  useEffect(() => {
    if (!view) {
      return;
    }
    const nodeById = new Map(view.nodes.map((node) => [node.id, node]));
    const arrayConnectionsByNode = new Map<string, ArrayStackConnection[]>();
    const addArrayConnection = (nodeId: string, connection: ArrayStackConnection) => {
      const list = arrayConnectionsByNode.get(nodeId) ?? [];
      if (!list.some((existing) => existing.portId === connection.portId && existing.role === connection.role)) {
        list.push(connection);
      }
      arrayConnectionsByNode.set(nodeId, list);
    };

    view.edges.forEach((edge) => {
      if (!edge.isStacked) {
        return;
      }
      const sourceNode = nodeById.get(edge.source);
      const targetNode = nodeById.get(edge.target);
      const sourceIsArray = sourceNode ? nodeIsArrayNode(sourceNode) : false;
      const targetIsArray = targetNode ? nodeIsArrayNode(targetNode) : false;
      if (sourceIsArray) {
        addArrayConnection(edge.source, { portId: edge.sourcePort, role: 'source' });
        addArrayConnection(edge.target, { portId: edge.targetPort, role: 'target' });
      }
      if (targetIsArray) {
        addArrayConnection(edge.target, { portId: edge.targetPort, role: 'target' });
      }
    });

    setNodes(view.nodes.map((node) => ({
      id: node.id,
      type: 'hdl',
      position: node.position,
      zIndex: nodeIsArrayNode(node) ? ARRAY_NODE_Z_INDEX : BLOCK_NODE_Z_INDEX,
      data: { node, arrayConnections: arrayConnectionsByNode.get(node.id) ?? [] }
    })));

    const netToLeader = new Map<string, string>();
    const edgesByNet = new Map<string, string[]>();
    
    view.edges.forEach(edge => {
      const netKey = edgeNetKey(edge);
      const list = edgesByNet.get(netKey) || [];
      list.push(edge.id);
      edgesByNet.set(netKey, list);
    });

    edgesByNet.forEach((ids, netKey) => {
      netToLeader.set(netKey, ids.sort()[0]);
    });

    setEdges(view.edges.map((edge) => {
      const netKey = edgeNetKey(edge);
      const isNetLeader = netToLeader.get(netKey) === edge.id;
      const netEdgeIds = Array.from(edgesByNet.get(netKey) || []);
      
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourcePort,
        targetHandle: edge.targetPort,
        label: edge.label,
        type: 'svsch',
        zIndex: EDGE_Z_INDEX,
        data: {
          waypoint: edge.waypoint,
          routePoints: edge.routePoints,
          onRouteChange: handleRouteChange,
          edge,
          isNetLeader,
          netEdgeIds
        }
      };
    }));
  }, [handleRouteChange, setEdges, view]);

  useEffect(() => {
    if (!hasFitInitialView && nodes.length > 0) {
      window.setTimeout(() => {
        reactFlow.fitView({ padding: 0.2 });
        setHasFitInitialView(true);
      }, 0);
    }
  }, [hasFitInitialView, nodes.length, reactFlow]);

  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, dragged: HdlFlowNode, allNodes: HdlFlowNode[]) => {
      if (!view) {
        return;
      }
      const positioned = allNodes.map((node) => ({
        ...node.data.node,
        position: node.id === dragged.id ? dragged.position : node.position,
        fixed: node.data.node.fixed || node.id === dragged.id
      }));
      vscode.postMessage({ type: 'layoutChanged', moduleName: view.moduleName, nodes: positioned });
    },
    [view]
  );

  const nodeTypes = useMemo(() => ({ hdl: HdlNode }), []);
  const edgeTypes = useMemo(() => ({ svsch: OrthogonalEdge }), []);
  const diagramStyle = useMemo(() => ({
    '--svsch-grid': `${diagramSizing.gridSize}px`,
    '--svsch-node-width': `${diagramSizing.nodeWidth}px`,
    '--svsch-node-height': `${diagramSizing.nodeHeight}px`,
    '--svsch-node-header-height': `${diagramSizing.nodeHeaderHeight}px`,
    '--svsch-port-width': `${diagramSizing.portWidth}px`,
    '--svsch-port-height': `${diagramSizing.portHeight}px`,
    '--svsch-port-skin-height': `${diagramSizing.portSkinHeight}px`,
    '--svsch-port-nose-length': `${diagramSizing.portNoseLength}px`,
    '--svsch-handle-offset': '-7px'
  }) as React.CSSProperties, []);

  if (!view) {
    return <div className="empty">Building diagram...</div>;
  }

  return (
    <div className="shell" style={diagramStyle}>
        {status === 'rebuilding' && (
          <div className="busy-indicator" role="status" aria-live="polite">
            <span />
            Updating
          </div>
        )}
        <header className="toolbar">
          <select
            className="vscode-control vscode-select"
            aria-label="Module"
            value={view.moduleName}
            onChange={(event) => vscode.postMessage({ type: 'openModule', moduleName: event.target.value })}
          >
            {modules.map((moduleName) => (
              <option key={moduleName} value={moduleName}>
                {moduleName}
              </option>
            ))}
          </select>
          <button className="vscode-control vscode-button" onClick={() => vscode.postMessage({ type: 'resetLayout', moduleName: view.moduleName })}>Reset Layout</button>
        </header>
        {view.diagnostics.length > 0 && (
          <aside className="diagnostics">
            {view.diagnostics.slice(0, 3).map((diagnostic, index) => (
              <div key={`${diagnostic.message}-${index}`} className={`diagnostic diagnostic-${diagnostic.severity}`}>
                {diagnostic.message}
              </div>
            ))}
          </aside>
        )}
        <main className="canvas" key={view.moduleName}>
          <ModuleParameterTable moduleName={view.moduleName} parameters={view.parameters} />
          <InteractionContext.Provider value={{ hoveredNetKey, setHovered }}>
            <LineJumpProvider>
              <ReactFlow<HdlFlowNode, Edge>
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeDragStop={onNodeDragStop}
                onEdgeMouseEnter={onEdgeMouseEnter}
                onEdgeMouseLeave={onEdgeMouseLeave}
                onEdgeClick={(event: React.MouseEvent, _edge: Edge) => {
                  event.stopPropagation();
                }}
                onEdgeDoubleClick={(event: React.MouseEvent, edge: Edge) => {
                  if (edge.data?.edge) {
                    const msg = { type: 'navigateToSignal', edge: edge.data.edge };
                    console.log('NAVIGATE:', JSON.stringify(msg));
                    vscode.postMessage(msg);
                  }
                }}
                onInit={(instance: any) => {
                  (window as any).reactFlowInstance = instance;
                }}
                nodesConnectable={false}
                deleteKeyCode={null}
                snapToGrid
                snapGrid={[diagramSizing.gridSize, diagramSizing.gridSize]}
                zIndexMode="manual"
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={diagramSizing.gridSize} />
                <MiniMap
                  pannable
                  zoomable
                  className="svsch-minimap"
                  nodeComponent={MiniMapNode}
                />
                <Controls />
              </ReactFlow>
            </LineJumpProvider>
          </InteractionContext.Provider>
        </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
