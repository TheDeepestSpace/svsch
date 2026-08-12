import type { ArrayConnection } from './NodeSvgProps';

export function hasArrayConnection(
  arrayConnections: ArrayConnection[] | undefined,
  portId: string | undefined,
  role: 'source' | 'target'
): boolean {
  return (arrayConnections ?? []).some((c) => c.portId === portId && c.role === role);
}

export function arrayConnectionThick(
  arrayConnections: ArrayConnection[] | undefined,
  portId: string | undefined,
  role: 'source' | 'target'
): boolean {
  return (arrayConnections ?? []).find((c) => c.portId === portId && c.role === role)?.thick ?? false;
}
