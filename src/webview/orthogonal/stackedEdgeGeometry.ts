import { pathFromPoints, type OrthogonalPoint } from '../../core/pathUtils';
import {
  arrayStackLayer,
  arrayStackLeadLayersFor,
  arrayStackLayerTrim,
  type ArrayStackLayerId,
} from '../arrayStackGeometry';
import { arrayBreakoutPipeCapPivot, arrayCompositionPipeCapPivot } from '../../diagram/busGeometry';
import { diagramNodeDimensions } from '../../diagram/nodeSizing';
import type { PositionedNode } from '../../ir/types';
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

export function shortenStackTarget(
  points: OrthogonalPoint[],
  amount: number,
  targetPosition: HdlPosition,
): OrthogonalPoint[] {
  if (points.length === 0 || amount === 0) return points;
  const next = points.map((point) => ({ ...point }));
  const last = next[next.length - 1];
  if (targetPosition === HdlPosition.Left) last.x -= amount;
  else if (targetPosition === HdlPosition.Right) last.x += amount;
  else if (targetPosition === HdlPosition.Top) last.y -= amount;
  else if (targetPosition === HdlPosition.Bottom) last.y += amount;
  return next;
}

export function offsetPointsForArrayStackLayer(
  points: OrthogonalPoint[],
  layerId: ArrayStackLayerId,
  wide = false,
): OrthogonalPoint[] {
  const layer = arrayStackLayer(layerId, wide);
  return offsetPoints(points, layer.dx, layer.dy);
}

/**
 * Array-breakout bus pipes cap their merge point with a rect rotated 45°
 * about a fixed pivot (see arrayBreakoutPipeCapPivot / BusNodeSvg's pipeCap).
 * A stacked layer's own fan-out offset (dx=dy, applied by
 * offsetPointsForArrayStackLayer) moves it exactly along that same 45°
 * direction, so it never changes the layer's perpendicular distance from the
 * cap's centerline — only how far along the centerline it sits. That means
 * aligning any one layer's raw (pre-offset) target onto the centerline
 * aligns all layers onto it identically, regardless of their fan-out.
 *
 * This computes the horizontal-only shift (matching shortenStackTarget's
 * Left/Right sign convention) that does that alignment: for a point at
 * (dx, dy) from the pivot, moving x by (dx - dy) makes the point's
 * perpendicular offset from the pivot's 45° line exactly zero.
 */
export function horizontalShiftOntoDiagonal(
  point: OrthogonalPoint,
  pivot: OrthogonalPoint,
): number {
  return point.x - pivot.x - (point.y - pivot.y);
}

/**
 * Direction-aware wrapper around horizontalShiftOntoDiagonal: returns the
 * value to pass as `amount` into shortenStackTarget/shortenStackSource so
 * the resulting point lands on `pivot`'s 45° diagonal — regardless of
 * whether that function adds the amount (Right) or subtracts it (Left).
 */
function capAlignmentTrim(
  point: OrthogonalPoint,
  pivot: OrthogonalPoint,
  hdlPosition: HdlPosition,
): number {
  const delta = horizontalShiftOntoDiagonal(point, pivot);
  return hdlPosition === HdlPosition.Right ? -delta : delta;
}

export interface StackedEdgeLayerPoints {
  back: OrthogonalPoint[];
  middle: OrthogonalPoint[];
  front: OrthogonalPoint[];
}

export interface StackedEdgeLayerPointsOptions {
  points: OrthogonalPoint[];
  sourceHdlPosition: HdlPosition;
  targetHdlPosition: HdlPosition;
  sourceIsArray: boolean;
  sourceIsArrayComposition: boolean;
  targetIsArray: boolean;
  targetIsArrayBreakout: boolean;
  /** Required when sourceIsArrayComposition is true, to locate its pipe cap's pivot. */
  sourceNode: PositionedNode | undefined;
  /** Required when targetIsArrayBreakout is true, to locate its pipe cap's pivot. */
  targetNode: PositionedNode | undefined;
  isThickWire: boolean;
}

/**
 * Computes the three parallel wire paths (back/middle/front) for a "stacked"
 * edge touching an array-visualized node. Shared by the live webview
 * (OrthogonalEdge) and the CLI/static exporter (svgRenderer) so this routing
 * — including the array-breakout/composition pipe-cap alignment below —
 * only needs fixing in one place.
 */
export function computeStackedEdgeLayerPoints(
  options: StackedEdgeLayerPointsOptions,
): StackedEdgeLayerPoints {
  const {
    points,
    sourceHdlPosition,
    targetHdlPosition,
    sourceIsArray,
    sourceIsArrayComposition,
    sourceNode,
    targetIsArray,
    targetIsArrayBreakout,
    targetNode,
    isThickWire,
  } = options;

  const rawSource = points[0];
  const rawTarget = points[points.length - 1];

  const arrayBreakoutCapTrim =
    targetIsArrayBreakout && targetNode
      ? (() => {
          const localPivot = arrayBreakoutPipeCapPivot(targetNode);
          const pivot = {
            x: targetNode.position.x + localPivot.x,
            y: targetNode.position.y + localPivot.y,
          };
          return capAlignmentTrim(rawTarget, pivot, targetHdlPosition);
        })()
      : 0;

  const arrayCompositionCapTrim =
    sourceIsArrayComposition && sourceNode
      ? (() => {
          const width = diagramNodeDimensions(sourceNode).width;
          const localPivot = arrayCompositionPipeCapPivot(sourceNode, width);
          const pivot = {
            x: sourceNode.position.x + localPivot.x,
            y: sourceNode.position.y + localPivot.y,
          };
          return capAlignmentTrim(rawSource, pivot, sourceHdlPosition);
        })()
      : 0;

  const applyTargetTrim = (layerId: ArrayStackLayerId, layerPoints: OrthogonalPoint[]) =>
    shortenStackTarget(
      layerPoints,
      targetIsArrayBreakout
        ? arrayBreakoutCapTrim
        : targetIsArray
          ? arrayStackLayerTrim(layerId, isThickWire)
          : 0,
      targetHdlPosition,
    );

  const applySourceTrim = (layerId: ArrayStackLayerId, layerPoints: OrthogonalPoint[]) =>
    shortenStackSource(
      layerPoints,
      sourceIsArray
        ? sourceIsArrayComposition
          ? arrayCompositionCapTrim
          : arrayStackLayerTrim(layerId, isThickWire)
        : 0,
      sourceHdlPosition,
    );

  return {
    back: applyTargetTrim(
      'back',
      applySourceTrim(
        'back',
        makeOrthogonal(offsetPointsForArrayStackLayer(points, 'back', isThickWire)),
      ),
    ),
    middle: applyTargetTrim('middle', applySourceTrim('middle', makeOrthogonal(points))),
    front: applyTargetTrim(
      'front',
      applySourceTrim(
        'front',
        makeOrthogonal(offsetPointsForArrayStackLayer(points, 'front', isThickWire)),
      ),
    ),
  };
}

export function shortenStackSource(
  points: OrthogonalPoint[],
  amount: number,
  sourcePosition: HdlPosition,
): OrthogonalPoint[] {
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

function dropFinalApproachStub(
  points: OrthogonalPoint[],
  targetPosition: HdlPosition,
): OrthogonalPoint[] {
  if (points.length < 3) return points;
  const last = points[points.length - 1];
  const penult = points[points.length - 2];
  if (
    (targetPosition === HdlPosition.Left || targetPosition === HdlPosition.Right) &&
    Math.abs(last.x - penult.x) < 0.5
  ) {
    return points.slice(0, -1);
  }
  if (
    (targetPosition === HdlPosition.Top || targetPosition === HdlPosition.Bottom) &&
    Math.abs(last.y - penult.y) < 0.5
  ) {
    return points.slice(0, -1);
  }
  return points;
}

export function convergingStackPath(
  points: OrthogonalPoint[],
  layerId: ArrayStackLayerId,
  sourcePosition: HdlPosition,
  targetPosition: HdlPosition,
  wide = false,
): ConvergingStackPath | undefined {
  if (points.length < 2) return undefined;

  const offsetted = offsetPointsForArrayStackLayer(points, layerId, wide);
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
      orthogonal.map((point, index) =>
        index === orthogonal.length - 1
          ? last
          : offsetPointsForArrayStackLayer([point], layerId, wide)[0],
      ),
      targetPosition,
    ),
    arrayStackLayerTrim(layerId, wide),
    sourcePosition,
  );
  const start = layerPoints[0];
  const end = layerPoints[layerPoints.length - 1];

  if (!start || !end) return undefined;

  return {
    layerId,
    path: pathFromPoints(layerPoints),
    start,
    end,
  };
}

export function promotedStackFanoutPath(
  points: OrthogonalPoint[],
  targetPosition: HdlPosition,
  splitDistance: number,
  wide = false,
): PromotedStackFanout | undefined {
  if (points.length < 2) return undefined;

  const target = points[points.length - 1];
  let split: OrthogonalPoint;

  if (targetPosition === HdlPosition.Left) split = { x: target.x - splitDistance, y: target.y };
  else if (targetPosition === HdlPosition.Right)
    split = { x: target.x + splitDistance, y: target.y };
  else if (targetPosition === HdlPosition.Top) split = { x: target.x, y: target.y - splitDistance };
  else split = { x: target.x, y: target.y + splitDistance };

  const trunkPoints = makeOrthogonal([...points.slice(0, -1), split]);
  const leadLayers = arrayStackLeadLayersFor(wide);
  const branchStarts = leadLayers.map((layer) => ({
    x: split.x + layer.dx,
    y: split.y + layer.dy,
  }));
  const branchTargets = leadLayers.map(
    (layer) =>
      shortenStackTarget(
        [{ x: target.x + layer.dx, y: target.y + layer.dy }],
        arrayStackLayerTrim(layer.id, wide),
        targetPosition,
      )[0],
  );

  return {
    trunk: pathFromPoints(trunkPoints),
    barStart: branchStarts[0],
    barEnd: branchStarts[branchStarts.length - 1],
    bar: pathFromPoints([branchStarts[0], branchStarts[branchStarts.length - 1]]),
    branches: branchTargets.map((branchTarget, index) => ({
      layerId: leadLayers[index].id,
      path: pathFromPoints([branchStarts[index], branchTarget]),
    })),
  };
}
