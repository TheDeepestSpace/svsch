import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Background,
  Controls,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  type Edge,
  useReactFlow,
  useEdgesState,
  useNodesState
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { diagramSizing, normalizeWidth } from '../diagram/constants';
import { diagramNodeDimensions } from '../diagram/nodeSizing';
import { annotateGenerateRegionWarnings } from '../layout/generateRegionValidation';
import { OrthogonalEdge, type RouteChange } from './orthogonal';
import { LineJumpProvider } from './react-flow-line-jumps';
import { Tooltip } from './Tooltip';
import type {
  DiagramViewModel,
  DiagramEdge,
  PositionedGenerateRegion,
  PositionedNode
} from '../ir/types';
import { edgeNetKey } from '../ir/edgeNet';
import { nodeIsArrayNode } from '../ir/nodeMetadata';
import { HdlNode } from './nodes/HdlNode';
import { MiniMapNode } from './nodes/MiniMapNode';
import { InteractionContext } from './nodes/shared/context';
import { ModuleParameterTable } from './nodes/shared/labels';
import type { HdlFlowNode, ArrayStackConnection } from './nodes/types';

interface GraphMessage {
  type: 'graph';
  view: DiagramViewModel;
  modules: string[];
}

interface StatusMessage {
  type: 'status';
  status: 'idle' | 'rebuilding';
}

import { getVscodeApi } from './vscodeApi';

const vscode = getVscodeApi();

const EDGE_Z_INDEX = 1;
const ARRAY_NODE_Z_INDEX = 2;
const BLOCK_NODE_Z_INDEX = 2;
const GENERATE_REGION_MIN_CONTENT_PADDING = diagramSizing.gridSize * 2;

function generateStateClass(state?: string, prefix = 'generate'): string | undefined {
  if (state === 'active') return `${prefix}-active`;
  if (state === 'inactive') return `${prefix}-inactive`;
  return undefined;
}

interface FlowViewport {
  x: number;
  y: number;
  zoom: number;
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
  const [regions, setRegions] = useState<PositionedGenerateRegion[]>([]);
  const regionsRef = useRef<PositionedGenerateRegion[]>([]);
  const [viewport, setViewport] = useState<FlowViewport>({ x: 0, y: 0, zoom: 1 });
  const groupDragRef = useRef<{
    startPos: { x: number; y: number };
    originalRoutes: Map<string, Array<{ x: number; y: number }>>;
  } | null>(null);
  const onNodesChange = useCallback((changes: any[]) => {
    const adjusted = changes.map((change) => {
      if (change.type === 'position' && change.position) {
        const node = nodes.find((candidate) => candidate.id === change.id);
        const kind = node?.data?.node?.kind;
        const role = node?.data?.node?.metadata?.role;
        const isHalfGrid = kind === 'port' || kind === 'literal' || (kind === 'interface' && role === 'port');
        if (kind === 'netLabel') {
          return {
            ...change,
            position: {
              x: Math.round(change.position.x / 24) * 24,
              y: Math.round(change.position.y / 24) * 24
            }
          };
        }
        if (isHalfGrid) {
          return {
            ...change,
            position: {
              x: Math.round(change.position.x / 24) * 24,
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
  const fittedModuleNameRef = useRef<string | undefined>(undefined);
  const [hoveredNetKey, setHoveredNetKey] = useState<string | undefined>();
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const setHovered = useCallback((netKey?: string, immediate = false) => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = undefined;
    }

    if (netKey || immediate) {
      setHoveredNetKey(netKey);
    } else {
      hoverTimeoutRef.current = setTimeout(() => {
        setHoveredNetKey(undefined);
        hoverTimeoutRef.current = undefined;
      }, 500);
    }
  }, []);

  useEffect(() => {
    regionsRef.current = regions;
  }, [regions]);

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
      const flowNodes = reactFlow.getNodes() as HdlFlowNode[];
      vscode.postMessage({
        type: 'edgeRoutesChanged',
        moduleName: view.moduleName,
        changes,
        nodes: flowNodesToPositioned(flowNodes, new Set(flowNodes.map((node) => node.id)))
      });
    }
  }, [reactFlow, setEdges, view]);

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
        setHovered(undefined, true);
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
      className: generateStateClass(node.metadata?.generateActiveState, 'generate-node'),
      zIndex: nodeIsArrayNode(node) ? ARRAY_NODE_Z_INDEX : BLOCK_NODE_Z_INDEX,
      data: { node, moduleName: view.moduleName, arrayConnections: arrayConnectionsByNode.get(node.id) ?? [] }
    })));
    setRegions(view.generateRegions ?? []);

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

    const sortedEdges = [...view.edges].sort((a, b) => a.id.localeCompare(b.id));
    setEdges(sortedEdges.map((edge) => {
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
        className: generateStateClass(edge.metadata?.generateActiveState, 'generate-edge'),
        zIndex: EDGE_Z_INDEX,
        data: {
          waypoint: edge.waypoint,
          routePoints: edge.routePoints,
          onRouteChange: handleRouteChange,
          edge,
          moduleName: view.moduleName,
          isNetLeader,
          netEdgeIds
        }
      };
    }));
  }, [handleRouteChange, setEdges, view]);

  useEffect(() => {
    if (!view || nodes.length === 0) {
      return;
    }

    const nodesMatchView =
      nodes.length === view.nodes.length &&
      nodes.every((node) => node.data?.moduleName === view.moduleName);

    if (!nodesMatchView || fittedModuleNameRef.current === view.moduleName) {
      return;
    }

    const timeout = window.setTimeout(() => {
      reactFlow.fitView({ padding: 0.2 });
      fittedModuleNameRef.current = view.moduleName;
    }, 0);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [nodes, reactFlow, view]);

  const onNodeDragStart = useCallback(
    (_: React.MouseEvent, dragged: HdlFlowNode, allNodes: HdlFlowNode[]) => {
      const movedIds = new Set(allNodes.map((n) => n.id));
      if (movedIds.size < 2) return;
      const originalRoutes = new Map<string, Array<{ x: number; y: number }>>();
      for (const e of edges) {
        const pts = e.data?.routePoints as Array<{ x: number; y: number }> | undefined;
        if (movedIds.has(e.source) && movedIds.has(e.target) && pts && pts.length > 0) {
          originalRoutes.set(e.id, pts.map((pt) => ({ ...pt })));
        }
      }
      groupDragRef.current = {
        startPos: { x: dragged.position.x, y: dragged.position.y },
        originalRoutes,
      };
    },
    [edges]
  );

  const onNodeDrag = useCallback(
    (_: React.MouseEvent, dragged: HdlFlowNode, allNodes: HdlFlowNode[] = [dragged]) => {
      const movedNodes = allNodes.length > 0 ? allNodes : [dragged];
      const allFlowNodes = mergeDraggedFlowNodes(reactFlow.getNodes() as HdlFlowNode[], movedNodes);
      const positioned = flowNodesToPositioned(allFlowNodes, new Set(movedNodes.map((node) => node.id)));
      setRegions((current) => expandRegionsForNodes(current, positioned));

      const state = groupDragRef.current;
      if (!state || state.originalRoutes.size === 0) return;
      const dx = dragged.position.x - state.startPos.x;
      const dy = dragged.position.y - state.startPos.y;
      const changes = Array.from(state.originalRoutes.entries()).map(([edgeId, pts]) => ({
        edgeId,
        routePoints: pts.map((pt) => ({ x: pt.x + dx, y: pt.y + dy }))
      }));
      handleRouteChange(changes, false);
    },
    [handleRouteChange, reactFlow]
  );

  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, dragged: HdlFlowNode, allNodes: HdlFlowNode[]) => {
      if (!view) {
        return;
      }
      const movedNodes = allNodes.length > 0 ? allNodes : [dragged];
      const allFlowNodes = mergeDraggedFlowNodes(reactFlow.getNodes() as HdlFlowNode[], movedNodes);
      const fixedIds = new Set(movedNodes.map((node) => node.id));
      fixedIds.add(dragged.id);
      const positioned = flowNodesToPositioned(allFlowNodes, fixedIds);
      const expandedRegions = expandRegionsForNodes(regionsRef.current, positioned);
      setRegions(expandedRegions);
      vscode.postMessage({ type: 'layoutChanged', moduleName: view.moduleName, nodes: positioned, regions: expandedRegions });

      const state = groupDragRef.current;
      groupDragRef.current = null;
      if (!state || state.originalRoutes.size === 0) return;

      const dx = dragged.position.x - state.startPos.x;
      const dy = dragged.position.y - state.startPos.y;
      if (dx === 0 && dy === 0) return;

      const changes = Array.from(state.originalRoutes.entries()).map(([edgeId, pts]) => ({
        edgeId,
        routePoints: pts.map((pt) => ({ x: pt.x + dx, y: pt.y + dy }))
      }));
      handleRouteChange(changes, true);
    },
    [view, handleRouteChange, reactFlow]
  );

  const rerouteLayout = useCallback(() => {
    if (!view) {
      return;
    }
    const positioned = nodes.map((node) => ({
      ...node.data.node,
      position: node.position,
      fixed: true
    }));
    vscode.postMessage({ type: 'rerouteLayout', moduleName: view.moduleName, nodes: positioned });
  }, [nodes, view]);

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
          <button className="vscode-control vscode-button vscode-button-secondary" onClick={() => vscode.postMessage({ type: 'exportSvg' })}>Export SVG</button>
          <button className="vscode-control vscode-button vscode-button-secondary" onClick={rerouteLayout}>Reroute All</button>
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
                onNodeDragStart={onNodeDragStart}
                onNodeDrag={onNodeDrag}
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
                  setViewport(instance.getViewport?.() ?? { x: 0, y: 0, zoom: 1 });
                }}
                onMove={(_: unknown, nextViewport: FlowViewport) => setViewport(nextViewport)}
                nodesConnectable={false}
                deleteKeyCode={null}
                selectionOnDrag
                panOnDrag={[1, 2]}
                selectionMode="partial"
                snapToGrid
                snapGrid={[diagramSizing.gridSize, diagramSizing.gridSize]}
                zIndexMode="manual"
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={diagramSizing.gridSize} />
                <ViewportPortal>
                  <GenerateRegionOverlay
                    moduleName={view.moduleName}
                    regions={regions}
                    nodes={nodes}
                    viewport={viewport}
                    setNodes={setNodes}
                    setRegions={setRegions}
                  />
                </ViewportPortal>
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

type RegionDragSide = 'left' | 'right' | 'top' | 'bottom';

interface RegionDragState {
  kind: 'move' | 'resize';
  regionId: string;
  side?: RegionDragSide;
  startClientX: number;
  startClientY: number;
  startRegions: PositionedGenerateRegion[];
  startNodes: HdlFlowNode[];
  affectedRegionIds: Set<string>;
  affectedNodeIds: Set<string>;
}

function GenerateRegionOverlay({
  moduleName,
  regions,
  nodes,
  viewport,
  setNodes,
  setRegions
}: {
  moduleName: string;
  regions: PositionedGenerateRegion[];
  nodes: HdlFlowNode[];
  viewport: FlowViewport;
  setNodes: (nodes: HdlFlowNode[] | ((nodes: HdlFlowNode[]) => HdlFlowNode[])) => void;
  setRegions: React.Dispatch<React.SetStateAction<PositionedGenerateRegion[]>>;
}): React.ReactElement | null {
  const dragRef = useRef<RegionDragState | null>(null);

  const startDrag = useCallback((event: React.PointerEvent, region: PositionedGenerateRegion, kind: RegionDragState['kind'], side?: RegionDragSide) => {
    event.preventDefault();
    event.stopPropagation();
    const affectedRegionIds = kind === 'move'
      ? descendantRegionIds(region.id, regions, true)
      : new Set([region.id]);
    const affectedNodeIds = kind === 'move'
      ? nodeIdsForRegions(affectedRegionIds, regions)
      : new Set<string>();
    dragRef.current = {
      kind,
      regionId: region.id,
      side,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRegions: regions.map((item) => ({ ...item, bounds: { ...item.bounds } })),
      startNodes: nodes.map((node) => ({
        ...node,
        position: { ...node.position },
        data: {
          ...node.data,
          node: { ...node.data.node, position: { ...node.data.node.position } }
        }
      })),
      affectedRegionIds,
      affectedNodeIds
    };
  }, [nodes, regions]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const update = applyRegionDrag(drag, event.clientX, event.clientY, viewport.zoom || 1);
      setRegions(update.regions);
      setNodes(update.nodes);
    };

    const onPointerUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      const update = applyRegionDrag(drag, event.clientX, event.clientY, viewport.zoom || 1);
      setRegions(update.regions);
      setNodes(update.nodes);

      const fixedRegions = update.regions.map((region) => ({
        ...region,
        fixed: region.fixed || drag.affectedRegionIds.has(region.id)
      }));

      if (drag.kind === 'resize') {
        vscode.postMessage({ type: 'regionLayoutChanged', moduleName, regions: fixedRegions });
        return;
      }

      const positioned = flowNodesToPositioned(update.nodes, drag.affectedNodeIds);
      vscode.postMessage({ type: 'layoutChanged', moduleName, nodes: positioned, regions: fixedRegions });
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [moduleName, setNodes, setRegions, viewport.zoom]);

  if (regions.length === 0) return null;

  return (
    <div className="generate-region-layer">
      {regions.map((region) => (
        <div
          key={region.id}
          className={[
            'generate-region',
            region.activeState === 'active' ? 'generate-region-active' : '',
            region.activeState === 'inactive' ? 'generate-region-inactive' : '',
            region.invalid ? 'generate-region-invalid' : ''
          ].filter(Boolean).join(' ')}
          data-region-id={region.id}
          data-region-kind={region.kind}
          data-warning-note={region.warningNote || undefined}
          style={{
            left: region.bounds.x,
            top: region.bounds.y,
            width: region.bounds.width,
            height: region.bounds.height
          }}
        >
          <div className="generate-region-outline" />
          {region.warningNote && (
            <Tooltip content={region.warningNote}>
              {(trigger) => (
                <span
                  {...trigger}
                  className="generate-region-warning"
                  role="img"
                  aria-label={region.warningNote}
                >
                  ⚠
                </span>
              )}
            </Tooltip>
          )}
          <button
            type="button"
            className="generate-region-title"
            onPointerDown={(event) => startDrag(event, region, 'move')}
            title={region.label}
          >
            {region.label}
          </button>
          {(['left', 'right', 'top', 'bottom'] as const).map((side) => (
            <button
              key={side}
              type="button"
              aria-label={`Resize ${region.label} ${side}`}
              className={`generate-region-resize generate-region-resize-${side}`}
              onPointerDown={(event) => startDrag(event, region, 'resize', side)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function applyRegionDrag(drag: RegionDragState, clientX: number, clientY: number, zoom: number): { regions: PositionedGenerateRegion[]; nodes: HdlFlowNode[] } {
  const dx = snapDelta((clientX - drag.startClientX) / Math.max(zoom, 0.01));
  const dy = snapDelta((clientY - drag.startClientY) / Math.max(zoom, 0.01));

  if (drag.kind === 'resize') {
    const nodes = drag.startNodes;
    const regions = drag.startRegions.map((region) => {
      if (region.id !== drag.regionId) return region;
      return {
        ...region,
        bounds: resizeRegionBounds(region.bounds, drag.side!, dx, dy, drag)
      };
    });
    return {
      nodes,
      regions: annotateRegionsForFlowNodes(regions, nodes)
    };
  }

  const nodes = drag.startNodes.map((node) => {
    if (!drag.affectedNodeIds.has(node.id)) return node;
    const position = {
      x: node.position.x + dx,
      y: node.position.y + dy
    };
    return {
      ...node,
      position,
      data: {
        ...node.data,
        node: {
          ...node.data.node,
          position
        }
      }
    };
  });
  const regions = drag.startRegions.map((region) => {
    if (!drag.affectedRegionIds.has(region.id)) return region;
    return {
      ...region,
      bounds: {
        ...region.bounds,
        x: region.bounds.x + dx,
        y: region.bounds.y + dy
      }
    };
  });

  return {
    nodes,
    regions: annotateRegionsForFlowNodes(regions, nodes)
  };
}

function resizeRegionBounds(
  bounds: PositionedGenerateRegion['bounds'],
  side: RegionDragSide,
  dx: number,
  dy: number,
  drag: RegionDragState
): PositionedGenerateRegion['bounds'] {
  const minWidth = diagramSizing.gridSize * 8;
  const minHeight = diagramSizing.gridSize * 4;
  const inset = GENERATE_REGION_MIN_CONTENT_PADDING;
  const content = resizeContentBounds(drag.regionId, drag.startRegions, drag.startNodes);
  let next = { ...bounds };

  if (side === 'left') {
    const right = bounds.x + bounds.width;
    next.x = Math.min(bounds.x + dx, right - minWidth);
    if (content) next.x = Math.min(next.x, content.x - inset);
    next.width = right - next.x;
  } else if (side === 'right') {
    next.width = Math.max(minWidth, bounds.width + dx);
    if (content) next.width = Math.max(next.width, content.x + content.width + inset - bounds.x);
  } else if (side === 'top') {
    const bottom = bounds.y + bounds.height;
    next.y = Math.min(bounds.y + dy, bottom - minHeight);
    if (content) next.y = Math.min(next.y, content.y - inset);
    next.height = bottom - next.y;
  } else {
    next.height = Math.max(minHeight, bounds.height + dy);
    if (content) next.height = Math.max(next.height, content.y + content.height + inset - bounds.y);
  }

  return snapRegionBounds(next);
}

function resizeContentBounds(regionId: string, regions: PositionedGenerateRegion[], nodes: HdlFlowNode[]): PositionedGenerateRegion['bounds'] | undefined {
  const descendantIds = descendantRegionIds(regionId, regions, false);
  const nodeIds = nodeIdsForRegions(new Set([regionId, ...descendantIds]), regions);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const rects: PositionedGenerateRegion['bounds'][] = [];

  for (const nodeId of nodeIds) {
    const node = nodeById.get(nodeId);
    if (!node) continue;
    const size = diagramNodeDimensions(node.data.node);
    rects.push({ x: node.position.x, y: node.position.y, width: size.width, height: size.height });
  }
  for (const region of regions) {
    if (descendantIds.has(region.id)) rects.push(region.bounds);
  }
  return unionRegionBounds(rects);
}

function descendantRegionIds(regionId: string, regions: PositionedGenerateRegion[], includeSelf: boolean): Set<string> {
  const result = new Set<string>(includeSelf ? [regionId] : []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const region of regions) {
      if (!region.parentRegionId || result.has(region.id)) continue;
      if (region.parentRegionId === regionId || result.has(region.parentRegionId)) {
        result.add(region.id);
        changed = true;
      }
    }
  }
  return result;
}

function nodeIdsForRegions(regionIds: Set<string>, regions: PositionedGenerateRegion[]): Set<string> {
  const nodeIds = new Set<string>();
  for (const region of regions) {
    if (!regionIds.has(region.id)) continue;
    for (const nodeId of region.nodeIds) nodeIds.add(nodeId);
  }
  return nodeIds;
}

function flowNodesToPositioned(nodes: HdlFlowNode[], fixedIds: Set<string>): PositionedNode[] {
  return nodes.map((node) => ({
    ...node.data.node,
    position: node.position,
    fixed: node.data.node.fixed || node.selected || fixedIds.has(node.id)
  }));
}

function mergeDraggedFlowNodes(nodes: HdlFlowNode[], draggedNodes: HdlFlowNode[]): HdlFlowNode[] {
  const draggedById = new Map(draggedNodes.map((node) => [node.id, node]));
  const merged = nodes.map((node) => draggedById.get(node.id) ?? node);
  const seen = new Set(merged.map((node) => node.id));
  for (const dragged of draggedNodes) {
    if (!seen.has(dragged.id)) {
      merged.push(dragged);
    }
  }
  return merged;
}

function annotateRegionsForFlowNodes(regions: PositionedGenerateRegion[], nodes: HdlFlowNode[]): PositionedGenerateRegion[] {
  return annotateGenerateRegionWarnings(regions, flowNodesToPositioned(nodes, new Set()));
}

function expandRegionsForNodes(regions: PositionedGenerateRegion[], nodes: PositionedNode[]): PositionedGenerateRegion[] {
  if (regions.length === 0) return regions;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const expanded = regions.map((region) => {
    const regionIds = descendantRegionIds(region.id, regions, true);
    const nodeIds = nodeIdsForRegions(regionIds, regions);
    const content = unionRegionBounds(Array.from(nodeIds)
      .map((nodeId) => {
        const node = nodeById.get(nodeId);
        if (!node) return undefined;
        const size = diagramNodeDimensions(node);
        return {
          x: node.position.x - GENERATE_REGION_MIN_CONTENT_PADDING,
          y: node.position.y - GENERATE_REGION_MIN_CONTENT_PADDING,
          width: size.width + GENERATE_REGION_MIN_CONTENT_PADDING * 2,
          height: size.height + GENERATE_REGION_MIN_CONTENT_PADDING * 2
        };
      })
      .filter((bounds): bounds is PositionedGenerateRegion['bounds'] => bounds !== undefined));
    if (!content) return region;
    return {
      ...region,
      bounds: snapRegionBounds({
        x: Math.min(region.bounds.x, content.x),
        y: Math.min(region.bounds.y, content.y),
        width: Math.max(region.bounds.x + region.bounds.width, content.x + content.width) - Math.min(region.bounds.x, content.x),
        height: Math.max(region.bounds.y + region.bounds.height, content.y + content.height) - Math.min(region.bounds.y, content.y)
      }),
      fixed: region.fixed
    };
  });
  return annotateGenerateRegionWarnings(expanded, nodes);
}

function unionRegionBounds(rects: PositionedGenerateRegion['bounds'][]): PositionedGenerateRegion['bounds'] | undefined {
  if (rects.length === 0) return undefined;
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function snapDelta(value: number): number {
  return Math.round(value / diagramSizing.gridSize) * diagramSizing.gridSize;
}

function snapRegionBounds(bounds: PositionedGenerateRegion['bounds']): PositionedGenerateRegion['bounds'] {
  const grid = diagramSizing.gridSize;
  const x = Math.round(bounds.x / grid) * grid;
  const y = Math.round(bounds.y / grid) * grid;
  const width = Math.max(grid * 8, Math.round(bounds.width / grid) * grid);
  const height = Math.max(grid * 4, Math.round(bounds.height / grid) * grid);
  return { x, y, width, height };
}

createRoot(document.getElementById('root')!).render(<App />);
