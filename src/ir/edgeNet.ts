import type { DiagramEdge } from './types';

export function endpointKey(nodeId: string, portId?: string): string {
  return portId ? `${nodeId}:${portId}` : nodeId;
}

export function edgeNetKey(edge: Pick<DiagramEdge, 'source' | 'sourcePort' | 'metadata'>): string {
  if (edge.metadata?.cutStub) {
    return edge.metadata.cutStub.netKey;
  }
  if (edge.source.startsWith('literal:')) {
    return edge.source;
  }
  return endpointKey(edge.source, edge.sourcePort);
}
