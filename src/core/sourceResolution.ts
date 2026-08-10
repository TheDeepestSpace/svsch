import type { DesignGraph, DiagramEdge, SourceRange } from '../ir/types';

/**
 * Resolves the source range for a given edge (signal) within a module.
 * Checks the edge's sourceRange, then ports, and falls back to internal nodes (register, comb, alu, inverter).
 */
export function resolveSignalSource(
  graph: DesignGraph,
  moduleName: string,
  edge: DiagramEdge
): SourceRange | undefined {
  if (!edge.signal) {
    return undefined;
  }

  if (edge.sourceRange) {
    return edge.sourceRange;
  }

  const module = graph.modules[moduleName];
  if (!module) {
    return undefined;
  }

  // Try to find the signal declaration in ports
  const port = module.ports.find((p) => p.name === edge.signal);
  if (port?.source) {
    return port.source;
  }

  // Try finding an internal node representing this signal
  const sourceNode = module.nodes.find(
    (n) =>
      n.label === edge.signal &&
      (n.kind === 'register' ||
        n.kind === 'comb' ||
        n.kind === 'alu' ||
        n.kind === 'inverter' ||
        n.kind === 'gate')
  );
  if (sourceNode?.source) {
    return sourceNode.source;
  }

  return undefined;
}
