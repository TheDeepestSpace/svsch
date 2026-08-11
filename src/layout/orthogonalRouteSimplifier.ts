import { diagramSizing } from '../diagram/constants';

export interface OrthogonalRoutePoint {
  x: number;
  y: number;
}

export interface OrthogonalRouteObstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RouteInteractionMetrics {
  crossings: number;
  sharedLength: number;
}

const GEOMETRY_EPSILON = 0.001;

/**
 * Removes a one-grid-or-shorter U-turn from an orthogonal route when the
 * shorter replacement is clear of obstacles and does not add route
 * crossings or collinear overlap.
 */
export function simplifyOrthogonalRoute(
  route: OrthogonalRoutePoint[],
  obstacles: OrthogonalRouteObstacle[],
  peerRoutes: OrthogonalRoutePoint[][],
  maxExcursion = diagramSizing.gridSize
): OrthogonalRoutePoint[] {
  let simplified = removeRedundantPoints(route);

  while (true) {
    const next = findSimplification(simplified, obstacles, peerRoutes, maxExcursion);
    if (!next) return simplified;
    simplified = next;
  }
}

function findSimplification(
  route: OrthogonalRoutePoint[],
  obstacles: OrthogonalRouteObstacle[],
  peerRoutes: OrthogonalRoutePoint[][],
  maxExcursion: number
): OrthogonalRoutePoint[] | undefined {
  const originalInteractions = routeInteractionMetrics(route, peerRoutes);

  for (let index = 0; index + 3 < route.length; index += 1) {
    const start = route[index];
    const firstTurn = route[index + 1];
    const secondTurn = route[index + 2];
    const end = route[index + 3];
    const first = segmentVector(start, firstTurn);
    const middle = segmentVector(firstTurn, secondTurn);
    const last = segmentVector(secondTurn, end);

    if (
      first.axis === undefined
      || middle.axis === undefined
      || last.axis === undefined
      || first.axis !== last.axis
      || first.axis === middle.axis
      || first.direction === last.direction
    ) {
      continue;
    }

    const elbows: OrthogonalRoutePoint[] = [];
    const alternateElbows: OrthogonalRoutePoint[] = [];
    if (first.length <= maxExcursion + GEOMETRY_EPSILON) {
      elbows.push(first.axis === 'vertical'
        ? { x: secondTurn.x, y: start.y }
        : { x: start.x, y: secondTurn.y });
      alternateElbows.push(first.axis === 'vertical'
        ? { x: firstTurn.x, y: end.y }
        : { x: end.x, y: firstTurn.y });
    }
    if (last.length <= maxExcursion + GEOMETRY_EPSILON) {
      elbows.push(last.axis === 'vertical'
        ? { x: firstTurn.x, y: end.y }
        : { x: end.x, y: firstTurn.y });
      alternateElbows.push(last.axis === 'vertical'
        ? { x: secondTurn.x, y: start.y }
        : { x: start.x, y: secondTurn.y });
    }

    const localLength = first.length + middle.length + last.length;
    const candidatesFor = (candidateElbows: OrthogonalRoutePoint[]) => candidateElbows
      .filter((elbow, elbowIndex) => (
        candidateElbows.findIndex((candidate) => pointsEqual(candidate, elbow)) === elbowIndex
      ))
      .filter((elbow) => (
        segmentLength(start, elbow) + segmentLength(elbow, end)
        < localLength - GEOMETRY_EPSILON
      ))
      .filter((elbow) => replacementIsObstacleSafe(start, elbow, end, obstacles))
      .map((elbow) => removeRedundantPoints([
        ...route.slice(0, index + 1),
        elbow,
        ...route.slice(index + 3)
      ]))
      .filter((candidate) => endpointDirectionsMatch(route, candidate))
      .map((candidate) => ({
        route: candidate,
        interactions: routeInteractionMetrics(candidate, peerRoutes),
        length: routeLength(candidate)
      }))
      .filter(({ interactions }) => (
        interactions.crossings <= originalInteractions.crossings
        && interactions.sharedLength <= originalInteractions.sharedLength + GEOMETRY_EPSILON
      ))
      .sort((left, right) => (
        left.interactions.crossings - right.interactions.crossings
        || left.interactions.sharedLength - right.interactions.sharedLength
        || left.length - right.length
        || routeKey(left.route).localeCompare(routeKey(right.route))
      ));

    const preferred = candidatesFor(elbows)[0];
    if (preferred) return preferred.route;

    // Both elbows shorten the same U-turn. Prefer the one that collapses the
    // short outer segment, but if an obstacle blocks it, the mirrored elbow
    // can still remove the dogleg without changing endpoint directions.
    const alternate = candidatesFor(alternateElbows)[0];
    if (alternate) return alternate.route;
  }

  return undefined;
}

function replacementIsObstacleSafe(
  start: OrthogonalRoutePoint,
  elbow: OrthogonalRoutePoint,
  end: OrthogonalRoutePoint,
  obstacles: OrthogonalRouteObstacle[]
): boolean {
  return obstacles.every((obstacle) => (
    !segmentIntersectsRectInterior(start, elbow, obstacle)
    && !segmentIntersectsRectInterior(elbow, end, obstacle)
  ));
}

function segmentIntersectsRectInterior(
  start: OrthogonalRoutePoint,
  end: OrthogonalRoutePoint,
  rect: OrthogonalRouteObstacle
): boolean {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;

  if (start.y === end.y) {
    return start.y > top && start.y < bottom
      && Math.max(start.x, end.x) > left
      && Math.min(start.x, end.x) < right;
  }
  if (start.x === end.x) {
    return start.x > left && start.x < right
      && Math.max(start.y, end.y) > top
      && Math.min(start.y, end.y) < bottom;
  }
  return true;
}

function routeInteractionMetrics(
  route: OrthogonalRoutePoint[],
  peers: OrthogonalRoutePoint[][]
): RouteInteractionMetrics {
  let crossings = 0;
  let sharedLength = 0;
  const routeSegments = segments(route);

  for (const peer of peers) {
    for (const current of routeSegments) {
      for (const other of segments(peer)) {
        if (current.axis === other.axis) {
          sharedLength += collinearOverlapLength(current, other);
        } else if (segmentsCross(current, other)) {
          crossings += 1;
        }
      }
    }
  }

  return { crossings, sharedLength };
}

function segmentsCross(
  first: RouteSegment,
  second: RouteSegment
): boolean {
  const horizontal = first.axis === 'horizontal' ? first : second;
  const vertical = first.axis === 'vertical' ? first : second;
  return within(horizontal.start.x, horizontal.end.x, vertical.start.x)
    && within(vertical.start.y, vertical.end.y, horizontal.start.y);
}

function collinearOverlapLength(first: RouteSegment, second: RouteSegment): number {
  if (first.axis === 'horizontal') {
    if (first.start.y !== second.start.y) return 0;
    return intervalOverlap(first.start.x, first.end.x, second.start.x, second.end.x);
  }
  if (first.start.x !== second.start.x) return 0;
  return intervalOverlap(first.start.y, first.end.y, second.start.y, second.end.y);
}

function intervalOverlap(firstStart: number, firstEnd: number, secondStart: number, secondEnd: number): number {
  const start = Math.max(Math.min(firstStart, firstEnd), Math.min(secondStart, secondEnd));
  const end = Math.min(Math.max(firstStart, firstEnd), Math.max(secondStart, secondEnd));
  return Math.max(0, end - start);
}

function within(start: number, end: number, value: number): boolean {
  return value >= Math.min(start, end) && value <= Math.max(start, end);
}

type RouteAxis = 'horizontal' | 'vertical';

interface RouteSegment {
  start: OrthogonalRoutePoint;
  end: OrthogonalRoutePoint;
  axis: RouteAxis;
}

function segments(route: OrthogonalRoutePoint[]): RouteSegment[] {
  return route.slice(1).flatMap((end, index): RouteSegment[] => {
    const start = route[index];
    if (start.x === end.x && start.y !== end.y) return [{ start, end, axis: 'vertical' }];
    if (start.y === end.y && start.x !== end.x) return [{ start, end, axis: 'horizontal' }];
    return [];
  });
}

function segmentVector(
  start: OrthogonalRoutePoint,
  end: OrthogonalRoutePoint
): { axis: RouteAxis | undefined; direction: number; length: number } {
  if (start.x === end.x && start.y !== end.y) {
    return { axis: 'vertical', direction: Math.sign(end.y - start.y), length: Math.abs(end.y - start.y) };
  }
  if (start.y === end.y && start.x !== end.x) {
    return { axis: 'horizontal', direction: Math.sign(end.x - start.x), length: Math.abs(end.x - start.x) };
  }
  return { axis: undefined, direction: 0, length: 0 };
}

function endpointDirectionsMatch(
  original: OrthogonalRoutePoint[],
  candidate: OrthogonalRoutePoint[]
): boolean {
  if (original.length < 2 || candidate.length < 2) return original.length === candidate.length;
  const originalStart = segmentVector(original[0], original[1]);
  const candidateStart = segmentVector(candidate[0], candidate[1]);
  const originalEnd = segmentVector(original[original.length - 2], original[original.length - 1]);
  const candidateEnd = segmentVector(candidate[candidate.length - 2], candidate[candidate.length - 1]);
  return originalStart.axis === candidateStart.axis
    && originalStart.direction === candidateStart.direction
    && originalEnd.axis === candidateEnd.axis
    && originalEnd.direction === candidateEnd.direction;
}

function removeRedundantPoints(route: OrthogonalRoutePoint[]): OrthogonalRoutePoint[] {
  const deduplicated = route.filter((point, index) => (
    index === 0 || !pointsEqual(point, route[index - 1])
  ));
  return deduplicated.filter((point, index) => {
    if (index === 0 || index === deduplicated.length - 1) return true;
    const previous = deduplicated[index - 1];
    const next = deduplicated[index + 1];
    return !(
      (previous.x === point.x && point.x === next.x)
      || (previous.y === point.y && point.y === next.y)
    );
  });
}

function routeLength(route: OrthogonalRoutePoint[]): number {
  return route.slice(1).reduce((total, point, index) => (
    total + segmentLength(route[index], point)
  ), 0);
}

function segmentLength(start: OrthogonalRoutePoint, end: OrthogonalRoutePoint): number {
  return Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
}

function pointsEqual(first: OrthogonalRoutePoint, second: OrthogonalRoutePoint): boolean {
  return first.x === second.x && first.y === second.y;
}

function routeKey(route: OrthogonalRoutePoint[]): string {
  return route.map((point) => `${point.x},${point.y}`).join(';');
}
