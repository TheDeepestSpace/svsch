import { type Node } from '@xyflow/react';
import type { PositionedNode } from '../../ir/types';
import type { ExpandContentInsets } from '../expand/splice';

export interface HdlNodeData {
  [key: string]: unknown;
  node: PositionedNode;
  moduleName?: string;
  arrayConnections?: ArrayStackConnection[];
  /**
   * Present only while this node is an expanded instance's dimmed frame (see
   * expandOverlay's dimAsExpandGhost): the border-ring widths HdlNode turns
   * into pointer-enabled grab bands, leaving the sub-diagram area inside the
   * frame pointer-transparent.
   */
  expandContentInsets?: ExpandContentInsets;
}

export type HdlFlowNode = Node<HdlNodeData>;

export interface ArrayStackConnection {
  portId?: string;
  role: 'source' | 'target';
  thick?: boolean;
}
