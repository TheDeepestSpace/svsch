import type { DiagramPort } from '../ir/types';

/**
 * Ordinary nodes place inout ports in the input-side lane. Both the source and
 * target handle use that one physical pin, preserving left-to-right layout
 * without pretending that the bidirectional signal is input-only. Unknown
 * directions use the same conservative placement but do not gain a source
 * handle unless the renderer already provides one.
 *
 * Interface instances are the deliberate exception: scalar input/output ports
 * use the top/bottom caps while inout and unknown ports use side notches.
 */
export function isInputSidePort(port: Pick<DiagramPort, 'direction'>): boolean {
  return port.direction === 'input' || port.direction === 'inout' || port.direction === 'unknown';
}

export function isInoutPort(port: Pick<DiagramPort, 'direction'>): boolean {
  return port.direction === 'inout';
}
