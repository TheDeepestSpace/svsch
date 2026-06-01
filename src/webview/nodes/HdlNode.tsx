import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { getVscodeApi } from '../vscodeApi';
import { diagramSizing, normalizeWidth } from '../../diagram/constants';
import { diagramNodeDimensions, instanceParameterRows } from '../../diagram/nodeSizing';
import { selectPortLabel } from '../../diagram/selectLabels';
import {
  distributedInterfaceSideCenters,
  interfaceTopHatHeight,
  interfaceTopHatTop,
  interfaceTopPortX,
  orderedInterfaceSidePorts
} from '../../diagram/interfaceGeometry';
import { registerPortTop, registerExtraInputPortTop } from '../../diagram/registerGeometry';
import { muxInputPortCenterY, muxTopPortSkinEdgeY, muxTopPortLabelOffsetY, muxTopPortLeadLengthY } from '../../diagram/muxGeometry';
import { busTapPortCenterY } from '../../diagram/busGeometry';
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
  structRole
} from '../../ir/nodeMetadata';
import type { DiagramPort } from '../../ir/types';
import {
  InputPortSkin,
  HarnessSkin,
  InterfaceSkin,
  MuxSkin,
  MuxArrayLayers,
  SelectSkin,
  AluSkin,
  InverterSkin,
  ArrayStackSelection,
  OutputPortSkin
} from './shared/skins';
import {
  TypeLabel,
  PortLabel,
  InstanceParameterList,
  RepeatLabel,
  structFieldAnnotation,
  formatNodeKind,
  RegisterClockGlyph,
  shouldLowerMuxTopPortLabel
} from './shared/labels';
import { ArrayStackLeads } from './shared/NetLabelWire';
import { NetLabelNode } from './NetLabelNode';
import type { HdlFlowNode } from './types';

const vscode = getVscodeApi();

export function HdlNode({ data }: NodeProps<HdlFlowNode>): React.ReactElement {
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
    && node.kind !== 'inverter'
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

  if (node.kind === 'netLabel') {
    return (
      <NetLabelNode
        node={node}
        moduleName={data.moduleName ?? node.parentModule ?? ''}
        style={nodeStyle}
      />
    );
  }

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
    const handlePositionOverride = node.metadata?.handlePosition as Position | undefined;
    const leadSide = handlePositionOverride === Position.Bottom
      ? 'bottom'
      : handlePositionOverride === Position.Top
        ? 'top'
        : isOutput ? 'left' : 'right';

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
        {isOutput && <Handle type="target" id={node.ports[0]?.id} position={handlePositionOverride ?? Position.Left} />}
        {isOutput && <Handle type="source" id={node.ports[0]?.id} position={handlePositionOverride ?? Position.Left} />}
        {isSkinnedPort && isOutput && hasArrayConnection(node.ports[0]?.id, 'target') && (
          <ArrayStackLeads
            side={leadSide}
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
            side={leadSide}
            width={nodeWidth}
            y={diagramSizing.portHeight / 2}
          />
        )}
        {!isOutput && <Handle type="source" id={node.ports[0]?.id} position={handlePositionOverride ?? Position.Right} />}
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
    const isArrayComposition = node.kind === 'bus' && isComposition && node.metadata?.aggregateKind === 'array';
    const isArrayBreakout = node.kind === 'bus' && !isComposition && node.metadata?.aggregateKind === 'array';

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
      '--svsch-bus-single-y': isArrayComposition || isArrayBreakout ? `${lastTapCenter + diagramSizing.gridSize}px` : `${firstTapCenter}px`
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
        className={`hdl-bus-node ${node.kind === 'struct' ? 'hdl-struct-node' : ''} ${isInterface ? 'hdl-interface-node' : ''} ${isInterfaceModport ? 'hdl-interface-modport' : ''} ${isInterfaceInstance ? 'hdl-interface-instance' : ''} ${isComposition ? 'hdl-bus-composition' : 'hdl-bus-breakout'} ${isArrayComposition ? 'hdl-bus-array-composition' : ''} ${isArrayBreakout ? 'hdl-bus-array-breakout' : ''}`}
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
              <span className="register-reset-label">{resetActiveLow ? 'R̅' : 'R'}</span>
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
        {resetPort && hasArrayConnection(resetPort.id, 'target') && (
          <ArrayStackLeads
            side="bottom"
            width={nodeWidth}
            y={registerPortTop('reset', nodeHeight, hasReset, hasRv) + diagramSizing.gridSize}
            trimSink
          />
        )}
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

  if (node.kind === 'inverter') {
    const invG = diagramSizing.gridSize;
    const invBubbleRadius = Math.min(invG / 4, invG / 6);
    const invGeometryWidth = invG * Math.sqrt(3) / 2 + 2 + invBubbleRadius * 2;
    const invOutputOffset = nodeWidth - invGeometryWidth;
    return (
      <button
        className="hdl-node hdl-node-inverter"
        data-node-id={node.id}
        data-node-kind={node.kind}
        style={nodeStyle}
        title={node.source ? `${node.source.file}${node.source.startLine ? `:${node.source.startLine}` : ''}` : node.kind}
        onDoubleClick={handleDoubleClick}
      >
        <InverterSkin width={nodeWidth} height={nodeHeight} />
        {sideInputs.slice(0, 1).map((port: DiagramPort) => (
          <Handle key={port.id} type="target" id={port.id} position={Position.Left} />
        ))}
        {outputs.slice(0, 1).map((port: DiagramPort) => (
          <Handle key={port.id} type="source" id={port.id} position={Position.Right}
            style={invOutputOffset > 0 ? { right: `${invOutputOffset}px` } : undefined} />
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
              <span>{node.kind === 'select' ? selectPortLabel(node, port) : <PortLabel port={port} showWidth={node.kind === 'mux'} collapseWidth={node.kind === 'mux'} />}</span>
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
