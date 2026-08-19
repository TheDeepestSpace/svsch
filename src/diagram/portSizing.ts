import { diagramSizing } from './constants';
import {
  measureText,
  portNodeLabel,
  snappedWidth,
  type NodeSizingStrategy,
} from './nodeSizingCommon';

export const portSizing: NodeSizingStrategy = {
  height: () => diagramSizing.portHeight,
  width: (node) =>
    snappedWidth(
      diagramSizing.portWidth,
      measureText(portNodeLabel(node)) +
        diagramSizing.portNoseLength +
        diagramSizing.portHorizontalPadding,
    ),
};
