import type {
  DesignModule,
  DiagramEdge,
  DiagramNode,
  DiagramPort,
  PositionedGenerateRegion,
  PositionedNode,
} from '../../ir/types';
import { diagramSizing, nodePortCenterOffset, snapUpToGrid } from '../../diagram/constants';
import { diagramNodeDimensions, resolvedNodeDimensions } from '../../diagram/nodeSizing';
import { isInputSidePort } from '../../diagram/portDirection';
import { edgeIsThick, portSuggestsThickWire } from '../../ir/edgeStyle';

// Mirrors SavedNodeLayout / SavedExpandedInstanceLayout in
// src/storage/layoutStore.ts (not imported directly — that file imports
// `node:fs`/`node:path` and lives outside the webview tsconfig project,
// which has no Node types configured; see ExpandInstancePayload in
// main.tsx for the same reason applied to diagramPanel.ts). Extension-host
// code (diagramPanel.ts) round-trips these as plain JSON over postMessage,
// so keeping the two declarations in sync by hand is the cost of that
// boundary — same tradeoff GraphMessage/StatusMessage already accept.
export interface SavedNodeLayout {
  x: number;
  y: number;
  stale?: boolean;
  fixed?: boolean;
  width?: number;
  height?: number;
}

export interface SavedExpandedInstanceLayout {
  childModuleName: string;
  nodes: Record<string, SavedNodeLayout>;
  bounds?: { x: number; y: number; width: number; height: number };
  fixed?: boolean;
  instanceOrigin?: { x: number; y: number };
}

/**
 * "Expand instance in place" (issue #232) splices a child module's own graph
 * into the parent module's canvas. The heavy lifting — the child's own
 * standalone place-and-route (the exact same ELK + libavoid pipeline
 * `openModule` renders with), dropping the port nodes, and libavoid-routing
 * the boundary-port stubs into the placed content — happens host-side in
 * src/layout/expandLayout.ts, because libavoid's wasm runtime isn't loadable
 * under the webview's CSP sandbox. This module turns that frame-local result
 * into canvas-space spliced nodes/edges (and still owns the fallback
 * ELK-only placement used when the host couldn't produce a layout).
 *
 * This module is deliberately framework-free (no React, no vscode API) so
 * the splicing/layout math is unit-testable in isolation — main.tsx owns
 * turning the result into React Flow nodes/edges and wiring it into the
 * existing generate-region drag-sync machinery (see webview/main.tsx's
 * `regions` state, which this reuses via `kind: 'expand'`).
 */

export const EXPAND_ID_PREFIX = 'expand:';
const EXPAND_NS_SEP = '::';

/**
 * Extends a (possibly already-nested) expand namespace with one more
 * instance id — see `spliceExpandedInstance`'s `namespace` param for
 * nested/recursive Expand.
 */
export function childNamespace(namespace: string, instanceId: string): string {
  return namespace ? `${namespace}${EXPAND_NS_SEP}${instanceId}` : instanceId;
}

/**
 * A namespaced id for a node/edge spliced in under the given expand
 * namespace, built from the child module's own local id for that node/edge.
 */
export function namespacedId(namespace: string, localId: string): string {
  return `${EXPAND_ID_PREFIX}${namespace}${EXPAND_NS_SEP}${localId}`;
}

export function isExpandNamespacedId(id: string): boolean {
  return id.startsWith(EXPAND_ID_PREFIX);
}

export function expandRegionId(namespace: string): string {
  return `${EXPAND_ID_PREFIX}region${EXPAND_NS_SEP}${namespace}`;
}

/**
 * The host-computed splice layout (see src/layout/expandLayout.ts): the child
 * module's standalone place-and-route result with its port nodes replaced by
 * placed boundary-port nodes and the port-touching wires re-routed by
 * libavoid against the placed content. Everything is in frame-local
 * coordinates — the expanded node's own top-left corner is (0, 0) — and
 * child-module-local ids; `spliceExpandedInstance` translates it to canvas
 * space and namespaces the ids.
 */
export interface ExpandSpliceLayout {
  /** Boundary nodes first, then internal content nodes. */
  nodes: PositionedNode[];
  edges: DiagramEdge[];
  expandedSize: { width: number; height: number };
}

export interface SpliceInput {
  /**
   * Unique path of instance ids down to (and including) the instance being
   * expanded — e.g. "u0" or "u0::u1" for an expand nested inside another
   * expand.
   */
  namespace: string;
  /**
   * Id (within `namespace`'s immediate parent scope) of the region this
   * splice's frame should nest under, if any — the parent module's own
   * generate region, or an enclosing expand region. Undefined at the top
   * level.
   */
  parentRegionId?: string;
  /**
   * Name of the module whose own node graph directly contains `instanceId` —
   * the real open module for a top-level Expand, or the enclosing splice's
   * `childModule.name` for a nested one (expand-of-an-expanded-instance).
   * This is also the `moduleName` key `requestExpandInstance` /
   * `saveExpandedInstanceLayout` persist under, so nested snapshots stay
   * scoped to their own instance rather than the top-level module.
   */
  parentModuleName: string;
  instanceId: string;
  instanceLabel: string;
  instancePosition: { x: number; y: number };
  instanceSize: { width: number; height: number };
  instanceParamRows: number;
  instancePorts: DiagramPort[];
  childModule: DesignModule;
  savedLayout?: SavedExpandedInstanceLayout;
  /**
   * Host-computed frame-local layout — present whenever the extension host
   * managed to run the child's standalone place-and-route (see
   * ExpandSpliceLayout). Absent against an older host or on a layout
   * failure, in which case the webview-local ELK placement below is used.
   */
  hostLayout?: ExpandSpliceLayout;
}

/**
 * Widths of the expanded frame's reserved border ring, in frame-local px:
 * the header/parameter rows on top, a boundary-label column on each side and
 * the content inset below. Everything inside this ring belongs to the spliced
 * child diagram — the frame's own pointer interactions (select, drag) are
 * confined to the ring so the interior behaves like ordinary canvas (see
 * HdlNode's grab bands and the .hdl-node-expand-ghost pointer-events rules),
 * the ring's inner boundary is drawn for the user (HdlNode's
 * .svsch-expand-content-border), and derived wire routes are clamped to stay
 * inside it (OrthogonalEdge's clampPointsToRect pass). Note the ring is
 * *tighter* than the content padding (padLeft/padRight/padTop): the
 * label-column clearance gap and header gap belong to the sub-canvas, so a
 * boundary stub's vertical jog stays visible and selectable there instead of
 * being swallowed by a grab band.
 */
export interface ExpandContentInsets {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export interface SpliceResult {
  region: PositionedGenerateRegion;
  nodes: PositionedNode[];
  edges: DiagramEdge[];
  /**
   * The frame's reserved border ring — the only part of the dimmed instance
   * node that reacts to the pointer while expanded.
   */
  contentInsets: ExpandContentInsets;
  /**
   * The size the instance's own node must grow to so its body fully contains
   * the spliced-in child diagram plus the label clearances (port-label
   * columns on the left/right, header + parameter rows on top) — the node
   * itself becomes the expanded frame (there is no separate visible outline).
   * Applied to the dimmed instance node as a grow-only `sizeOverride`; the
   * region's bounds are exactly this rect. Grown further (never shrunk) to a
   * previously-saved manual frame resize (`savedLayout.bounds`), and updated
   * live by the webview when the user resizes the frame again (see
   * main.tsx's ghost-resize commit).
   */
  expandedSize: { width: number; height: number };
  /**
   * The content-required frame size — `expandedSize` before any saved/manual
   * enlargement is applied. The floor a manual frame resize can shrink back
   * to (see main.tsx's startNodeResize for ghost nodes).
   */
  minExpandedSize: { width: number; height: number };
  /**
   * child-module-local node id -> namespaced boundary node id, for rewiring
   * the parent's edges that used to terminate on the instance itself.
   */
  boundaryNodeIdByChildPortName: Map<string, string>;
  /**
   * Snapshot suitable for persisting via `saveExpandedInstanceLayout` (keyed
   * by the child module's own local node ids, not namespaced).
   */
  toSavedLayout(
    nodes: PositionedNode[],
    bounds: PositionedGenerateRegion['bounds'],
    fixed: boolean,
    instanceOrigin: { x: number; y: number },
  ): SavedExpandedInstanceLayout;
}

/**
 * Horizontal clearance between a boundary port's label column and the child
 * diagram spliced inside the expanded node. Must comfortably exceed twice
 * OrthogonalEdge's lead length (one lead leaving the boundary's inner handle,
 * one entering the target node), or the default Z-route degenerates into a
 * wrap-around loop for every port-to-node stub.
 */
const LABEL_COLUMN_GAP = diagramSizing.gridSize * 3;
/** Vertical clearance between the node's header text/parameter rows and the diagram. */
const HEADER_GAP = diagramSizing.gridSize;
/** Body inset used for a side with no ports at all, and below the diagram. */
export const EXPAND_CONTENT_INSET = diagramSizing.gridSize * 2;

/**
 * Wire style carried by the net passing through a boundary port, derived from
 * the child module's own annotated edges touching that port node (falling
 * back to the port's declared width when the port is unconnected inside), so
 * the boundary node's drawn lead stub can match the struct/interface/
 * multi-bit style of the wire it continues — the same contract
 * cutLabelEdgeStyle establishes for netLabel nodes.
 */
export function boundaryPortEdgeStyle(
  childModule: DesignModule,
  portNode: DiagramNode,
  port: DiagramPort,
): { aggregate?: 'struct' | 'interface' | string; thick?: boolean } | undefined {
  const nodesById = new Map(childModule.nodes.map((node) => [node.id, node]));
  const touching = childModule.edges.filter(
    (edge) => edge.source === portNode.id || edge.target === portNode.id,
  );
  const aggregate =
    touching.map((edge) => edge.metadata?.aggregate).find(Boolean) ??
    (port.width === 'interface' || port.modportName !== undefined ? 'interface' : undefined);
  const thick =
    aggregate === undefined &&
    (touching.length > 0
      ? touching.some((edge) =>
          edgeIsThick(edge, nodesById.get(edge.source), nodesById.get(edge.target)),
        )
      : portSuggestsThickWire(port));
  if (!aggregate && !thick) return undefined;
  return { aggregate, thick: thick || undefined };
}

async function loadElk(): Promise<any> {
  const elkModule = await import('elkjs/lib/elk.bundled.js');
  const Elk = (elkModule as any).default;
  return new Elk();
}

function snap(value: number): number {
  return Math.round(value / diagramSizing.gridSize) * diagramSizing.gridSize;
}

export function unionBounds(
  rects: Array<{ x: number; y: number; width: number; height: number }>,
): { x: number; y: number; width: number; height: number } | undefined {
  if (rects.length === 0) return undefined;
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export interface BoundaryColumnEntry {
  node: DiagramNode;
  port: DiagramPort;
  index: number;
  side: 'left' | 'right';
  size: { width: number; height: number };
}

/**
 * Builds the (unpositioned) boundary-port nodes for both label columns.
 * Shared with the host-side layout in src/layout/expandLayout.ts — both
 * sides must agree exactly on label widths/paddings, or the host's boundary
 * routes would land on differently-placed nodes than the webview renders.
 *
 * Every node in a column is widened to the column's max width (grow-only
 * sizeOverride, in grid units — already grid-snapped by nodeWidthForKind):
 * all inner handles then share a single x past *every* label in the
 * column, so an inner stub's vertical jog (one edge lead past its handle)
 * can never strike through a neighboring row's longer label. The label
 * itself stays anchored to the border side (see BoundaryPortNode) — only
 * the node's inner wire lead absorbs the extra width.
 */
export function buildBoundaryColumns(
  childModule: DesignModule,
  instancePorts: DiagramPort[],
  instanceId: string,
): { inputColumn: BoundaryColumnEntry[]; outputColumn: BoundaryColumnEntry[] } {
  const childPortNodesByName = new Map<string, DiagramNode>();
  for (const node of childModule.nodes) {
    if (node.kind !== 'port') continue;
    const name = node.ports[0]?.name ?? node.label;
    childPortNodesByName.set(name, node);
  }

  const buildColumn = (ports: DiagramPort[], side: 'left' | 'right'): BoundaryColumnEntry[] =>
    ports.flatMap((port, index) => {
      const childPortNode = childPortNodesByName.get(port.name);
      // defensive: instance/module port lists should always agree by name
      if (!childPortNode) return [];
      const boundaryNode: DiagramNode = {
        id: childPortNode.id,
        kind: 'boundaryPort',
        label: port.label ?? port.name,
        ports: [port],
        source: childPortNode.source,
        metadata: {
          boundaryPort: {
            instanceId,
            childModuleName: childModule.name,
            childPortId: childPortNode.id,
            outerSide: side,
            edgeStyle: boundaryPortEdgeStyle(childModule, childPortNode, port),
          },
        },
      };
      return [{ node: boundaryNode, port, index, side, size: diagramNodeDimensions(boundaryNode) }];
    });

  const alignColumnWidths = (column: BoundaryColumnEntry[]): BoundaryColumnEntry[] => {
    if (column.length === 0) return column;
    const width = Math.max(...column.map((entry) => entry.size.width));
    return column.map((entry) => ({
      ...entry,
      size: { ...entry.size, width },
      node: {
        ...entry.node,
        sizeOverride: {
          width: width / diagramSizing.gridSize,
          height: entry.size.height / diagramSizing.gridSize,
        },
      },
    }));
  };

  const inputs = instancePorts.filter(isInputSidePort);
  const outputs = instancePorts.filter((port) => port.direction === 'output');
  return {
    inputColumn: alignColumnWidths(buildColumn(inputs, 'left')),
    outputColumn: alignColumnWidths(buildColumn(outputs, 'right')),
  };
}

/**
 * Padding between the node border and the spliced diagram on one side:
 * the widest port-label column on that side plus a gap (so a stub's
 * vertical jog happens past the labels), or a plain inset for a side with
 * no ports at all.
 */
export function boundaryColumnPad(column: BoundaryColumnEntry[]): number {
  return column.length > 0
    ? Math.max(...column.map((entry) => entry.size.width)) + LABEL_COLUMN_GAP
    : EXPAND_CONTENT_INSET;
}

/** Vertical padding reserved for the node's own header text and parameter rows. */
export function expandTopPad(instanceParamRows: number): number {
  return (
    snapUpToGrid(diagramSizing.nodeHeaderHeight + instanceParamRows * diagramSizing.gridSize) +
    HEADER_GAP
  );
}

/**
 * Width of the frame's interactive/visible border ring on one side: exactly
 * the boundary label column (without the LABEL_COLUMN_GAP clearance, which
 * belongs to the sub-canvas — a stub's vertical jog there must stay
 * selectable, not sit under a grab band), or a plain inset for a side with
 * no ports at all.
 */
export function boundaryColumnRingWidth(column: BoundaryColumnEntry[]): number {
  return column.length > 0
    ? Math.max(...column.map((entry) => entry.size.width))
    : EXPAND_CONTENT_INSET;
}

/**
 * Height of the ring's top band: the header text plus parameter rows, without
 * the HEADER_GAP clearance below them (same sub-canvas rule as
 * boundaryColumnRingWidth).
 */
export function expandRingTopHeight(instanceParamRows: number): number {
  return snapUpToGrid(diagramSizing.nodeHeaderHeight + instanceParamRows * diagramSizing.gridSize);
}

/**
 * Grow-only merge of a saved manual frame resize (SavedExpandedInstanceLayout
 * .bounds) into the content-computed frame size, so a user-enlarged frame
 * survives a reload. Never shrinks below the content-required size.
 */
export function applySavedFrameSize(
  computed: { width: number; height: number },
  savedBounds?: { x: number; y: number; width: number; height: number },
): { width: number; height: number } {
  if (!savedBounds) return computed;
  return {
    width: Math.max(computed.width, savedBounds.width),
    height: Math.max(computed.height, savedBounds.height),
  };
}

/**
 * The size the instance's own node grows to — the user's mental model is
 * "the dashed outline is the side of the outer node now": the placed
 * diagram's extents plus the label paddings, snapped up to the grid, and
 * never smaller than the instance's pre-expand size (grow-only, matching
 * sizeOverride semantics). `content` is in frame-local coordinates (the
 * frame's top-left corner is (0, 0)).
 */
export function expandedFrameSize(input: {
  instanceSize: { width: number; height: number };
  padLeft: number;
  padRight: number;
  content?: { x: number; y: number; width: number; height: number };
}): { width: number; height: number } {
  const { instanceSize, padLeft, padRight, content } = input;
  return {
    width: Math.max(
      instanceSize.width,
      // Even with no internal nodes at all (a pure port-to-port child, e.g.
      // `assign y = a`), the two boundary label columns still need enough
      // width between them for a pass-through wire's Z-route — otherwise
      // the columns abut and every such wire degenerates into a loop.
      snapUpToGrid(padLeft + padRight),
      content ? snapUpToGrid(content.x + content.width + padRight) : 0,
    ),
    height: Math.max(
      instanceSize.height,
      content ? snapUpToGrid(content.y + content.height + EXPAND_CONTENT_INSET) : 0,
    ),
  };
}

/**
 * Positions each boundary node so its outer handle sits exactly on the
 * expanded node's border at the port's own row: the left border doesn't
 * move, so an input's pre-existing external wire needs no route change at
 * all; an output's border (and its wire endpoint with it) moves right with
 * the expanded width. `frameOrigin` is the expanded node's top-left corner —
 * (0, 0) for the host's frame-local layout, the instance's canvas position
 * for the webview-local fallback.
 */
export function placeBoundaryEntries(
  entries: BoundaryColumnEntry[],
  frameOrigin: { x: number; y: number },
  expandedWidth: number,
  instanceParamRows: number,
): Array<{ entry: BoundaryColumnEntry; position: { x: number; y: number } }> {
  return entries.map((entry) => {
    const { index, side, size } = entry;
    const anchorX = side === 'left' ? frameOrigin.x : frameOrigin.x + expandedWidth;
    const anchorY = frameOrigin.y + nodePortCenterOffset(index + instanceParamRows);
    const position =
      side === 'left'
        ? { x: anchorX, y: anchorY - size.height / 2 }
        : { x: anchorX - size.width, y: anchorY - size.height / 2 };
    return { entry, position };
  });
}

/**
 * Runs the child module's non-port nodes through elkjs (bundled — pure JS,
 * no wasm/worker, safe inside the webview's CSP sandbox) purely for relative
 * node *placement*. This is only the fallback for when the host couldn't
 * supply an ExpandSpliceLayout (older host, or its layout pipeline failed):
 * no edge routing is attempted at all — every edge OrthogonalEdge renders
 * already anchors its first/last drawn point to the real, live React Flow
 * handle position regardless of `routePoints` and falls back to a sensible
 * default orthogonal path when no explicit route is supplied.
 */
async function layoutInternalNodes(
  childModule: DesignModule,
): Promise<Map<string, { x: number; y: number }>> {
  const positions = new Map<string, { x: number; y: number }>();
  if (childModule.nodes.length === 0) return positions;

  try {
    const elk = await loadElk();
    const elkNodes = childModule.nodes.map((node) => {
      const size = resolvedNodeDimensions(node);
      return { id: node.id, width: size.width, height: size.height };
    });
    const nodeIds = new Set(childModule.nodes.map((n) => n.id));
    const elkEdges = childModule.edges
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] }));

    const graph = await elk.layout({
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.spacing.nodeNode': diagramSizing.sameLayerNodeSeparation.toString(),
        'elk.spacing.componentComponent': diagramSizing.sameLayerNodeSeparation.toString(),
        'elk.layered.spacing.nodeNodeBetweenLayers': diagramSizing.minNodeSeparation.toString(),
        'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
        'elk.padding': `[top=${diagramSizing.gridSize}, left=${diagramSizing.gridSize}, bottom=${diagramSizing.gridSize}, right=${diagramSizing.gridSize}]`,
      },
      children: elkNodes,
      edges: elkEdges,
    });

    for (const child of graph.children ?? []) {
      if (child.id && child.x !== undefined && child.y !== undefined) {
        positions.set(child.id, { x: snap(child.x), y: snap(child.y) });
      }
    }
  } catch {
    // Fall through with whatever (possibly empty) positions were collected —
    // the caller assigns a simple grid fallback to anything still missing,
    // the same defensive posture autoLayoutMissingNodes takes server-side.
  }
  return positions;
}

export async function spliceExpandedInstance(input: SpliceInput): Promise<SpliceResult> {
  const {
    namespace,
    childModule,
    instancePorts,
    instancePosition,
    instanceSize,
    instanceParamRows,
  } = input;

  const internalNodes = childModule.nodes.filter((node) => node.kind !== 'port');
  const savedCoversAllNodes =
    input.savedLayout !== undefined &&
    internalNodes.every((node) => input.savedLayout!.nodes[node.id] !== undefined);

  // The host's frame-local layout is authoritative whenever there's no saved
  // snapshot overriding the node positions: it is the child's real standalone
  // place-and-route (ELK + libavoid) dropped into the frame, with the
  // boundary stubs re-routed by libavoid — translate, namespace, done.
  if (input.hostLayout && !savedCoversAllNodes) {
    return spliceFromHostLayout(input, input.hostLayout);
  }

  const { inputColumn, outputColumn } = buildBoundaryColumns(
    childModule,
    instancePorts,
    input.instanceId,
  );
  const padLeft = boundaryColumnPad(inputColumn);
  const padRight = boundaryColumnPad(outputColumn);
  const padTop = expandTopPad(instanceParamRows);

  // The content node set: the host layout's non-boundary nodes when
  // available (the standalone view — includes synthetic nodes like cut-net
  // labels the raw IR doesn't have), the raw IR's non-port nodes otherwise.
  const contentNodes: DiagramNode[] = input.hostLayout
    ? input.hostLayout.nodes.filter((node) => node.kind !== 'boundaryPort')
    : internalNodes;
  const hostLocalPositions = new Map<string, { x: number; y: number }>(
    (input.hostLayout?.nodes ?? [])
      .filter((node) => node.kind !== 'boundaryPort')
      .map((node) => [node.id, (node as PositionedNode).position]),
  );

  let internalPositions: Map<string, { x: number; y: number }>;
  if (savedCoversAllNodes && input.savedLayout) {
    const origin = input.savedLayout.instanceOrigin ?? instancePosition;
    const dx = instancePosition.x - origin.x;
    const dy = instancePosition.y - origin.y;
    internalPositions = new Map(
      contentNodes.map((node) => {
        const saved = input.savedLayout!.nodes[node.id];
        if (saved) {
          return [node.id, { x: saved.x + dx, y: saved.y + dy }];
        }
        // A synthetic standalone-view node (e.g. a cut-net label) the
        // snapshot doesn't cover — carry its host frame-local position over.
        const hostLocal = hostLocalPositions.get(node.id) ?? { x: padLeft, y: padTop };
        return [
          node.id,
          { x: instancePosition.x + hostLocal.x, y: instancePosition.y + hostLocal.y },
        ];
      }),
    );
  } else {
    const elkPositions = await layoutInternalNodes(childModule);
    const elkRects = contentNodes
      .map((node) => {
        const pos = elkPositions.get(node.id);
        if (!pos) return undefined;
        const size = resolvedNodeDimensions(node);
        return { x: pos.x, y: pos.y, width: size.width, height: size.height };
      })
      .filter(
        (rect): rect is { x: number; y: number; width: number; height: number } =>
          rect !== undefined,
      );
    const elkBounds = unionBounds(elkRects) ?? { x: 0, y: 0, width: 0, height: 0 };

    // Place the child diagram inside the (about-to-be-expanded) node body:
    // its top-left corner lands one label-column in from the left border and
    // just below the header/parameter rows.
    const translateX = instancePosition.x + padLeft - elkBounds.x;
    const translateY = instancePosition.y + padTop - elkBounds.y;

    // Fallback for any node ELK didn't return a position for (most commonly
    // every node at once, if the dynamic import of elkjs itself failed —
    // see layoutInternalNodes's catch) — stack diagonally by index rather
    // than collapsing every missing node onto the same point.
    internalPositions = new Map(
      contentNodes.map((node, index) => {
        const pos = elkPositions.get(node.id) ?? {
          x: index * diagramSizing.gridSize * 4,
          y: index * diagramSizing.gridSize * 4,
        };
        return [node.id, { x: snap(pos.x + translateX), y: snap(pos.y + translateY) }];
      }),
    );
  }

  const internalPositionedNodes: PositionedNode[] = contentNodes.map((node) => ({
    ...node,
    id: namespacedId(namespace, node.id),
    position: internalPositions.get(node.id) ?? { x: instancePosition.x, y: instancePosition.y },
  }));

  const contentRects = internalPositionedNodes.map((node) => {
    const size = resolvedNodeDimensions(node);
    return { x: node.position.x, y: node.position.y, width: size.width, height: size.height };
  });
  const content = unionBounds(contentRects);
  const minExpandedSize = expandedFrameSize({
    instanceSize,
    padLeft,
    padRight,
    content: content
      ? { ...content, x: content.x - instancePosition.x, y: content.y - instancePosition.y }
      : undefined,
  });
  // A saved manual frame resize grows the frame past its content-required
  // size — applied before boundary placement so the right label column lands
  // on the (wider) border.
  const expandedSize = applySavedFrameSize(minExpandedSize, input.savedLayout?.bounds);

  const boundaryNodes: PositionedNode[] = [];
  const boundaryNodeIdByChildPortName = new Map<string, string>();
  for (const { entry, position } of placeBoundaryEntries(
    [...inputColumn, ...outputColumn],
    instancePosition,
    expandedSize.width,
    instanceParamRows,
  )) {
    const namespacedNodeId = namespacedId(namespace, entry.node.id);
    boundaryNodes.push({ ...entry.node, id: namespacedNodeId, position });
    boundaryNodeIdByChildPortName.set(entry.port.name, namespacedNodeId);
  }

  const allNodes = [...boundaryNodes, ...internalPositionedNodes];

  // Edge set: the host layout's edges are already rewritten onto boundary
  // 'inner' handles (and carry standalone niceties like net labels and
  // cut-net stubs) — only their routes are stale against saved/ELK node
  // positions, so those are dropped and re-derived client-side. The raw IR
  // fallback rewrites the port endpoints itself.
  let edges: DiagramEdge[];
  if (input.hostLayout) {
    edges = input.hostLayout.edges.map((edge) => ({
      ...edge,
      id: namespacedId(namespace, edge.id),
      source: namespacedId(namespace, edge.source),
      target: namespacedId(namespace, edge.target),
      waypoint: undefined,
      routePoints: undefined,
    }));
  } else {
    const rewritePortEndpoint = (
      nodeId: string,
      portId: string | undefined,
    ): { nodeId: string; portId: string | undefined } => {
      const portNode = childModule.nodes.find((n) => n.id === nodeId && n.kind === 'port');
      if (!portNode) {
        return { nodeId: namespacedId(namespace, nodeId), portId };
      }
      const namespacedBoundaryId = namespacedId(namespace, portNode.id);
      return { nodeId: namespacedBoundaryId, portId: 'inner' };
    };

    edges = childModule.edges.map((edge) => {
      const src = rewritePortEndpoint(edge.source, edge.sourcePort);
      const tgt = rewritePortEndpoint(edge.target, edge.targetPort);
      return {
        ...edge,
        id: namespacedId(namespace, edge.id),
        source: src.nodeId,
        target: tgt.nodeId,
        sourcePort: src.portId,
        targetPort: tgt.portId,
        waypoint: undefined,
        routePoints: undefined,
      };
    });
  }

  return assembleSpliceResult(
    input,
    allNodes,
    edges,
    expandedSize,
    minExpandedSize,
    boundaryNodeIdByChildPortName,
  );
}

/**
 * The direct path for a fresh (no saved snapshot) expand with a host layout:
 * the frame-local standalone place-and-route is translated to the instance's
 * canvas position and namespaced, keeping every route — the standalone
 * libavoid routes between internal nodes, and the boundary-stub routes
 * libavoid computed against the placed content.
 */
function spliceFromHostLayout(input: SpliceInput, hostLayout: ExpandSpliceLayout): SpliceResult {
  const { namespace, instancePosition } = input;
  const ox = instancePosition.x;
  const oy = instancePosition.y;

  // A saved manual frame resize (bounds without a full node snapshot — e.g.
  // the design changed underneath the snapshot) still grows the frame; the
  // host laid the right label column on its own computed border, so that
  // column shifts right with the widened frame and its stub routes re-derive.
  const expandedSize = applySavedFrameSize(hostLayout.expandedSize, input.savedLayout?.bounds);
  const widthGrowth = expandedSize.width - hostLayout.expandedSize.width;

  const shiftedBoundaryIds = new Set<string>();
  const boundaryNodeIdByChildPortName = new Map<string, string>();
  const nodes: PositionedNode[] = hostLayout.nodes.map((node) => {
    const id = namespacedId(namespace, node.id);
    let dx = 0;
    if (node.kind === 'boundaryPort') {
      const name = node.ports[0]?.name ?? node.label;
      boundaryNodeIdByChildPortName.set(name, id);
      if (widthGrowth > 0 && node.metadata?.boundaryPort?.outerSide === 'right') {
        dx = widthGrowth;
        shiftedBoundaryIds.add(id);
      }
    }
    return { ...node, id, position: { x: node.position.x + ox + dx, y: node.position.y + oy } };
  });

  const edges: DiagramEdge[] = hostLayout.edges.map((edge) => {
    const id = namespacedId(namespace, edge.id);
    const source = namespacedId(namespace, edge.source);
    const target = namespacedId(namespace, edge.target);
    const touchesShiftedBoundary = shiftedBoundaryIds.has(source) || shiftedBoundaryIds.has(target);
    return {
      ...edge,
      id,
      source,
      target,
      waypoint: undefined,
      routePoints: touchesShiftedBoundary
        ? undefined
        : edge.routePoints?.map((point) => ({ x: point.x + ox, y: point.y + oy })),
    };
  });

  return assembleSpliceResult(
    input,
    nodes,
    edges,
    expandedSize,
    hostLayout.expandedSize,
    boundaryNodeIdByChildPortName,
  );
}

function assembleSpliceResult(
  input: SpliceInput,
  allNodes: PositionedNode[],
  edges: DiagramEdge[],
  expandedSize: { width: number; height: number },
  minExpandedSize: { width: number; height: number },
  boundaryNodeIdByChildPortName: Map<string, string>,
): SpliceResult {
  const { namespace, childModule, instancePosition } = input;
  const internalNodes = childModule.nodes.filter((node) => node.kind !== 'port');

  // Recomputed here (rather than threaded through from the two callers) so
  // both splice paths agree by construction — the host layout derives its
  // frame padding from these exact same functions and inputs (see
  // buildExpandSpliceLayout in layout/expandLayout.ts).
  const { inputColumn, outputColumn } = buildBoundaryColumns(
    childModule,
    input.instancePorts,
    input.instanceId,
  );
  const contentInsets: ExpandContentInsets = {
    top: expandRingTopHeight(input.instanceParamRows),
    left: boundaryColumnRingWidth(inputColumn),
    right: boundaryColumnRingWidth(outputColumn),
    bottom: EXPAND_CONTENT_INSET,
  };

  // The region is pure machinery now (drag-sync membership, nesting,
  // persistence) — it's never rendered as its own frame. Its bounds are
  // exactly the expanded node's rect.
  const bounds = {
    x: instancePosition.x,
    y: instancePosition.y,
    width: expandedSize.width,
    height: expandedSize.height,
  };

  const region: PositionedGenerateRegion = {
    id: expandRegionId(namespace),
    kind: 'expand',
    label: `${input.instanceLabel} : ${childModule.name}`,
    parentRegionId: input.parentRegionId,
    nodeIds: allNodes.map((n) => n.id),
    bounds,
    fixed: input.savedLayout?.fixed,
    expandedInstance: {
      instanceId: input.instanceId,
      childModuleName: childModule.name,
      parentModuleName: input.parentModuleName,
    },
  };

  return {
    region,
    nodes: allNodes,
    edges,
    expandedSize,
    minExpandedSize,
    contentInsets,
    boundaryNodeIdByChildPortName,
    toSavedLayout(nodes, saveBounds, fixed, instanceOrigin) {
      const nodesById: Record<string, SavedNodeLayout> = {};
      for (const node of nodes) {
        const localId = node.id.startsWith(namespacedId(namespace, ''))
          ? node.id.slice(namespacedId(namespace, '').length)
          : undefined;
        if (localId === undefined) continue;
        // Only the child module's own internal (non-port) nodes are saved —
        // boundary nodes are re-derived from the instance's current ports
        // every time, never persisted themselves.
        if (!internalNodes.some((n) => n.id === localId)) continue;
        nodesById[localId] = { x: node.position.x, y: node.position.y, fixed: true };
      }
      return {
        childModuleName: childModule.name,
        nodes: nodesById,
        bounds: saveBounds,
        fixed,
        instanceOrigin,
      };
    },
  };
}
