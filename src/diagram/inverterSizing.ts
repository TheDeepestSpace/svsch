import { diagramSizing, snapUpToEvenGrid } from './constants';
import { inverterGeometryWidth, type NodeSizingStrategy } from './nodeSizingCommon';

export const inverterSizing: NodeSizingStrategy = {
  height: () => diagramSizing.gridSize * 2,
  width: () => snapUpToEvenGrid(inverterGeometryWidth())
};
