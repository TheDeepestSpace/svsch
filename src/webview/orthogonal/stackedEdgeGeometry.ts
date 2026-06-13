import { pathFromPoints, type OrthogonalPoint } from '../../core/pathUtils';
import {
  ARRAY_STACK_LAYERS,
  ARRAY_STACK_LEAD_LAYERS,
  arrayStackLayerTrim,
  type ArrayStackLayerId
} from '../arrayStackGeometry';
import { makeOrthogonal } from './logic';
import { HdlPosition } from './types';

export interface PromotedStackFanout {
  trunk: string;
  bar: string;
  barStart: OrthogonalPoint;
  barEnd: OrthogonalPoint;
  branches: Array<{ layerId: ArrayStackLayerId; path: string }>;
}

export interface ConvergingStackPath {
  layerId: ArrayStackLayerId;
  path: string;
  start: OrthogonalPoint;
  end: OrthogonalPoint;
}

export function offsetPoints(points: OrthogonalPoint[], dx: number, dy: number): OrthogonalPoint[] {
  return points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
}

export function shortenStackTarget(points: OrthogonalPoint[], amount: number, targetPosition: HdlPosition): OrthogonalPoint[] {
  if (points.length === 0 || amount === 0) return points;
  const next = points.map((point) => ({ ...point }));
  const last = next[next.length - 1];
  if (targetPosition === HdlPosition.Left) last.x -= amount;
  else if (targetPosition === HdlPosition.Right) last.x += amount;
  else if (targetPosition === HdlPosition.Top) last.y -= amount;
  else if (targetPosition === HdlPosition.Bottom) last.y += amount;
  return next;
}

export function offsetPointsForArrayStackLayer(points: OrthogonalPoint[], layerId: ArrayStackLayerId): OrthogonalPoint[] {
  const layer = ARRAY_STACK_LAYERS[layerId];
  return offsetPoints(points, layer.dx, layer.dy);
}

export function shortenStackSource(points: OrthogonalPoint[], amount: number, sourcePosition: HdlPosition): OrthogonalPoint[] {
  if (points.length === 0 || amount === 0) return points;
  const next = points.map((point) => ({ ...point }));
  const first = next[0];
  if (sourcePosition === HdlPosition.Left) first.x -= amount;
  else if (sourcePosition === HdlPosition.Right) first.x += amount;
  else if (sourcePosition === HdlPosition.Top) first.y -= amount;
  else if (sourcePosition === HdlPosition.Bottom) first.y += amount;
  return next;
}

export function stackedLayerEdgeClass(layerId: ArrayStackLayerId): string {
  if (layerId === 'front') return 'svsch-edge-stacked-front';
  if (layerId === 'back') return 'svsch-edge-stacked-back';
  return 'svsch-edge-stacked';
}

export function stackedLayerGradientStopClass(layerId: ArrayStackLayerId): string {
  if (layerId === 'front') return 'svsch-stack-gradient-front-stop';
  if (layerId === 'back') return 'svsch-stack-gradient-back-stop';
  return 'svsch-stack-gradient-middle-stop';
}

export function stableFragmentId(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash, 31) + value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function dropFinalApproachStub(points: OrthogonalPoint[], targetPosition: HdlPosition): OrthogonalPoint[] {
  if (points.length < 3) return points;
  const last = points[points.length - 1];
  const penult = points[points.length - 2];
  if (
    (targetPosition === HdlPosition.Left || targetPosition === HdlPosition.Right)
    && Math.abs(last.x - penult.x) < 0.5
  ) {
    return points.slice(0, -1);
  }
  if (
    (targetPosition === HdlPosition.Top || targetPosition === HdlPosition.Bottom)
    && Math.abs(last.y - penult.y) < 0.5
  ) {
    return points.slice(0, -1);
  }
  return points;
}

export function convergingStackPath(
  points: OrthogonalPoint[],
  layerId: ArrayStackLayerId,
  sourcePosition: HdlPosition,
  targetPosition: HdlPosition
): ConvergingStackPath | undefined {
  if (points.length < 2) return undefined;

  const offsetted = offsetPointsForArrayStackLayer(points, layerId);
  const rawTarget = points[points.length - 1];
  const last = offsetted[offsetted.length - 1];

  if (targetPosition === HdlPosition.Left || targetPosition === HdlPosition.Right) {
    last.x = rawTarget.x;
  } else {
    last.y = rawTarget.y;
  }

  const orthogonal = makeOrthogonal(points);
  const layerPoints = shortenStackSource(
    dropFinalApproachStub(
      orthogonal.map((point, index) => (
        index === orthogonal.length - 1 ? last : offsetPointsForArrayStackLayer([point], layerId)[0]
      )),
      targetPosition
    ),
    arrayStackLayerTrim(layerId),
    sourcePosition
  );
  const start = layerPoints[0];
  const end = layerPoints[layerPoints.length - 1];

  if (!start || !end) return undefined;

  return {
    layerId,
    path: pathFromPoints(layerPoints),
    start,
    end
  };
}

export function promotedStackFanoutPath(
  points: OrthogonalPoint[],
  targetPosition: HdlPosition,
  splitDistance: number
): PromotedStackFanout | undefined {
  if (points.length < 2) return undefined;

  const target = points[points.length - 1];
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
    bar: pathFromPoints([branchStarts[0], branchStarts[branchStarts.length - 1]]),
    branches: branchTargets.map((branchTarget, index) => ({
      layerId: ARRAY_STACK_LEAD_LAYERS[index].id,
      path: pathFromPoints([branchStarts[index], branchTarget])
    }))
  };
}
