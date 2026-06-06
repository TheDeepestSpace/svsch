import type { DiagramNode } from '../../../ir/types';
import type { SourceRange } from '../../../ir/types';

export interface ArrayConnection {
  portId?: string;
  role: 'source' | 'target';
}

export interface NodeSvgProps {
  node: DiagramNode;
  width: number;
  height: number;
  arrayConnections?: ArrayConnection[];
  /** Called when the user clicks a type/source link inside the SVG. Undefined in CLI context. */
  onNavigateToSource?: (source: SourceRange) => void;
}
