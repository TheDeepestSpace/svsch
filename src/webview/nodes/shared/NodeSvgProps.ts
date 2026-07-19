import type { DiagramNode } from '../../../ir/types';
import type { SourceRange } from '../../../ir/types';

export interface ArrayConnection {
  portId?: string;
  role: 'source' | 'target';
  /**
   * Whether the stacked edge behind this connection carries multi-bit data.
   * Derived from the edge (both endpoints), not just this port's own
   * declared width — procedurally synthesized ports (register/mux ports
   * built from always_ff/case blocks) often lack a reliable width of their
   * own, so the edge-level signal is the authoritative one.
   */
  thick?: boolean;
}

export interface NodeSvgProps {
  node: DiagramNode;
  width: number;
  height: number;
  arrayConnections?: ArrayConnection[];
  /** Called when the user clicks a type/source link inside the SVG. Undefined in CLI context. */
  onNavigateToSource?: (source: SourceRange) => void;
}
