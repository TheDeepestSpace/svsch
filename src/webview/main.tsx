import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Background,
  Controls,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  useReactFlow,
  useEdgesState,
  useNodesState
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { diagramSizing, normalizeWidth } from '../diagram/constants';
import { diagramNodeDimensions } from '../diagram/nodeSizing';
import { OrthogonalEdge, type RouteChange } from './orthogonal';
import { LineJumpProvider } from './react-flow-line-jumps';
import type {
  DiagramViewModel,
  DiagramEdge
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
      zIndex: nodeIsArrayNode(node) ? ARRAY_NODE_Z_INDEX : BLOCK_NODE_Z_INDEX,
      data: { node, moduleName: view.moduleName, arrayConnections: arrayConnectionsByNode.get(node.id) ?? [] }
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
    (_: React.MouseEvent, dragged: HdlFlowNode) => {
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
    [handleRouteChange]
  );

  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, dragged: HdlFlowNode, allNodes: HdlFlowNode[]) => {
      if (!view) {
        return;
      }
      const positioned = allNodes.map((node) => ({
        ...node.data.node,
        position: node.id === dragged.id ? dragged.position : node.position,
        fixed: node.data.node.fixed || node.selected || node.id === dragged.id
      }));
      vscode.postMessage({ type: 'layoutChanged', moduleName: view.moduleName, nodes: positioned });

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
    [view, handleRouteChange]
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
                }}
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
