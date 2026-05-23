import React from 'react';
import {
  Position,
  type EdgeProps,
  useNodes,
  useReactFlow
} from '@xyflow/react';
import { HdlPosition, type OrthogonalPoint, type RouteChange, type RouteChangeHandler, type SerializableOrthogonalRoute } from './types';
import type { DiagramEdge } from '../../ir/types';
import { diagramSizing } from '../../diagram/constants';
import {
  moveRouteSegment,
  normalizeRoutePoints,
  makeOrthogonal,
  segmentOrientation,
  midpoint,
  snapToGrid,
  snapPoint
} from './logic';
import { findNetJunctions, moveSharedNetSegments } from './netGeometry';
import { useEdgeOverlapHints, useLineJumpRender, useOptionalLineJumpContext, buildLineJumpRender } from '../react-flow-line-jumps';
import { InteractionContext } from '../main';
import { nodeIsArrayNode } from '../../ir/nodeMetadata';
import { ARRAY_STACK_LAYERS, ARRAY_STACK_LEAD_LAYERS, arrayStackLayerTrim, type ArrayStackLayerId } from '../arrayStackGeometry';

interface OrthogonalEdgeData extends SerializableOrthogonalRoute {
  onRouteChange?: RouteChangeHandler;
  edge?: DiagramEdge;
  isNetLeader?: boolean;
  netEdgeIds?: string[];
}

interface NodeObstacle {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

import { getVscodeApi } from '../vscodeApi';

const vscode = getVscodeApi();

function edgeNetKey(edge: DiagramEdge): string {
  if (edge.source.startsWith('literal:')) {
    return edge.source;
  }
  return `${edge.source}:${edge.sourcePort ?? ''}`;
}

export { moveRouteSegment, normalizeRoutePoints };

function jumpHaloPathsFromPath(path: string): string[] {
  const halos: string[] = [];
  const pattern = /L (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) Q (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g;
  let match = pattern.exec(path);

  while (match) {
    halos.push(`M ${match[1]} ${match[2]} Q ${match[3]} ${match[4]} ${match[5]} ${match[6]}`);
    match = pattern.exec(path);
  }

  return halos;
}

function pointsAlmostEqual(a: OrthogonalPoint, b: OrthogonalPoint): boolean {
  return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
}

function routePointsWithAnchoredLeads(points: OrthogonalPoint[], officialPoints: OrthogonalPoint[]): OrthogonalPoint[] {
  const routePoints = points.slice(1, -1);
  const sourceLead = officialPoints[0];
  const targetLead = officialPoints[officialPoints.length - 1];

  if (!sourceLead || !targetLead || routePoints.length === 0) {
    return routePoints;
  }

  const anchored = [...routePoints];
  if (!pointsAlmostEqual(anchored[0], sourceLead)) {
    anchored.unshift(sourceLead);
  }
  if (!pointsAlmostEqual(anchored[anchored.length - 1], targetLead)) {
    anchored.push(targetLead);
  }

  return anchored;
}

function routePointsFromFullPoints(points: OrthogonalPoint[]): OrthogonalPoint[] {
  return points.slice(1, -1).map((point) => ({ ...point }));
}

function pathFromPoints(points: OrthogonalPoint[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

function offsetPoints(points: OrthogonalPoint[], dx: number, dy: number): OrthogonalPoint[] {
  return points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
}

function shortenStackTarget(points: OrthogonalPoint[], amount: number, targetPosition: HdlPosition): OrthogonalPoint[] {
  if (points.length === 0 || amount === 0) return points;
  const next = points.map((point) => ({ ...point }));
  const last = next[next.length - 1];
  if (targetPosition === HdlPosition.Left) last.x -= amount;
  else if (targetPosition === HdlPosition.Right) last.x += amount;
  else if (targetPosition === HdlPosition.Top) last.y -= amount;
  else if (targetPosition === HdlPosition.Bottom) last.y += amount;
  return next;
}

function offsetPointsForArrayStackLayer(points: OrthogonalPoint[], layerId: ArrayStackLayerId): OrthogonalPoint[] {
  const layer = ARRAY_STACK_LAYERS[layerId];
  return offsetPoints(points, layer.dx, layer.dy);
}

function shortenStackSource(points: OrthogonalPoint[], amount: number, sourcePosition: HdlPosition): OrthogonalPoint[] {
  if (points.length === 0 || amount === 0) return points;
  const next = points.map((point) => ({ ...point }));
  const first = next[0];
  if (sourcePosition === HdlPosition.Left) first.x -= amount;
  else if (sourcePosition === HdlPosition.Right) first.x += amount;
  else if (sourcePosition === HdlPosition.Top) first.y -= amount;
  else if (sourcePosition === HdlPosition.Bottom) first.y += amount;
  return next;
}

interface PromotedStackFanout {
  trunk: string;
  bar: string;
  barStart: OrthogonalPoint;
  barEnd: OrthogonalPoint;
  branches: Array<{ layerId: ArrayStackLayerId; path: string }>;
}

function stackedLayerEdgeClass(layerId: ArrayStackLayerId): string {
  if (layerId === 'front') return 'svsch-edge-stacked-front';
  if (layerId === 'back') return 'svsch-edge-stacked-back';
  return 'svsch-edge-stacked';
}

function stableFragmentId(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash, 31) + value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function promotedStackFanoutPath(points: OrthogonalPoint[], targetPosition: HdlPosition): PromotedStackFanout | undefined {
  if (points.length < 2) return undefined;

  const target = points[points.length - 1];
  const splitDistance = diagramSizing.gridSize * 2;
  let split: OrthogonalPoint;

  if (targetPosition === HdlPosition.Left) split = { x: target.x - splitDistance, y: target.y };
  else if (targetPosition === HdlPosition.Right) split = { x: target.x + splitDistance, y: target.y };
  else if (targetPosition === HdlPosition.Top) split = { x: target.x, y: target.y - splitDistance };
  else split = { x: target.x, y: target.y + splitDistance };

  const trunkPoints = makeOrthogonal([...points.slice(0, -1), split]);
  const branchStarts = ARRAY_STACK_LEAD_LAYERS.map((layer) => ({ x: split.x + layer.dx, y: split.y + layer.dy }));
  const branchTargets = ARRAY_STACK_LEAD_LAYERS.map((layer) => shortenStackTarget(
    [{ x: target.x + layer.dx, y: target.y + layer.dy }],
    arrayStackLayerTrim(layer.id),
    targetPosition
  )[0]);

  return {
    trunk: pathFromPoints(trunkPoints),
    barStart: branchStarts[0],
    barEnd: branchStarts[branchStarts.length - 1],
    bar: `M ${branchStarts[0].x} ${branchStarts[0].y} L ${branchStarts[branchStarts.length - 1].x} ${branchStarts[branchStarts.length - 1].y}`,
    branches: branchTargets.map((branchTarget, index) => ({
      layerId: ARRAY_STACK_LEAD_LAYERS[index].id,
      path: `M ${branchStarts[index].x} ${branchStarts[index].y} L ${branchTarget.x} ${branchTarget.y}`
    }))
  };
}

function nodeObstacle(node: any): NodeObstacle | undefined {
  const width = node.measured?.width ?? node.width;
  const height = node.measured?.height ?? node.height;
  const position = node.positionAbsolute ?? node.position;
  if (typeof width !== 'number' || typeof height !== 'number' || !position) {
    return undefined;
  }
  return {
    id: node.id,
    x: position.x,
    y: position.y,
    width,
    height
  };
}

function horizontalOverlap(rect: NodeObstacle, minX: number, maxX: number): boolean {
  return rect.x < maxX && rect.x + rect.width > minX;
}

function verticalOverlap(rect: NodeObstacle, minY: number, maxY: number): boolean {
  return rect.y < maxY && rect.y + rect.height > minY;
}

function routeHasClearHorizontalFeedbackLeg(
  points: OrthogonalPoint[],
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): boolean {
  return points.slice(0, -1).some((point, index) => {
    const next = points[index + 1];
    if (Math.abs(point.y - next.y) >= 0.5) {
      return false;
    }
    if (Math.max(point.x, next.x) < maxX || Math.min(point.x, next.x) > minX) {
      return false;
    }
    return point.y < minY || point.y > maxY;
  });
}

function routeHasClearVerticalFeedbackLeg(
  points: OrthogonalPoint[],
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): boolean {
  return points.slice(0, -1).some((point, index) => {
    const next = points[index + 1];
    if (Math.abs(point.x - next.x) >= 0.5) {
      return false;
    }
    if (Math.max(point.y, next.y) < maxY || Math.min(point.y, next.y) > minY) {
      return false;
    }
    return point.x < minX || point.x > maxX;
  });
}

function avoidFeedbackObstacles(
  points: OrthogonalPoint[],
  obstacles: NodeObstacle[],
  sourcePosition: HdlPosition,
  targetPosition: HdlPosition
): OrthogonalPoint[] {
  if (points.length < 2 || obstacles.length === 0) {
    return points;
  }

  const sourceLead = points[0];
  const targetLead = points[points.length - 1];
  const grid = diagramSizing.gridSize;
  const isRightFeedback = sourcePosition === HdlPosition.Right
    && targetPosition === HdlPosition.Left
    && sourceLead.x >= targetLead.x;
  const isLeftFeedback = sourcePosition === HdlPosition.Left
    && targetPosition === HdlPosition.Right
    && sourceLead.x <= targetLead.x;

  if (isRightFeedback || isLeftFeedback) {
    const minX = Math.min(sourceLead.x, targetLead.x);
    const maxX = Math.max(sourceLead.x, targetLead.x);
    const crossed = obstacles.filter((rect) => horizontalOverlap(rect, minX, maxX));
    if (crossed.length === 0) {
      return points;
    }

    const minY = Math.min(...crossed.map((rect) => rect.y));
    const maxY = Math.max(...crossed.map((rect) => rect.y + rect.height));
    if (routeHasClearHorizontalFeedbackLeg(points, minX, maxX, minY, maxY)) {
      return points;
    }

    const direction = isRightFeedback ? 1 : -1;
    const outerX = direction > 0
      ? Math.max(sourceLead.x, targetLead.x, ...crossed.map((rect) => rect.x + rect.width)) + grid
      : Math.min(sourceLead.x, targetLead.x, ...crossed.map((rect) => rect.x)) - grid;
    const loopX = snapToGrid(outerX);
    const loopY = snapToGrid(maxY + grid);

    return makeOrthogonal([
      sourceLead,
      { x: loopX, y: sourceLead.y },
      { x: loopX, y: loopY },
      { x: targetLead.x, y: loopY },
      targetLead
    ]);
  }

  const isBottomFeedback = sourcePosition === HdlPosition.Bottom
    && targetPosition === HdlPosition.Top
    && sourceLead.y >= targetLead.y;
  const isTopFeedback = sourcePosition === HdlPosition.Top
    && targetPosition === HdlPosition.Bottom
    && sourceLead.y <= targetLead.y;

  if (isBottomFeedback || isTopFeedback) {
    const minY = Math.min(sourceLead.y, targetLead.y);
    const maxY = Math.max(sourceLead.y, targetLead.y);
    const crossed = obstacles.filter((rect) => verticalOverlap(rect, minY, maxY));
    if (crossed.length === 0) {
      return points;
    }

    const minX = Math.min(...crossed.map((rect) => rect.x));
    const maxX = Math.max(...crossed.map((rect) => rect.x + rect.width));
    if (routeHasClearVerticalFeedbackLeg(points, minX, maxX, minY, maxY)) {
      return points;
    }

    const direction = isBottomFeedback ? 1 : -1;
    const outerY = direction > 0
      ? Math.max(sourceLead.y, targetLead.y, ...crossed.map((rect) => rect.y + rect.height)) + grid
      : Math.min(sourceLead.y, targetLead.y, ...crossed.map((rect) => rect.y)) - grid;
    const loopY = snapToGrid(outerY);
    const loopX = snapToGrid(Math.max(...crossed.map((rect) => rect.x + rect.width)) + grid);

    return makeOrthogonal([
      sourceLead,
      { x: sourceLead.x, y: loopY },
      { x: loopX, y: loopY },
      { x: loopX, y: targetLead.y },
      targetLead
    ]);
  }

  return points;
}

export function OrthogonalEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  sourceHandleId,
  targetHandleId,
  label,
  data
}: EdgeProps): React.ReactElement {
  const reactFlow = useReactFlow();
  const flowNodes = useNodes();
  const context = useOptionalLineJumpContext();
  const { hoveredNetKey, setHovered } = React.useContext(InteractionContext);

  const edgeData = data as OrthogonalEdgeData | undefined;
  const diagramEdge = edgeData?.edge;
  const netKey = diagramEdge ? edgeNetKey(diagramEdge) : undefined;
  
  const isStructAggregate = diagramEdge?.metadata?.aggregate === 'struct';
  const isInterfaceAggregate = diagramEdge?.metadata?.aggregate === 'interface';
  const isStacked = diagramEdge?.isStacked === true;
  const sourceFlowNode = flowNodes.find((node) => node.id === source);
  const targetFlowNode = flowNodes.find((node) => node.id === target);
  const sourceIsArray = sourceFlowNode?.data?.node ? nodeIsArrayNode(sourceFlowNode.data.node as any) : false;
  const targetIsArray = targetFlowNode?.data?.node ? nodeIsArrayNode(targetFlowNode.data.node as any) : false;
  const isPromotedStack = isStacked && targetIsArray && !sourceIsArray;
  // For stacked edges reaching a non-array target, suppress back/front lanes — they'd spill into the scalar block
  const isConvergingStack = isStacked && !targetIsArray;

  const isNetHovered = netKey !== undefined && hoveredNetKey === netKey;
  const isLeaderInNet = edgeData?.isNetLeader === true;
  
  const [hoveredSegmentIndex, setHoveredSegmentIndex] = React.useState<number | null>(null);
  // localPoints represents the "structured" path during a drag
  const [localPoints, setLocalPoints] = React.useState<OrthogonalPoint[] | null>(null);
  const dragOffsetRef = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const isDragging = localPoints !== null;

  // Calculate the "official" points from props (used when NOT dragging)
  const normalizedOfficialPoints = normalizeRoutePoints(
    edgeData,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition as unknown as HdlPosition,
    targetPosition as unknown as HdlPosition,
    sourceHandleId,
    targetHandleId,
    !isDragging
  );
  const obstacles = React.useMemo(
    () => flowNodes.map(nodeObstacle).filter((obstacle): obstacle is NodeObstacle => obstacle !== undefined),
    [flowNodes]
  );
  const officialPoints = React.useMemo(() => avoidFeedbackObstacles(
    normalizedOfficialPoints,
    obstacles,
    sourcePosition as unknown as HdlPosition,
    targetPosition as unknown as HdlPosition
  ), [normalizedOfficialPoints, obstacles, sourcePosition, targetPosition]);

  // Use localPoints if we are dragging, otherwise use officialPoints.
  // We MUST prepend and append the actual handle coordinates to officialPoints 
  // because normalizeRoutePoints only returns the path between leads.
  // The handle coordinates can intentionally live on half-grid shape boundaries
  // such as the one-grid interface top hat. Snapping them here makes the visible
  // wire miss the rendered node edge by half a grid.
  const points = localPoints ?? [
    { x: sourceX, y: sourceY },
    ...officialPoints,
    { x: targetX, y: targetY }
  ];
  const rawEdgePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const edgeGeometry = React.useMemo(() => ({
    edgeId: id,
    points,
    sourceId: netKey ?? source,
    targetId: `${target}:${targetHandleId ?? ''}`,
    netKey,
    sourceHandlePoint: { x: sourceX, y: sourceY },
    targetHandlePoint: { x: targetX, y: targetY }
  }), [id, points, source, target, targetHandleId, netKey, sourceX, sourceY, targetX, targetY]);
  const edgeRender = useLineJumpRender(edgeGeometry);
  const overlapHints = useEdgeOverlapHints(edgeGeometry);
  const jumpHaloPaths = edgeRender.jumpPaths.length > 0
    ? edgeRender.jumpPaths
    : jumpHaloPathsFromPath(edgeRender.path);
  const targetHdlPosition = targetPosition as unknown as HdlPosition;
  const sourceHdlPosition = sourcePosition as unknown as HdlPosition;
  const backStackPoints = shortenStackTarget(
    shortenStackSource(
      makeOrthogonal(offsetPointsForArrayStackLayer(points, 'back')),
      sourceIsArray ? arrayStackLayerTrim('back') : 0,
      sourceHdlPosition
    ),
    targetIsArray ? arrayStackLayerTrim('back') : 0,
    targetHdlPosition
  );
  const middleStackPoints = shortenStackTarget(
    shortenStackSource(
      makeOrthogonal(points),
      sourceIsArray ? arrayStackLayerTrim('middle') : 0,
      sourceHdlPosition
    ),
    targetIsArray ? arrayStackLayerTrim('middle') : 0,
    targetHdlPosition
  );
  const backStackPath = pathFromPoints(backStackPoints);
  const middleStackPath = pathFromPoints(middleStackPoints);
  const frontStackPoints = shortenStackTarget(
    shortenStackSource(
      makeOrthogonal(offsetPointsForArrayStackLayer(points, 'front')),
      sourceIsArray ? arrayStackLayerTrim('front') : 0,
      sourceHdlPosition
    ),
    targetIsArray ? arrayStackLayerTrim('front') : 0,
    targetHdlPosition
  );
  const frontStackPath = pathFromPoints(frontStackPoints);
  const promotedFanout = isPromotedStack ? promotedStackFanoutPath(points, targetPosition as unknown as HdlPosition) : undefined;
  const promotedFanoutGradientId = `svsch-stack-fanout-gradient-${stableFragmentId(id)}`;

  const labelPoint = points[Math.floor(points.length / 2)] ?? midpoint({ x: sourceX, y: sourceY }, { x: targetX, y: targetY });
  const netGeometries = context && edgeData?.netEdgeIds
    ? context.geometries.filter((geometry) => edgeData.netEdgeIds?.includes(geometry.edgeId))
    : [];
  const netJunctions = (isLeaderInNet || isInterfaceAggregate) && context
    ? findNetJunctions(netGeometries)
    : [];
  const useStackedJunctionDots = isStacked && isLeaderInNet && !isInterfaceAggregate;

  const moveSegment = (event: React.PointerEvent, segmentIndex: number, commit: boolean) => {
    const flowPoint = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });

    let currentStructuredPoints = localPoints ?? [
      { x: sourceX, y: sourceY },
      ...officialPoints,
      { x: targetX, y: targetY }
    ];

    // On drag start, capture offset and lock the structure
    if (!localPoints) {
      const initialPoint = currentStructuredPoints[segmentIndex];
      dragOffsetRef.current = {
        x: initialPoint.x - flowPoint.x,
        y: initialPoint.y - flowPoint.y
      };
    }

    const adjustedPoint = {
      x: flowPoint.x + dragOffsetRef.current.x,
      y: flowPoint.y + dragOffsetRef.current.y
    };

    const availableGeometries = context?.geometries ?? [edgeGeometry];
    const dragGeometries = availableGeometries.map((geometry) => (
      geometry.edgeId === id ? { ...edgeGeometry, points: currentStructuredPoints } : geometry
    ));
    const sharedMoves = moveSharedNetSegments(dragGeometries, id, segmentIndex, adjustedPoint);
    const ownMove = sharedMoves.find((move) => move.edgeId === id);
    const nextPoints = ownMove?.points ?? moveRouteSegment(currentStructuredPoints, segmentIndex, adjustedPoint);
    
    if (commit) {
      setLocalPoints(null);
      // Ensure we have a stable structure to save.
      // We want to save exactly what the user sees between the protected leads.
      // Disable simplification to ensure the structure is preserved.
      const finalPoints = makeOrthogonal(nextPoints, false);
      const mainChange: RouteChange = {
        edgeId: id,
        routePoints: routePointsWithAnchoredLeads(finalPoints, officialPoints)
      };

      const otherChanges: RouteChange[] = sharedMoves
        .filter((move) => move.edgeId !== id)
        .map((move) => ({
          edgeId: move.edgeId,
          routePoints: routePointsFromFullPoints(makeOrthogonal(move.points, false))
        }));

      edgeData?.onRouteChange?.([mainChange, ...otherChanges], true);
    } else {
      setLocalPoints(nextPoints);
      const changes: RouteChange[] = sharedMoves
        .filter((move) => move.edgeId !== id)
        .map((move) => ({
          edgeId: move.edgeId,
          routePoints: routePointsFromFullPoints(move.points)
        }));

      if (changes.length > 0) {
        edgeData?.onRouteChange?.(changes, false);
      }
    }
  };

  return (
    <>
      {isInterfaceAggregate && (
        <defs>
          <pattern id="svsch-interface-stripes" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">
            <line className="svsch-interface-stripe" x1="0" y1="0" x2="0" y2="10" />
          </pattern>
        </defs>
      )}
      {jumpHaloPaths.map((path, index) => (
        <path key={`${id}-jump-halo-${index}`} className="svsch-edge-jump-halo" d={path} />
      ))}
      {isNetHovered && isLeaderInNet && context && (
        <g className="svsch-edge-net-highlight-group">
          {(() => {
            const netEdgeIds = new Set(edgeData?.netEdgeIds || []);
            return context.geometries
              .filter(g => netEdgeIds.has(g.edgeId))
              .map(g => {
                const render = buildLineJumpRender(g, context.geometries, context.options);
                return (
                  <path
                    key={`halo-${g.edgeId}`}
                    className="svsch-edge-net-highlight"
                    d={render.path}
                  />
                );
              });
          })()}
        </g>
      )}
      {isStacked && !isPromotedStack && !isConvergingStack && (
        <path className="svsch-edge svsch-edge-stacked-back" d={backStackPath} />
      )}
      {isInterfaceAggregate && (
        <path className="svsch-edge svsch-edge-interface-bg" d={edgeRender.path} />
      )}
      {promotedFanout ? (
        <>
          <defs>
            <linearGradient
              id={promotedFanoutGradientId}
              gradientUnits="userSpaceOnUse"
              x1={promotedFanout.barStart.x}
              y1={promotedFanout.barStart.y}
              x2={promotedFanout.barEnd.x}
              y2={promotedFanout.barEnd.y}
            >
              <stop offset="0%" className="svsch-stack-gradient-front-stop" />
              <stop offset="50%" className="svsch-stack-gradient-middle-stop" />
              <stop offset="100%" className="svsch-stack-gradient-back-stop" />
            </linearGradient>
          </defs>
          <path className={`svsch-edge svsch-edge-stacked${isStructAggregate ? ' svsch-edge-struct' : ''}${isInterfaceAggregate ? ' svsch-edge-interface' : ''}`} d={promotedFanout.trunk} />
          <path className="svsch-edge svsch-edge-stacked-breakout" d={promotedFanout.bar} style={{ stroke: `url(#${promotedFanoutGradientId})` }} />
          {promotedFanout.branches.map((branch, index) => (
            <path
              key={`${id}-stack-branch-${index}`}
              className={`svsch-edge svsch-edge-stacked-side svsch-edge-stacked-side-${branch.layerId} ${stackedLayerEdgeClass(branch.layerId)}`}
              d={branch.path}
            />
          ))}
        </>
      ) : (
        <path className={`svsch-edge${isStacked ? ' svsch-edge-stacked' : ''}${isStructAggregate ? ' svsch-edge-struct' : ''}${isInterfaceAggregate ? ' svsch-edge-interface' : ''}`} d={isStacked ? middleStackPath : edgeRender.path} />
      )}
      {isStacked && !isPromotedStack && !isConvergingStack && (
        <path className="svsch-edge svsch-edge-stacked-front" d={frontStackPath} />
      )}
      <path
        className={`svsch-edge-bridge react-flow__edge-interaction${isStructAggregate ? ' svsch-edge-bridge-struct' : ''}${isInterfaceAggregate ? ' svsch-edge-bridge-interface' : ''}`}
        d={rawEdgePath}
        onMouseEnter={() => setHovered(netKey)}
        onMouseLeave={() => setHovered(undefined)}
      />
      {overlapHints.map((hint) => (
        <path key={hint.id} className="svsch-edge-overlap-hint" d={hint.path} style={hint.style} />
      ))}
      {netJunctions.map((junction) => (
        useStackedJunctionDots ? (
          <g key={`${id}-junction-${junction.id}`} className="svsch-edge-junction-stacked">
            {[
              { layer: ARRAY_STACK_LAYERS.front, opacity: 1 },
              { layer: ARRAY_STACK_LAYERS.middle, opacity: 0.75 },
              { layer: ARRAY_STACK_LAYERS.back, opacity: 0.5 }
            ].map(({ layer, opacity }, index) => (
              <circle
                key={`${id}-junction-${junction.id}-${index}`}
                className="svsch-edge-junction svsch-edge-junction-stacked-dot"
                cx={junction.x + layer.dx}
                cy={junction.y + layer.dy}
                r={2.15}
                style={{ opacity }}
              />
            ))}
          </g>
        ) : (
          <circle
            key={`${id}-junction-${junction.id}`}
            className={`svsch-edge-junction${isInterfaceAggregate ? ' svsch-edge-junction-interface' : ''}`}
            cx={junction.x}
            cy={junction.y}
            r={isInterfaceAggregate ? 6.5 : 4.75}
          />
        )
      ))}
      {points.slice(0, -1).map((point, index) => {
        const next = points[index + 1];
        const orientation = segmentOrientation(point, next);
        if (!orientation || index === 0 || index === points.length - 2) {
          return null;
        }
        return (
          <React.Fragment key={`${id}-segment-${index}`}>
            {hoveredSegmentIndex === index && (
              <path
                className="svsch-edge-segment-highlight"
                d={`M ${point.x} ${point.y} L ${next.x} ${next.y}`}
              />
            )}
            <path
              key={`${id}-segment-${index}`}
              className={`svsch-edge-segment-handle svsch-edge-segment-${orientation}`}
              d={`M ${point.x} ${point.y} L ${next.x} ${next.y}`}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setHoveredSegmentIndex(index);
                moveSegment(event, index, false);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  moveSegment(event, index, false);
                }
              }}
              onPointerUp={(event) => {
                moveSegment(event, index, true);
                setHoveredSegmentIndex(null);
                event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onMouseEnter={() => setHoveredSegmentIndex(index)}
              onMouseLeave={() => {
                if (!isDragging) {
                  setHoveredSegmentIndex(null);
                }
              }}
            />
          </React.Fragment>
        );
      })}
      {label && (
        <foreignObject width={48} height={22} x={labelPoint.x - 24} y={labelPoint.y - 11} className="svsch-edge-label">
          <div>{label}</div>
        </foreignObject>
      )}
    </>
  );
}
