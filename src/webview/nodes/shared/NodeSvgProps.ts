import type { DiagramNode } from '../../../ir/types';

export interface ArrayConnection {
  portId?: string;
  role: 'source' | 'target';
}

export interface NodeSvgProps {
  node: DiagramNode;
  width: number;
  height: number;
  arrayConnections?: ArrayConnection[];
}
