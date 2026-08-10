import { diagramSizing } from '../../diagram/constants';
import { diagramNodeDimensions } from '../../diagram/nodeSizing';
import { interfaceInstanceTopHatY } from '../../diagram/visualHandleGeometry';
import { nodeTypeName, structRole } from '../../ir/nodeMetadata';
import type { DiagramNode } from '../../ir/types';
import { HdlPosition, type OrthogonalPoint, type SerializableOrthogonalRoute } from './types';

export interface NodeObstacle {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function snapLeadPoint(point: OrthogonalPoint, handleX: number, handleY: number, position: HdlPosition): OrthogonalPoint {
  if (position === HdlPosition.Top || position === HdlPosition.Bottom) {
    return {
      x: handleX,
      y: snapToGrid(point.y)
    };
  } else {
    return {
      x: snapToGrid(point.x),
      y: handleY
    };
  }
}

export function normalizeRoutePoints(
  route: SerializableOrthogonalRoute | undefined,
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourcePosition: HdlPosition,
  targetPosition: HdlPosition,
  sourceHandleId?: string | null,
  targetHandleId?: string | null,
  simplify = true,
  sourceNode?: DiagramNode,
  targetNode?: DiagramNode
): OrthogonalPoint[] {
  const forceStraight = (route as any)?.edge?.metadata?.forceStraight === true;
  const isCutStub = forceStraight && (
    (route as any)?.edge?.metadata?.cutStub !== undefined
    || sourceNode?.kind === 'netLabel'
    || targetNode?.kind === 'netLabel'
  );
  // A cut label's handle already sits at the owning port's lead point. Keep
  // the ordinary lead on the real-node end of the stub, but add no second
  // lead at the synthetic label end. This makes a displaced label bend only
  // after the wire has cleared the real port.
  const sourceLeadLen = forceStraight
    ? (isCutStub && sourceNode?.kind !== 'netLabel'
      ? leadLengthForHandle(sourcePosition, sourceHandleId, undefined, sourceNode)
      : 0)
    : leadLengthForHandle(sourcePosition, sourceHandleId, undefined, sourceNode);
  const targetLeadLen = forceStraight
    ? (isCutStub && targetNode?.kind !== 'netLabel'
      ? leadLengthForHandle(targetPosition, targetHandleId, undefined, targetNode)
      : 0)
    : leadLengthForHandle(targetPosition, targetHandleId, undefined, targetNode);
  // A zero-lead endpoint may land on a half-grid coordinate (e.g. the centre
  // of a port node). Preserve it exactly; only snap an endpoint for which an
  // actual lead was added.
  const sourceLead = forceStraight && sourceLeadLen === 0
    ? { x: sourceX, y: sourceY }
    : snapLeadPoint(leadPoint(sourceX, sourceY, sourcePosition, sourceLeadLen), sourceX, sourceY, sourcePosition);
  const targetLead = forceStraight && targetLeadLen === 0
    ? { x: targetX, y: targetY }
    : snapLeadPoint(leadPoint(targetX, targetY, targetPosition, targetLeadLen), targetX, targetY, targetPosition);
  const hasPersistedRoute = Boolean(route?.routePoints?.length || route?.waypoint);
  const alignedOpposingCutStub = !hasPersistedRoute && isCutStub && (
    ((sourcePosition === HdlPosition.Right && targetPosition === HdlPosition.Left)
      || (sourcePosition === HdlPosition.Left && targetPosition === HdlPosition.Right))
      ? Math.abs(sourceLead.x - targetLead.x) < 0.5
      : ((sourcePosition === HdlPosition.Bottom && targetPosition === HdlPosition.Top)
        || (sourcePosition === HdlPosition.Top && targetPosition === HdlPosition.Bottom))
        && Math.abs(sourceLead.y - targetLead.y) < 0.5
  );
  if (alignedOpposingCutStub) {
    return makeOrthogonal([sourceLead, targetLead], simplify);
  }
  const saved = route?.routePoints?.length
    ? stripHandleEndpoints(route.routePoints, sourceX, sourceY, targetX, targetY)
    : migrateRoutePoints(route?.waypoint, sourceLead, targetLead, sourceY, targetY, sourcePosition, targetPosition, sourceHandleId, targetHandleId);

  if (saved.length < 2) {
    return defaultRoute(sourceLead, targetLead, sourcePosition, targetPosition, sourceHandleId, targetHandleId);
  }

  // A freshly computed default route (no persisted routePoints/waypoint to
  // reconcile) is already exact — its internal bends are derived directly
  // from sourceLead/targetLead, which aren't guaranteed to fall on a full
  // grid line (a port's connection point is node position + half its own
  // height). Running it through the snap-to-grid pass below meant for
  // cleaning up stale/dragged points would nudge just the internal bends
  // and not the endpoints, opening a spurious few-pixel notch in what
  // should be a flat, straight segment.
  if (!hasPersistedRoute) {
    return makeOrthogonal(saved, simplify);
  }

  const canClampInternalPoints = leadConstraintsAreCompatible(sourceLead, targetLead, sourcePosition, targetPosition);

  // saved points start with the old sourceLead and end with the old targetLead.
  // We want to keep everything BETWEEN them.
  const savedInternal = saved.slice(1, -1);
  const internal = savedInternal.map((point, index) => {
    const snapped = snapPoint(point);
    if (index === 0) {
      preserveEndpointSegmentAxis(point, snapped, sourceLead, sourcePosition);
    }
    if (index === savedInternal.length - 1) {
      preserveEndpointSegmentAxis(point, snapped, targetLead, targetPosition);
    }
    return snapped;
  }).map((point) => {
    if (!simplify || !canClampInternalPoints) {
      return point;
    }

    let clamped = clampToLead(point, sourceX, sourceY, sourcePosition, sourceLeadLen);
    clamped = clampToLead(clamped, targetX, targetY, targetPosition, targetLeadLen);
    return clamped;
  });

  const combined = [sourceLead, ...internal, targetLead];
  return makeOrthogonal(combined, simplify);
}

function preserveEndpointSegmentAxis(
  original: OrthogonalPoint,
  snapped: OrthogonalPoint,
  lead: OrthogonalPoint,
  position: HdlPosition
): void {
  if (position === HdlPosition.Left || position === HdlPosition.Right) {
    if (Math.abs(original.x - lead.x) < 0.5) snapped.x = lead.x;
    else snapped.y = lead.y;
  } else if (Math.abs(original.y - lead.y) < 0.5) {
    snapped.y = lead.y;
  } else {
    snapped.x = lead.x;
  }
}

export function clampToLead(point: OrthogonalPoint, nodeX: number, nodeY: number, position: HdlPosition, distance: number): OrthogonalPoint {
  const next = { ...point };
  if (position === HdlPosition.Left) {
    next.x = Math.min(next.x, nodeX - distance);
  } else if (position === HdlPosition.Right) {
    next.x = Math.max(next.x, nodeX + distance);
  } else if (position === HdlPosition.Top) {
    next.y = Math.min(next.y, nodeY - distance);
  } else if (position === HdlPosition.Bottom) {
    next.y = Math.max(next.y, nodeY + distance);
  }
  return next;
}

export function stripHandleEndpoints(
  routePoints: OrthogonalPoint[],
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number
): OrthogonalPoint[] {
  if (routePoints.length < 4) {
    return routePoints;
  }

  const first = routePoints[0];
  const last = routePoints[routePoints.length - 1];
  if (pointsAlmostEqual(first, { x: sourceX, y: sourceY }) && pointsAlmostEqual(last, { x: targetX, y: targetY })) {
    return routePoints.slice(1, -1);
  }

  return routePoints;
}

function pointsAlmostEqual(a: OrthogonalPoint, b: OrthogonalPoint): boolean {
  return Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
}

export function leadLengthForHandle(position: HdlPosition, handleId?: string | null, maxLead?: number, node?: DiagramNode): number {
  let length = diagramSizing.edgeLeadLength;
  if (position === HdlPosition.Top || position === HdlPosition.Bottom) {
    if (position === HdlPosition.Top && isInterfaceInstanceNode(node)) {
      // Top-hat handles sit inside the layout box; the ELK anchor is at the
      // box top (zero lead margin), so the lead spans exactly the hat offset.
      length = interfaceInstanceTopHatY(node!, diagramNodeDimensions(node!).height);
    } else if (handleId === 'reset' || isModuleModportHatNode(node)) {
      length = diagramSizing.gridSize;
    } else {
      length = diagramSizing.gridSize * 2;
    }
  }

  if (maxLead !== undefined) {
    return Math.min(length, maxLead);
  }
  return length;
}

// Module-level interface modports use a single-grid hat stem. Must match the
// leadOverride in elkNodeForDiagramNode so webview routes and ELK anchors agree.
function isModuleModportHatNode(node?: DiagramNode): boolean {
  return !!node && node.kind === 'interface' && structRole(node) === 'modport' && node.label !== nodeTypeName(node);
}

function isInterfaceInstanceNode(node?: DiagramNode): boolean {
  const role = node ? structRole(node) : undefined;
  return !!node && node.kind === 'interface' && role !== 'modport' && role !== 'port' && !node.id.startsWith('interface_type:');
}

export function migrateRoutePoints(
  waypoint: OrthogonalPoint | undefined,
  sourceLead: OrthogonalPoint,
  targetLead: OrthogonalPoint,
  sourceY: number,
  targetY: number,
  sourcePosition?: HdlPosition,
  targetPosition?: HdlPosition,
  sourceHandleId?: string | null,
  targetHandleId?: string | null
): OrthogonalPoint[] {
  if (waypoint) {
    return [
      sourceLead,
      { x: waypoint.x, y: sourceY },
      { x: waypoint.x, y: waypoint.y },
      { x: targetLead.x, y: waypoint.y },
      targetLead
    ];
  }

  return defaultRoute(sourceLead, targetLead, sourcePosition, targetPosition, sourceHandleId, targetHandleId);
}

export function defaultRoute(
  sourceLead: OrthogonalPoint,
  targetLead: OrthogonalPoint,
  sourcePosition?: HdlPosition,
  targetPosition?: HdlPosition,
  _sourceHandleId?: string | null,
  targetHandleId?: string | null
): OrthogonalPoint[] {
  const grid = diagramSizing.gridSize;
  const isResetBottomTarget = targetHandleId === 'reset'
    && targetPosition === HdlPosition.Bottom
    && (sourcePosition === HdlPosition.Left || sourcePosition === HdlPosition.Right);

  if (isResetBottomTarget) {
    return [
      sourceLead,
      { x: targetLead.x, y: sourceLead.y },
      targetLead
    ];
  }

  const isRightFeedback = sourcePosition === HdlPosition.Right
    && targetPosition === HdlPosition.Left
    && sourceLead.x >= targetLead.x;
  const isLeftFeedback = sourcePosition === HdlPosition.Left
    && targetPosition === HdlPosition.Right
    && sourceLead.x <= targetLead.x;

  if (isRightFeedback || isLeftFeedback) {
    const direction = isRightFeedback ? 1 : -1;
    const loopX = snapToGrid((direction > 0 ? Math.max(sourceLead.x, targetLead.x) : Math.min(sourceLead.x, targetLead.x)) + direction * grid * 3);
    const loopY = Math.abs(sourceLead.y - targetLead.y) < 0.5
      ? snapToGrid(sourceLead.y + grid * 3)
      : targetLead.y;

    return [
      sourceLead,
      { x: loopX, y: sourceLead.y },
      { x: loopX, y: loopY },
      { x: targetLead.x, y: loopY },
      targetLead
    ];
  }

  const isBottomFeedback = sourcePosition === HdlPosition.Bottom
    && targetPosition === HdlPosition.Top
    && sourceLead.y >= targetLead.y;
  const isTopFeedback = sourcePosition === HdlPosition.Top
    && targetPosition === HdlPosition.Bottom
    && sourceLead.y <= targetLead.y;

  if (isBottomFeedback || isTopFeedback) {
    const direction = isBottomFeedback ? 1 : -1;
    const loopY = snapToGrid((direction > 0 ? Math.max(sourceLead.y, targetLead.y) : Math.min(sourceLead.y, targetLead.y)) + direction * grid * 3);
    const loopX = Math.abs(sourceLead.x - targetLead.x) < 0.5
      ? snapToGrid(sourceLead.x + grid * 3)
      : targetLead.x;

    return [
      sourceLead,
      { x: sourceLead.x, y: loopY },
      { x: loopX, y: loopY },
      { x: loopX, y: targetLead.y },
      targetLead
    ];
  }

  const midX = snapToGrid((sourceLead.x + targetLead.x) / 2);
  return [
    sourceLead,
    { x: midX, y: sourceLead.y },
    { x: midX, y: targetLead.y },
    targetLead
  ];
}

export function leadConstraintsAreCompatible(
  sourceLead: OrthogonalPoint,
  targetLead: OrthogonalPoint,
  sourcePosition: HdlPosition,
  targetPosition: HdlPosition
): boolean {
  if (sourcePosition === HdlPosition.Right && targetPosition === HdlPosition.Left) {
    return sourceLead.x < targetLead.x;
  }
  if (sourcePosition === HdlPosition.Left && targetPosition === HdlPosition.Right) {
    return sourceLead.x > targetLead.x;
  }
  if (sourcePosition === HdlPosition.Bottom && targetPosition === HdlPosition.Top) {
    return sourceLead.y < targetLead.y;
  }
  if (sourcePosition === HdlPosition.Top && targetPosition === HdlPosition.Bottom) {
    return sourceLead.y > targetLead.y;
  }
  return true;
}

export function makeOrthogonal(points: OrthogonalPoint[], simplify = true): OrthogonalPoint[] {
  if (points.length < 2) {
    return points;
  }

  const orthogonal: OrthogonalPoint[] = [{ ...points[0] }];
  for (let index = 1; index < points.length; index += 1) {
    const previous = orthogonal[orthogonal.length - 1];
    const current = points[index];
    if (Math.abs(previous.x - current.x) < 0.5 && Math.abs(previous.y - current.y) < 0.5) {
      if (!simplify) {
        // Even if points are the same, we keep them to maintain point count during drag
        orthogonal.push({ ...current });
      }
      continue;
    }
    if (Math.abs(previous.x - current.x) < 0.5 || Math.abs(previous.y - current.y) < 0.5) {
      orthogonal.push({ ...current });
    } else {
      orthogonal.push({ x: current.x, y: previous.y }, { ...current });
    }
  }

  return simplify ? removeRedundantPoints(orthogonal) : orthogonal;
}
export function removeRedundantPoints(points: OrthogonalPoint[]): OrthogonalPoint[] {
  const simplified = points.filter((point, index) => {
    if (index === 0 || index === points.length - 1) {
      return true;
    }
    const previous = points[index - 1];
    const next = points[index + 1];

    const orientationPrev = segmentOrientation(previous, point);
    const orientationNext = segmentOrientation(point, next);

    if (orientationPrev && orientationNext && orientationPrev === orientationNext) {
      // Check if it's a 180 degree turn (double back).
      const dotProduct = (point.x - previous.x) * (next.x - point.x) + (point.y - previous.y) * (next.y - point.y);
      if (dotProduct < 0) {
        return true; // Keep it for now, might be a 180 turn
      }
      return false; // Remove it, it's a straight line (or duplicate).
    }
    return true;
  });

  // Remove actual double-backs (A -> B -> A)
  const result: OrthogonalPoint[] = [];
  for (const point of simplified) {
    if (result.length >= 2) {
      const prev = result[result.length - 1];
      const prevPrev = result[result.length - 2];
      // If we are doubling back exactly to the previous point's start, it's a spike
      if (pointsAlmostEqual(point, prevPrev)) {
        result.pop();
        continue;
      }
    }
    result.push(point);
  }
  return result;
}

export function leadPoint(x: number, y: number, position: HdlPosition, distance: number): OrthogonalPoint {
  if (position === HdlPosition.Left) {
    return { x: x - distance, y };
  }
  if (position === HdlPosition.Right) {
    return { x: x + distance, y };
  }
  if (position === HdlPosition.Top) {
    return { x, y: y - distance };
  }
  return { x, y: y + distance };
}

export function pointsToPath(points: OrthogonalPoint[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
}

export function segmentOrientation(a: OrthogonalPoint, b: OrthogonalPoint): 'horizontal' | 'vertical' | undefined {
  if (Math.abs(a.y - b.y) < 0.5) {
    return 'horizontal';
  }
  if (Math.abs(a.x - b.x) < 0.5) {
    return 'vertical';
  }
  return undefined;
}

export function dominantOrientation(a: OrthogonalPoint, b: OrthogonalPoint): 'horizontal' | 'vertical' {
  return Math.abs(a.x - b.x) >= Math.abs(a.y - b.y) ? 'horizontal' : 'vertical';
}

export interface MoveResult {
  points: OrthogonalPoint[];
  newIndex: number;
}

export function moveRouteSegment(points: OrthogonalPoint[], segmentIndex: number, pointer: OrthogonalPoint): MoveResult {
  const next = points.map((point) => ({ ...point }));
  const orientation = segmentOrientation(next[segmentIndex], next[segmentIndex + 1])
    ?? dominantOrientation(next[segmentIndex], next[segmentIndex + 1]);
  const snappedPointer = snapPoint(pointer);

  let startIndex = segmentIndex;
  let endIndex = segmentIndex + 1;

  // Expand start of the collinear run
  while (startIndex > 0 && segmentOrientation(next[startIndex - 1], next[startIndex]) === orientation) {
    startIndex -= 1;
  }
  // Expand end of the collinear run
  while (endIndex < next.length - 1 && segmentOrientation(next[endIndex], next[endIndex + 1]) === orientation) {
    endIndex += 1;
  }

  let finalSegmentIndex = segmentIndex;

  // Smart Split at Start: If we expanded to index 0, it means we are slanting the handle attachment.
  if (startIndex === 0) {
    // Insert a copy of the lead point to become the new bend.
    next.splice(1, 0, { ...next[1] });
    startIndex = 2;
    endIndex += 1;
    finalSegmentIndex += 1;
  }

  // Smart Split at End: Same for the trailing lead.
  if (endIndex === next.length - 1) {
    // Insert a copy of the lead point before the last point.
    next.splice(next.length - 1, 0, { ...next[next.length - 2] });
    endIndex -= 1; // Stop update before the last point (which is now the target handle)
  }

  if (orientation === 'horizontal') {
    for (let i = startIndex; i <= endIndex; i += 1) {
      if (i > 0 && i < next.length - 1) {
        next[i].y = snappedPointer.y;
      }
    }
  } else if (orientation === 'vertical') {
    for (let i = startIndex; i <= endIndex; i += 1) {
      if (i > 0 && i < next.length - 1) {
        next[i].x = snappedPointer.x;
      }
    }
  }

  return { points: next, newIndex: finalSegmentIndex };
}

export function snapPoint(point: OrthogonalPoint): OrthogonalPoint {
  return {
    x: snapToGrid(point.x),
    y: snapToGrid(point.y)
  };
}

export function snapToGrid(value: number): number {
  const grid = diagramSizing.gridSize;
  return Math.round(value / grid) * grid;
}

export function midpoint(a: OrthogonalPoint, b: OrthogonalPoint): OrthogonalPoint {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2
  };
}

// A point a short, fixed distance past the route's start, along its first
// leg — not the exact source point (that would sit on top of the port), and
// not the path's overall midpoint. Every branch of a fanout net starts at
// the same point regardless of where it ends up, so anchoring here (rather
// than at the middle of each branch's own route) keeps a shared net's label
// landing in the same place no matter which single branch ends up carrying it.
export function pointNearPathStart(points: OrthogonalPoint[]): OrthogonalPoint | undefined {
  if (points.length === 0) return undefined;
  if (points.length === 1) return points[0];
  const [start, next] = points;
  const dx = next.x - start.x;
  const dy = next.y - start.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return start;
  const offset = Math.min(24, distance / 2);
  return {
    x: start.x + (dx / distance) * offset,
    y: start.y + (dy / distance) * offset
  };
}

function horizontalOverlap(rect: NodeObstacle, minX: number, maxX: number): boolean {
  return rect.x < maxX && rect.x + rect.width > minX;
}

function verticalOverlap(rect: NodeObstacle, minY: number, maxY: number): boolean {
  return rect.y < maxY && rect.y + rect.height > minY;
}

function segmentIntersectsObstacle(start: OrthogonalPoint, end: OrthogonalPoint, rect: NodeObstacle): boolean {
  const epsilon = 0.5;
  if (Math.abs(start.y - end.y) < epsilon) {
    return start.y > rect.y + epsilon
      && start.y < rect.y + rect.height - epsilon
      && Math.min(start.x, end.x) < rect.x + rect.width - epsilon
      && Math.max(start.x, end.x) > rect.x + epsilon;
  }

  if (Math.abs(start.x - end.x) < epsilon) {
    return start.x > rect.x + epsilon
      && start.x < rect.x + rect.width - epsilon
      && Math.min(start.y, end.y) < rect.y + rect.height - epsilon
      && Math.max(start.y, end.y) > rect.y + epsilon;
  }

  return false;
}

function routeIntersectsAnyObstacle(points: OrthogonalPoint[], obstacles: NodeObstacle[]): boolean {
  return points.slice(0, -1).some((point, index) => {
    const next = points[index + 1];
    return obstacles.some((obstacle) => segmentIntersectsObstacle(point, next, obstacle));
  });
}

export function avoidFeedbackObstacles(
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
    if (crossed.length === 0 || !routeIntersectsAnyObstacle(points, crossed)) {
      return points;
    }

    const maxY = Math.max(...crossed.map((rect) => rect.y + rect.height));
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
    if (crossed.length === 0 || !routeIntersectsAnyObstacle(points, crossed)) {
      return points;
    }

    const maxX = Math.max(...crossed.map((rect) => rect.x + rect.width));
    const direction = isBottomFeedback ? 1 : -1;
    const outerY = direction > 0
      ? Math.max(sourceLead.y, targetLead.y, ...crossed.map((rect) => rect.y + rect.height)) + grid
      : Math.min(sourceLead.y, targetLead.y, ...crossed.map((rect) => rect.y)) - grid;
    const loopY = snapToGrid(outerY);
    const loopX = snapToGrid(maxX + grid);

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
