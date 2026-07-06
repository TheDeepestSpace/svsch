import type { DiagramEdge } from '../ir/types';

// Paint order for edges sharing a trunk: inactive edges render below, active ones
// on top, so an overlap between an active and an inactive arm's route always shows
// the active style. Ties keep the stable id order.
export function compareEdgePaintOrder(a: DiagramEdge, b: DiagramEdge): number {
  return edgeStateRank(a) - edgeStateRank(b) || a.id.localeCompare(b.id);
}

function edgeStateRank(edge: DiagramEdge): number {
  const state = edge.metadata?.generateActiveState;
  if (state === 'inactive') return 0;
  if (state === 'active') return 2;
  return 1;
}
