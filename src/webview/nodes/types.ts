import { type Node } from '@xyflow/react';
import type { PositionedNode } from '../../ir/types';

export interface HdlNodeData {
  [key: string]: unknown;
  node: PositionedNode;
  moduleName?: string;
  arrayConnections?: ArrayStackConnection[];
}

export type HdlFlowNode = Node<HdlNodeData>;

export interface ArrayStackConnection {
  portId?: string;
  role: 'source' | 'target';
}
