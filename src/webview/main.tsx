import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  useNodesState,
  useStore
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { diagramSizing, normalizeWidth } from '../diagram/constants';
import { diagramNodeDimensions } from '../diagram/nodeSizing';
import {
  annotateGenerateRegionWarnings,
  findExternalBlockIds,
  GENERATE_REGION_EXTERNAL_BLOCK_WARNING
} from '../layout/generateRegionValidation';
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
import { compareEdgePaintOrder } from '../diagram/edgePaintOrder';
import { nodeIsArrayNode } from '../ir/nodeMetadata';
import { edgeIsThick } from '../ir/edgeStyle';
import { HdlNode } from './nodes/HdlNode';
import { MiniMapNode } from './nodes/MiniMapNode';
import { InteractionContext, type SelectionAction } from './nodes/shared/context';
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
// A cut net's stub wire is always short and runs from a node straight out to
// its own dangling end, so it never has a real edge's usual clearance from
// node interiors — draw it (and its hover-only Reroute control) above nodes
// so it stays visible, and clickable, when it lands close to one.
const CUT_STUB_EDGE_Z_INDEX = 3;
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

// The React Flow MiniMap has no slot for extra SVG content, so we inject a group of
// generate/arm region outlines directly into its <svg>. The minimap svg's viewBox is in
// flow coordinates, so region bounds map straight in and track node moves automatically.
function MiniMapRegionOutlines({ regions }: { regions: PositionedGenerateRegion[] }): null {
  useEffect(() => {
    const svg = document.querySelector('.svsch-minimap .react-flow__minimap-svg');
    if (!svg) return;
    const ns = 'http://www.w3.org/2000/svg';
    const group = document.createElementNS(ns, 'g');
    group.setAttribute('class', 'svsch-minimap-regions');
    for (const region of regions) {
      const rect = document.createElementNS(ns, 'rect');
      rect.setAttribute('x', String(region.bounds.x));
      rect.setAttribute('y', String(region.bounds.y));
      rect.setAttribute('width', String(region.bounds.width));
      rect.setAttribute('height', String(region.bounds.height));
      rect.setAttribute(
        'class',
        [
          'svsch-minimap-region',
          region.isGenerateBlock ? 'svsch-minimap-region-block' : 'svsch-minimap-region-arm',
          region.invalid ? 'svsch-minimap-region-invalid' : ''
        ].filter(Boolean).join(' ')
      );
      group.appendChild(rect);
    }
    svg.appendChild(group);
    return () => {
      group.parentNode?.removeChild(group);
    };
  }, [regions]);
  return null;
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
  // Portal target for floating controls that must paint above node bodies —
  // see InteractionContext.overlayPortalNode for why this is kept separate
  // from react-flow's own ViewportPortal.
  const [overlayPortalNode, setOverlayPortalNode] = useState<HTMLDivElement | null>(null);
  const groupDragRef = useRef<{
    startPos: { x: number; y: number };
    originalRoutes: Map<string, Array<{ x: number; y: number }>>;
    // Region bounds at drag start, so marquee-selected regions can translate with
    // the dragged selection instead of merely stretching around their nodes.
    startRegions: PositionedGenerateRegion[];
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
  const minZoom = useStore((state) => state.minZoom);
  const maxZoom = useStore((state) => state.maxZoom);
  const userSelectionRect = useStore((state) => state.userSelectionRect);
  const [selectedRegionIds, setSelectedRegionIds] = useState<Set<string>>(new Set());
  const fittedModuleNameRef = useRef<string | undefined>(undefined);
  // Node ids to re-select in the very next view rebuild — set right before
  // posting an "Auto Layout" request, consumed (and cleared) the next time
  // the nodes array is rebuilt from an incoming view, so the just-relaid-out
  // blocks stay selected instead of losing selection on the round-trip.
  const pendingReselectIdsRef = useRef<Set<string> | null>(null);

  // Marquee (drag) selection also selects generate regions. A region is selected
  // when its bounds are fully inside the selection rectangle — full containment, so
  // an arm can be selected without always dragging in its surrounding generate block
  // (whose bounds any marquee over the arm would partially overlap).
  useEffect(() => {
    if (!userSelectionRect) return;
    const zoom = Math.max(viewport.zoom || 1, 0.01);
    const rect = {
      x: (userSelectionRect.x - viewport.x) / zoom,
      y: (userSelectionRect.y - viewport.y) / zoom,
      width: userSelectionRect.width / zoom,
      height: userSelectionRect.height / zoom
    };
    const inside = new Set(regions
      .filter((region) => (
        region.bounds.x >= rect.x &&
        region.bounds.y >= rect.y &&
        region.bounds.x + region.bounds.width <= rect.x + rect.width &&
        region.bounds.y + region.bounds.height <= rect.y + rect.height
      ))
      .map((region) => region.id));
    setSelectedRegionIds((current) => {
      if (current.size === inside.size && [...inside].every((id) => current.has(id))) return current;
      return inside;
    });
  }, [userSelectionRect, regions, viewport]);

  const clearRegionSelection = useCallback(() => {
    setSelectedRegionIds((current) => (current.size === 0 ? current : new Set()));
  }, []);

  // Single-click/drag selection of a region, mirroring node click behavior: the
  // clicked region becomes the sole selection and any selected nodes are dropped.
  const selectRegion = useCallback((regionId: string) => {
    setSelectedRegionIds(new Set([regionId]));
    setNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        if (!node.selected) return node;
        changed = true;
        return { ...node, selected: false };
      });
      return changed ? next : current;
    });
  }, [setNodes]);

  // React Flow's built-in double-click zoom fires for any double-click inside the
  // pane, including ones that navigate to source (nodes, edges, generate region
  // titles). It is disabled and re-implemented here for empty-canvas double-clicks
  // only, keeping d3's behavior: zoom ×2 centered on the cursor, shift to zoom out.
  const handleCanvasDoubleClick = useCallback((event: React.MouseEvent) => {
    const target = event.target as Element;
    if (!target.closest('.react-flow__pane')) return;
    if (target.closest('.react-flow__node, .react-flow__edge, .generate-region')) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const current = reactFlow.getViewport();
    const zoom = Math.min(maxZoom, Math.max(minZoom, current.zoom * (event.shiftKey ? 0.5 : 2)));
    if (zoom === current.zoom) return;
    const pointerX = event.clientX - bounds.left;
    const pointerY = event.clientY - bounds.top;
    const scale = zoom / current.zoom;
    void reactFlow.setViewport({
      x: pointerX - (pointerX - current.x) * scale,
      y: pointerY - (pointerY - current.y) * scale,
      zoom
    }, { duration: 250 });
  }, [reactFlow, minZoom, maxZoom]);
  const [hoveredNetKey, setHoveredNetKey] = useState<string | undefined>();
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const externalOverlapNodeIdsRef = useRef<Set<string>>(new Set());
  const [selectionHoverActive, setSelectionHoverActive] = useState(false);
  const [pendingSelectionAction, setPendingSelectionAction] = useState<SelectionAction | undefined>();

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

  // Flag blocks that overlap a generate arm they don't belong to (or are marked
  // invalid by the view) so React Flow renders the shared error outline on them.
  useEffect(() => {
    const invalidIds = findExternalBlockIds(regions, flowNodesToPositioned(nodes, new Set()));
    setNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        const dynamicExternalIds = externalOverlapNodeIdsRef.current;
        const isExternalOverlap = invalidIds.has(node.id);
        const hadExternalOverlapWarning = dynamicExternalIds.has(node.id);
        const keepExistingInvalid = Boolean(node.data.node.invalid) && !hadExternalOverlapWarning;
        const wantInvalid = keepExistingInvalid || isExternalOverlap;
        const warningNote = isExternalOverlap
          ? GENERATE_REGION_EXTERNAL_BLOCK_WARNING
          : hadExternalOverlapWarning
            ? undefined
            : node.data.node.warningNote;
        if (isExternalOverlap) {
          dynamicExternalIds.add(node.id);
        } else {
          dynamicExternalIds.delete(node.id);
        }
        const base = generateStateClass(node.data.node.metadata?.generateActiveState, 'generate-node');
        const className = [base, wantInvalid ? 'svsch-node-invalid' : ''].filter(Boolean).join(' ') || undefined;
        const invalid = wantInvalid || undefined;
        const dataNode = (node.data.node.invalid === invalid && node.data.node.warningNote === warningNote)
          ? node.data.node
          : { ...node.data.node, invalid, warningNote };
        if ((node.className || undefined) === className && dataNode === node.data.node) return node;
        changed = true;
        return { ...node, className, data: { ...node.data, node: dataNode } };
      });
      return changed ? next : current;
    });
  }, [regions, nodes, setNodes]);

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
      // Ports synthesized from procedural code (register/mux ports built from
      // always_ff/case blocks) don't always carry a reliable width of their
      // own, so thickness is derived from the edge (both endpoints) rather
      // than the local port alone.
      const thick = edgeIsThick(edge, sourceNode, targetNode);
      if (sourceIsArray) {
        addArrayConnection(edge.source, { portId: edge.sourcePort, role: 'source', thick });
        addArrayConnection(edge.target, { portId: edge.targetPort, role: 'target', thick });
      }
      if (targetIsArray) {
        addArrayConnection(edge.target, { portId: edge.targetPort, role: 'target', thick });
      }
    });

    const reselectIds = pendingReselectIdsRef.current;
    pendingReselectIdsRef.current = null;
    setNodes(view.nodes.map((node) => ({
      id: node.id,
      type: 'hdl',
      position: node.position,
      selected: reselectIds?.has(node.id) ?? undefined,
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

    const sortedEdges = [...view.edges].sort(compareEdgePaintOrder);
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
        zIndex: edge.metadata?.cutStub ? CUT_STUB_EDGE_Z_INDEX : EDGE_Z_INDEX,
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

  const updateNodeInternals = useStore((s) => s.updateNodeInternals);

  // React Flow only learns a node's handle positions (and therefore whether an edge
  // can be drawn at all) from a ResizeObserver callback that fires on its own,
  // browser-scheduled timing after the node's DOM mounts. Under a busy/CPU-starved
  // renderer that callback can be delayed well beyond a single frame, during which
  // no `.react-flow__edge` element exists even though our node/edge data is already
  // complete. Since node/handle geometry is already valid the instant the DOM commits
  // (layout doesn't require a paint), measure it ourselves synchronously in a layout
  // effect — calling the same internal update the ResizeObserver would — instead of
  // waiting for that observer to get a turn.
  useLayoutEffect(() => {
    if (nodes.length === 0) return;
    const nodeElems = document.querySelectorAll('.react-flow__node');
    if (nodeElems.length === 0) return;
    const elementById = new Map<string, Element>();
    nodeElems.forEach((el) => {
      const id = el.getAttribute('data-id');
      if (id) elementById.set(id, el);
    });
    const updates = new Map<string, { id: string; nodeElement: HTMLDivElement; force: boolean }>();
    nodes.forEach((node) => {
      const el = elementById.get(node.id);
      if (el) updates.set(node.id, { id: node.id, nodeElement: el as HTMLDivElement, force: true });
    });
    if (updates.size > 0) {
      updateNodeInternals(updates);
    }
  }, [nodes, updateNodeInternals]);

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
      // Dragging an unselected node drops the node selection (React Flow behavior);
      // drop the region selection with it.
      if (!dragged.selected) clearRegionSelection();
      const movedIds = new Set(allNodes.map((n) => n.id));
      if (movedIds.size < 2 && !(dragged.selected && selectedRegionIds.size > 0)) return;
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
        startRegions: regionsRef.current.map((region) => ({ ...region, bounds: { ...region.bounds } })),
      };
    },
    [edges, clearRegionSelection, selectedRegionIds]
  );

  const onNodeDrag = useCallback(
    (_: React.MouseEvent, dragged: HdlFlowNode, allNodes: HdlFlowNode[] = [dragged]) => {
      const movedNodes = allNodes.length > 0 ? allNodes : [dragged];
      const allFlowNodes = mergeDraggedFlowNodes(reactFlow.getNodes() as HdlFlowNode[], movedNodes);
      const positioned = flowNodesToPositioned(allFlowNodes, new Set(movedNodes.map((node) => node.id)));
      const state = groupDragRef.current;
      const dx = state ? dragged.position.x - state.startPos.x : 0;
      const dy = state ? dragged.position.y - state.startPos.y : 0;
      setRegions((current) => {
        const base = state && dragged.selected && selectedRegionIds.size > 0
          ? translateRegions(state.startRegions, selectedRegionIds, dx, dy)
          : current;
        return expandRegionsForNodes(base, positioned);
      });

      if (!state || state.originalRoutes.size === 0) return;
      const changes = Array.from(state.originalRoutes.entries()).map(([edgeId, pts]) => ({
        edgeId,
        routePoints: pts.map((pt) => ({ x: pt.x + dx, y: pt.y + dy }))
      }));
      handleRouteChange(changes, false);
    },
    [handleRouteChange, reactFlow, selectedRegionIds]
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
      const state = groupDragRef.current;
      groupDragRef.current = null;
      const dx = state ? dragged.position.x - state.startPos.x : 0;
      const dy = state ? dragged.position.y - state.startPos.y : 0;
      const translatesRegions = Boolean(state) && dragged.selected && selectedRegionIds.size > 0;
      const baseRegions = translatesRegions && state
        ? translateRegions(state.startRegions, selectedRegionIds, dx, dy)
        : regionsRef.current;
      const expandedRegions = expandRegionsForNodes(baseRegions, positioned).map((region) => (
        translatesRegions && selectedRegionIds.has(region.id) ? { ...region, fixed: true } : region
      ));
      setRegions(expandedRegions);
      vscode.postMessage({ type: 'layoutChanged', moduleName: view.moduleName, nodes: positioned, regions: expandedRegions });

      if (!state || state.originalRoutes.size === 0) return;

      if (dx === 0 && dy === 0) return;

      const changes = Array.from(state.originalRoutes.entries()).map(([edgeId, pts]) => ({
        edgeId,
        routePoints: pts.map((pt) => ({ x: pt.x + dx, y: pt.y + dy }))
      }));
      handleRouteChange(changes, true);
    },
    [view, handleRouteChange, reactFlow, selectedRegionIds]
  );

  const rerouteLayout = useCallback(() => {
    if (!view) {
      return;
    }
    const positioned = nodes.map((node) => ({
      ...node.data.node,
      position: node.position,
      // "Reroute All" freezes every real block in place — a net-cut label
      // that's still tracking its port dynamically must not be forced fixed
      // just because it happened to be on screen.
      fixed: node.data.node.kind === 'netLabel' ? node.data.node.fixed : true
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
        <div className="status-indicator">
          {status === 'rebuilding' ? (
            <div className="busy-indicator" role="status" aria-live="polite">
              <span />
              Updating
            </div>
          ) : view.diagnostics.length > 0 ? (
            <Tooltip
              content={`${view.diagnostics.length} warning${view.diagnostics.length === 1 ? '' : 's'}`}
            >
              {(trigger) => (
                <div
                  {...trigger}
                  className="diagnostics-indicator"
                  role="status"
                  aria-label={`${view.diagnostics.length} warning${view.diagnostics.length === 1 ? '' : 's'}`}
                >
                  ⚠
                </div>
              )}
            </Tooltip>
          ) : null}
        </div>
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
        <main className="canvas" key={view.moduleName}>
          <ModuleParameterTable moduleName={view.moduleName} parameters={view.parameters} />
          <InteractionContext.Provider value={{
            hoveredNetKey,
            setHovered,
            selectionHoverActive,
            setSelectionHoverActive,
            pendingSelectionAction,
            setPendingSelectionAction,
            overlayPortalNode
          }}>
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
                onSelectionDragStart={(event: React.MouseEvent, dragNodes: HdlFlowNode[]) => {
                  if (dragNodes.length > 0) onNodeDragStart(event, dragNodes[0], dragNodes);
                }}
                onSelectionDrag={(event: React.MouseEvent, dragNodes: HdlFlowNode[]) => {
                  if (dragNodes.length > 0) onNodeDrag(event, dragNodes[0], dragNodes);
                }}
                onSelectionDragStop={(event: React.MouseEvent, dragNodes: HdlFlowNode[]) => {
                  if (dragNodes.length > 0) onNodeDragStop(event, dragNodes[0], dragNodes);
                }}
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
                zoomOnDoubleClick={false}
                onDoubleClick={handleCanvasDoubleClick}
                onPaneClick={clearRegionSelection}
                onNodeClick={clearRegionSelection}
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
                    edges={edges}
                    viewport={viewport}
                    setNodes={setNodes}
                    setRegions={setRegions}
                    onRouteChange={handleRouteChange}
                    selectedRegionIds={selectedRegionIds}
                    selectRegion={selectRegion}
                  />
                </ViewportPortal>
                {/* Rendered as a plain react-flow child (like MiniMap/Controls below), not
                    through ViewportPortal — that portal is shared with GenerateRegionOverlay
                    above, which must stay beneath node bodies, while floating controls like
                    the selection toolbar need to paint above them. Its own inline transform
                    (see the style prop) reproduces react-flow's pan/zoom so flow-space
                    coordinates still work for anything portaled into it. */}
                <div
                  ref={setOverlayPortalNode}
                  className="svsch-overlay-portal-root"
                  style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}
                />
                <NodeSelectionToolbar
                  moduleName={view.moduleName}
                  nodes={nodes}
                  edges={edges}
                  pendingReselectIdsRef={pendingReselectIdsRef}
                />
                <MiniMap
                  pannable
                  zoomable
                  className="svsch-minimap"
                  nodeComponent={MiniMapNode}
                />
                <MiniMapRegionOutlines regions={regions} />
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
  // Route waypoints of edges internal to the moved arm, captured at drag start so
  // they can be translated together with the blocks they connect.
  startRoutes: Map<string, Array<{ x: number; y: number }>>;
}

function GenerateRegionOverlay({
  moduleName,
  regions,
  nodes,
  edges,
  viewport,
  setNodes,
  setRegions,
  onRouteChange,
  selectedRegionIds,
  selectRegion
}: {
  moduleName: string;
  regions: PositionedGenerateRegion[];
  nodes: HdlFlowNode[];
  edges: Edge[];
  viewport: FlowViewport;
  setNodes: (nodes: HdlFlowNode[] | ((nodes: HdlFlowNode[]) => HdlFlowNode[])) => void;
  setRegions: React.Dispatch<React.SetStateAction<PositionedGenerateRegion[]>>;
  onRouteChange: (changes: RouteChange[], commit: boolean) => void;
  selectedRegionIds: Set<string>;
  selectRegion: (regionId: string) => void;
}): React.ReactElement | null {
  const dragRef = useRef<RegionDragState | null>(null);

  const startDrag = useCallback((event: React.PointerEvent, region: PositionedGenerateRegion, kind: RegionDragState['kind'], side?: RegionDragSide) => {
    event.preventDefault();
    event.stopPropagation();
    // Interacting with a selected region moves the whole selection; interacting with
    // an unselected one selects just it (mirrors React Flow's node behavior — a
    // click or drag highlights the region with the standard selection border).
    const moveRoots = kind === 'move' && selectedRegionIds.has(region.id)
      ? [...selectedRegionIds]
      : [region.id];
    if (!selectedRegionIds.has(region.id)) selectRegion(region.id);
    const affectedRegionIds = kind === 'move'
      ? new Set(moveRoots.flatMap((rootId) => [...descendantRegionIds(rootId, regions, true)]))
      : new Set([region.id]);
    const affectedNodeIds = kind === 'move'
      ? nodeIdsForRegions(affectedRegionIds, regions)
      : new Set<string>();
    const startRoutes = new Map<string, Array<{ x: number; y: number }>>();
    if (kind === 'move') {
      for (const edge of edges) {
        const pts = edge.data?.routePoints as Array<{ x: number; y: number }> | undefined;
        if (affectedNodeIds.has(edge.source) && affectedNodeIds.has(edge.target) && pts && pts.length > 0) {
          startRoutes.set(edge.id, pts.map((pt) => ({ ...pt })));
        }
      }
    }
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
      affectedNodeIds,
      startRoutes
    };
  }, [edges, nodes, regions, selectedRegionIds, selectRegion]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const update = applyRegionDrag(drag, event.clientX, event.clientY, viewport.zoom || 1);
      setRegions(update.regions);
      setNodes(update.nodes);
      applyRegionDragRoutes(drag, event.clientX, event.clientY, viewport.zoom || 1, onRouteChange, false);
    };

    const onPointerUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      const zoom = Math.max(viewport.zoom || 1, 0.01);
      const update = applyRegionDrag(drag, event.clientX, event.clientY, viewport.zoom || 1);
      setRegions(update.regions);
      setNodes(update.nodes);

      // A zero-delta drag is just a (double-)click on the title or a handle — don't
      // commit it, or the region's auto-laid-out nodes would be pinned as fixed and
      // the rest of the diagram would reflow around them.
      const dx = snapDelta((event.clientX - drag.startClientX) / zoom);
      const dy = snapDelta((event.clientY - drag.startClientY) / zoom);
      if (dx === 0 && dy === 0) return;

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
      applyRegionDragRoutes(drag, event.clientX, event.clientY, viewport.zoom || 1, onRouteChange, true);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [moduleName, onRouteChange, setNodes, setRegions, viewport.zoom]);

  if (regions.length === 0) return null;

  return (
    <div className="generate-region-layer">
      {[...regions]
        .sort((a, b) => (a.isGenerateBlock ? 0 : 1) - (b.isGenerateBlock ? 0 : 1))
        .map((region) => (
        <div
          key={region.id}
          className={[
            'generate-region',
            region.isGenerateBlock ? 'generate-block' : '',
            region.activeState === 'active' ? 'generate-region-active' : '',
            region.activeState === 'inactive' ? 'generate-region-inactive' : '',
            region.invalid ? 'generate-region-invalid' : '',
            selectedRegionIds.has(region.id) ? 'generate-region-selected' : ''
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
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={() => {
              const msg = {
                type: 'navigateToRegion',
                region: {
                  kind: region.kind,
                  isGenerateBlock: region.isGenerateBlock,
                  source: region.source,
                  bodySource: region.bodySource
                }
              } as const;
              console.log('NAVIGATE:', JSON.stringify(msg));
              vscode.postMessage(msg);
            }}
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
              onClick={(event) => event.stopPropagation()}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// Floating toolbar shown above the bounding box of a block selection. "Auto
// Layout" only makes sense once there's more than one block to re-place, but
// "Cut out" is useful for a lone block too, so it appears from a single
// selected block onward — as long as at least one connection remains to cut.
//
// Auto Layout: releases just the selected blocks (and the routes of any edge
// touching one of them) back to ELK's auto-layout — using their current
// positions as placement hints, so they tend to settle nearby unless the area
// is genuinely congested — while every other block and edge in the diagram
// stays exactly where it is (they're sent back fixed, the same freezing
// mergeRerouteLayout already relies on for "Reroute All").
//
// Portals into overlayPortalNode rather than rendering inline: it needs to
// paint above node bodies, but it's positioned in flow-space (bounds.right/
// bottom), so it still needs the pan/zoom transform a raw fixed-position
// overlay wouldn't have. overlayPortalNode carries that transform itself
// (see main.tsx's render) instead of react-flow's ViewportPortal, which is
// reserved for GenerateRegionOverlay — that overlay's translucent region
// fill must stay beneath nodes, so it can't share a stacking tier with a
// control that needs the opposite.
function NodeSelectionToolbar({
  moduleName,
  nodes,
  edges,
  pendingReselectIdsRef
}: {
  moduleName: string;
  nodes: HdlFlowNode[];
  edges: Edge[];
  pendingReselectIdsRef: React.MutableRefObject<Set<string> | null>;
}): React.ReactElement | null {
  const { overlayPortalNode } = useContext(InteractionContext);

  // A cut net's dangling end is a synthetic `netLabel` node, not a real block —
  // selecting (or merely clicking through to) one shouldn't surface a toolbar
  // whose actions only make sense for actual block selections.
  const selected = useMemo(
    () => nodes.filter((node) => node.selected && node.data.node.kind !== 'netLabel'),
    [nodes]
  );

  // Every non-cut-stub edge touching any selected block — same exclusion
  // `selectedCuttableEdges` in OrthogonalEdge applies for the wire "Cut"
  // control, since a cut stub's dangling end can't be cut again.
  const cutOutEdges = useMemo(() => {
    const selectedIds = new Set(selected.map((node) => node.id));
    return edges.filter((edge) => {
      if (!selectedIds.has(edge.source) && !selectedIds.has(edge.target)) return false;
      const diagramEdge = (edge.data as { edge?: DiagramEdge } | undefined)?.edge;
      return diagramEdge !== undefined && diagramEdge.metadata?.cutStub === undefined;
    });
  }, [selected, edges]);

  // Nothing to offer: a lone block with every net already cut gets neither
  // control, so skip rendering the (now empty) toolbar entirely.
  if (!overlayPortalNode || selected.length < 1 || (selected.length < 2 && cutOutEdges.length === 0)) {
    return null;
  }

  const bounds = selected.reduce((acc, node) => {
    const size = diagramNodeDimensions(node.data.node);
    return {
      x: Math.min(acc.x, node.position.x),
      y: Math.min(acc.y, node.position.y),
      right: Math.max(acc.right, node.position.x + size.width),
      bottom: Math.max(acc.bottom, node.position.y + size.height)
    };
  }, { x: Infinity, y: Infinity, right: -Infinity, bottom: -Infinity });

  const handleClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    const selectedIds = new Set(selected.map((node) => node.id));
    // A cut net's dangling end is a `netLabel` node that ELK never places
    // directly — it's re-derived every render from the real block's current
    // port position. Selecting the real block already selects its stub edge
    // too (React Flow selects every edge touching a selected node), so pull
    // that edge's netLabel endpoint into the release set even when the
    // marquee never physically covered the label itself. A netLabel that's
    // neither selected nor attached to a selected stub edge is left alone.
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    for (const edge of edges) {
      if (edge.selected !== true) continue;
      const diagramEdge = (edge.data as { edge?: DiagramEdge } | undefined)?.edge;
      if (diagramEdge?.metadata?.cutStub === undefined) continue;
      for (const endpointId of [edge.source, edge.target]) {
        if (nodesById.get(endpointId)?.data.node.kind === 'netLabel') {
          selectedIds.add(endpointId);
        }
      }
    }
    const positioned = flowNodesToPositioned(nodes, new Set()).map((node) => ({
      ...node,
      // Released nodes go free; every other real block is frozen in place —
      // but an unrelated net-cut label that's still tracking its port
      // dynamically must not be forced fixed just because it's on screen.
      fixed: selectedIds.has(node.id) ? false : (node.kind === 'netLabel' ? node.fixed : true)
    }));
    // Consumed (and cleared) the next time the nodes array is rebuilt from an
    // incoming view, so these blocks stay selected across the round-trip
    // instead of losing selection once ELK re-places them.
    pendingReselectIdsRef.current = selectedIds;
    vscode.postMessage({
      type: 'relayoutSelection',
      moduleName,
      nodeIds: [...selectedIds],
      nodes: positioned
    });
  };

  // Cuts every wire touching any selected block in one action — the same
  // cutNet/cutNets message the wire "Cut" control posts, just with the edge
  // list assembled from the block selection instead of a wire selection.
  const handleCutOut = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (cutOutEdges.length === 0) return;
    const diagramEdges = cutOutEdges
      .map((edge) => (edge.data as { edge?: DiagramEdge } | undefined)?.edge)
      .filter((edge): edge is DiagramEdge => edge !== undefined);
    if (diagramEdges.length === 0) return;
    // Matches the wire "Cut" control's positionedNodesFromFlowNodes: every real
    // block is frozen in place, but a net-cut label keeps tracking its port
    // dynamically even if the marquee happened to select it too.
    const positioned = nodes.map((node) => ({
      ...node.data.node,
      position: node.position,
      fixed: node.data.node.kind === 'netLabel' ? node.data.node.fixed : true
    }));
    if (diagramEdges.length === 1) {
      vscode.postMessage({ type: 'cutNet', moduleName, edge: diagramEdges[0], nodes: positioned });
      return;
    }
    vscode.postMessage({ type: 'cutNets', moduleName, edges: diagramEdges, nodes: positioned });
  };

  return createPortal(
    <div className="svsch-selection-toolbar-layer">
      <div
        className="svsch-selection-toolbar"
        style={{ left: bounds.right, top: bounds.bottom }}
      >
        {selected.length >= 2 && (
          <button
            type="button"
            className="svsch-selection-relayout-control"
            title="Re-place and route the selected blocks; everything else stays put"
            onClick={handleClick}
            onDoubleClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            Auto Layout
          </button>
        )}
        {cutOutEdges.length > 0 && (
          <button
            type="button"
            className="svsch-selection-cutout-control"
            title={`Cut ${cutOutEdges.length} connection(s) on the selected block(s)`}
            onClick={handleCutOut}
            onDoubleClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
          >
            Cut out
          </button>
        )}
      </div>
    </div>,
    overlayPortalNode
  );
}

// Translate the arm's internal edge routes by the same delta as the blocks so the
// wires move with them instead of staying put.
function applyRegionDragRoutes(
  drag: RegionDragState,
  clientX: number,
  clientY: number,
  zoom: number,
  onRouteChange: (changes: RouteChange[], commit: boolean) => void,
  commit: boolean
): void {
  if (drag.kind !== 'move' || drag.startRoutes.size === 0) return;
  const dx = snapDelta((clientX - drag.startClientX) / Math.max(zoom, 0.01));
  const dy = snapDelta((clientY - drag.startClientY) / Math.max(zoom, 0.01));
  const changes: RouteChange[] = Array.from(drag.startRoutes.entries()).map(([edgeId, points]) => ({
    edgeId,
    routePoints: points.map((point) => ({ x: point.x + dx, y: point.y + dy }))
  }));
  onRouteChange(changes, commit);
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
      regions: expandRegionsForFlowNodes(regions, nodes)
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
    regions: expandRegionsForFlowNodes(regions, nodes)
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

// Expand (never shrink) each region to contain its moved/resized content, then annotate.
// Used while dragging an arm so its parent generate block grows to keep surrounding it.
function expandRegionsForFlowNodes(regions: PositionedGenerateRegion[], nodes: HdlFlowNode[]): PositionedGenerateRegion[] {
  return expandRegionsForNodes(regions, flowNodesToPositioned(nodes, new Set()));
}

// Shift the selected regions' bounds by the drag delta; the following expansion pass
// reconciles parents/children (e.g. a wrapper grows around a translated arm).
function translateRegions(
  regions: PositionedGenerateRegion[],
  selectedIds: Set<string>,
  dx: number,
  dy: number
): PositionedGenerateRegion[] {
  if (selectedIds.size === 0 || (dx === 0 && dy === 0)) return regions;
  return regions.map((region) => (selectedIds.has(region.id)
    ? { ...region, bounds: { ...region.bounds, x: region.bounds.x + dx, y: region.bounds.y + dy } }
    : region));
}

function expandRegionsForNodes(regions: PositionedGenerateRegion[], nodes: PositionedNode[]): PositionedGenerateRegion[] {
  if (regions.length === 0) return regions;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const regionById = new Map(regions.map((region) => [region.id, region]));
  const childRegionsByParent = new Map<string, PositionedGenerateRegion[]>();
  for (const region of regions) {
    const parent = region.parentRegionId && regionById.has(region.parentRegionId) ? region.parentRegionId : '';
    const list = childRegionsByParent.get(parent) ?? [];
    list.push(region);
    childRegionsByParent.set(parent, list);
  }

  const pad = GENERATE_REGION_MIN_CONTENT_PADDING;
  const padRect = (rect: PositionedGenerateRegion['bounds']): PositionedGenerateRegion['bounds'] => ({
    x: rect.x - pad,
    y: rect.y - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2
  });
  const expandedById = new Map<string, PositionedGenerateRegion>();

  // A region hugs its direct content (owned nodes and/or child regions) with one padding
  // ring, never shrinking. Bottom-up recursion makes wrappers hug their arm regions the
  // same way arms hug their leaf nodes.
  const expand = (region: PositionedGenerateRegion): PositionedGenerateRegion => {
    const cached = expandedById.get(region.id);
    if (cached) return cached;

    const contentRects: PositionedGenerateRegion['bounds'][] = [];
    for (const nodeId of region.nodeIds) {
      const node = nodeById.get(nodeId);
      if (!node) continue;
      const size = diagramNodeDimensions(node);
      contentRects.push(padRect({ x: node.position.x, y: node.position.y, width: size.width, height: size.height }));
    }
    for (const child of childRegionsByParent.get(region.id) ?? []) {
      contentRects.push(padRect(expand(child).bounds));
    }

    const content = unionRegionBounds(contentRects);
    const result: PositionedGenerateRegion = content
      ? {
        ...region,
        bounds: snapRegionBounds({
          x: Math.min(region.bounds.x, content.x),
          y: Math.min(region.bounds.y, content.y),
          width: Math.max(region.bounds.x + region.bounds.width, content.x + content.width) - Math.min(region.bounds.x, content.x),
          height: Math.max(region.bounds.y + region.bounds.height, content.y + content.height) - Math.min(region.bounds.y, content.y)
        }),
        fixed: region.fixed
      }
      : region;
    expandedById.set(region.id, result);
    return result;
  };

  const expanded = regions.map((region) => expand(region));
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
