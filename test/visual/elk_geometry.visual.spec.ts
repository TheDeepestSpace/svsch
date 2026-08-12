import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { buildFixtureView, openView, paddedAllNodesClip, recordPendingRenderDuration, waitForViewportTransformToSettle, type VisualLayoutMode } from './helper';
import { elkNodeForDiagramNode, elkRoutingNodeForDiagramNode } from '../../src/layout/mergeLayout';
import { visualHandleGeometry } from '../../src/diagram/visualHandleGeometry';
import { diagramNodeDimensions } from '../../src/diagram/nodeSizing';
import { nodeIsArrayNode, structRole } from '../../src/ir/nodeMetadata';
import { renderSvg } from '../../src/cli/svgRenderer';
import { compareSvgSnapshot } from '../graphRegression';
import type { DiagramNode, DiagramViewModel, PositionedNode } from '../../src/ir/types';

// Renders one node of every diagram kind in a grid and overlays the geometry
// routing sees: pink dashed rect = the placement box with lead margins,
// purple dashed rect = the candidate route obstacle with safety margins,
// filled dot = the route anchor, hollow dot = the rendered handle,
// and the orange segment joins the two.

const GRID = 24;
const COLUMNS = 5;
const COLUMN_GAP = GRID * 3;
const ROW_GAP = GRID * 4;

interface NodePick {
  label: string;
  match: (node: DiagramNode) => boolean;
}

interface FixtureSelection {
  fixture: string;
  module?: string;
  layoutMode?: VisualLayoutMode;
  picks: NodePick[];
}

const selections: FixtureSelection[] = [
  {
    fixture: 'register_async_reset.sv',
    picks: [
      { label: 'port: input', match: (n) => n.kind === 'port' && n.ports[0]?.direction === 'input' },
      { label: 'port: output', match: (n) => n.kind === 'port' && n.ports[0]?.direction === 'output' },
      { label: 'register: async reset', match: (n) => n.kind === 'register' }
    ]
  },
  {
    fixture: 'register_file.sv',
    picks: [
      { label: 'port: wide input', match: (n) => n.kind === 'port' && n.label === 'addr' },
      { label: 'register: stacked (wide)', match: (n) => n.kind === 'register' && nodeIsArrayNode(n) }
    ]
  },
  {
    fixture: 'array_port_register.sv',
    picks: [
      { label: 'port: stacked input (wide)', match: (n) => n.kind === 'port' && nodeIsArrayNode(n) && n.ports[0]?.direction === 'input' },
      { label: 'port: stacked output (wide)', match: (n) => n.kind === 'port' && nodeIsArrayNode(n) && n.ports[0]?.direction === 'output' }
    ]
  },
  {
    fixture: 'array_port_register_bit.sv',
    picks: [
      { label: 'port: stacked input (1-bit)', match: (n) => n.kind === 'port' && nodeIsArrayNode(n) && n.ports[0]?.direction === 'input' },
      { label: 'port: stacked output (1-bit)', match: (n) => n.kind === 'port' && nodeIsArrayNode(n) && n.ports[0]?.direction === 'output' },
      { label: 'register: stacked (1-bit)', match: (n) => n.kind === 'register' && nodeIsArrayNode(n) }
    ]
  },
  { fixture: 'mux_three_inputs.sv', picks: [{ label: 'mux', match: (n) => n.kind === 'mux' }] },
  {
    fixture: 'array_register.sv',
    picks: [
      { label: 'mux: stacked write address', match: (n) => n.kind === 'mux' && nodeIsArrayNode(n) && n.label === 'write address' },
      { label: 'mux: stacked write enable', match: (n) => n.kind === 'mux' && nodeIsArrayNode(n) && n.label === 'if write_en' }
    ]
  },
  { fixture: 'alu_connected.sv', picks: [{ label: 'alu', match: (n) => n.kind === 'alu' }] },
  { fixture: 'inverter_expr.sv', picks: [{ label: 'inverter', match: (n) => n.kind === 'inverter' }] },
  { fixture: 'comb_assigns.sv', picks: [{ label: 'comb', match: (n) => n.kind === 'comb' }] },
  { fixture: 'var_bit_select.sv', picks: [{ label: 'select', match: (n) => n.kind === 'select' }] },
  { fixture: 'bus_two_taps.sv', picks: [{ label: 'bus: breakout', match: (n) => n.kind === 'bus' }] },
  { fixture: 'bus_composition.sv', picks: [{ label: 'bus: composition', match: (n) => n.kind === 'bus' }] },
  { fixture: 'array_stack_breakout.sv', picks: [{ label: 'bus: stacked breakout', match: (n) => n.kind === 'bus' && nodeIsArrayNode(n) }] },
  { fixture: 'array_stack_composition_elements.sv', picks: [{ label: 'bus: stacked composition', match: (n) => n.kind === 'bus' && nodeIsArrayNode(n) }] },
  { fixture: 'array_stack_composition_literal.sv', picks: [{ label: 'literal', match: (n) => n.kind === 'literal' }] },
  { fixture: 'struct_breakout.sv', picks: [{ label: 'struct: breakout', match: (n) => n.kind === 'struct' }] },
  { fixture: 'struct_composition.sv', picks: [{ label: 'struct: composition', match: (n) => n.kind === 'struct' }] },
  { fixture: 'interface_modport.sv', picks: [{ label: 'interface: instance', match: (n) => n.kind === 'interface' }] },
  {
    fixture: 'interface_modport.sv',
    module: 'consumer',
    picks: [{ label: 'interface: modport', match: (n) => n.kind === 'interface' && structRole(n) === 'modport' }]
  },
  {
    fixture: 'interface_modport_arrangements.sv',
    module: 'interface_all_left_modports',
    picks: [{ label: 'interface: modports one side', match: (n) => n.kind === 'interface' && structRole(n) !== 'modport' }]
  },
  {
    fixture: 'interface_modport_arrangements.sv',
    module: 'interface_uneven_modport',
    picks: [{ label: 'interface: uneven modports', match: (n) => n.kind === 'interface' && structRole(n) !== 'modport' }]
  },
  {
    fixture: 'interface_multi_modport.sv',
    picks: [{ label: 'interface: multi modport + clk/rst', match: (n) => n.kind === 'interface' && structRole(n) !== 'modport' }]
  },
  {
    fixture: 'interface_caps_only.sv',
    picks: [{ label: 'interface: scalar caps only', match: (n) => n.kind === 'interface' && structRole(n) !== 'modport' }]
  },
  { fixture: 'typed_instance_ports.sv', picks: [{ label: 'instance', match: (n) => n.kind === 'instance' }] },
  { fixture: 'replication_expr.sv', picks: [{ label: 'replicate', match: (n) => n.kind === 'replicate' }] },
  { fixture: 'loop_logic.sv', picks: [{ label: 'loop', match: (n) => n.kind === 'loop' }] },
  { fixture: 'latch_simple.sv', picks: [{ label: 'latch', match: (n) => n.kind === 'latch' }] },
  {
    fixture: 'cut_net_simple.sv',
    layoutMode: 'cutNet',
    picks: [
      { label: 'netLabel: cut source end', match: (n) => n.kind === 'netLabel' && n.metadata?.cutNet?.role === 'source' },
      { label: 'netLabel: cut sink end', match: (n) => n.kind === 'netLabel' && n.metadata?.cutNet?.role === 'sink' },
      // Same fixture, but picking the *real* port each label hangs off of —
      // the green dashed box is that port's ELK bounding box inflated by
      // netCutPortMargins (see mergeLayout.ts): the label is never its own
      // ELK graph node, but its footprint still has to keep the layered
      // algorithm from packing a neighbor on top of it.
      { label: 'port: source (+ cut margin)', match: (n) => n.kind === 'port' && n.ports[0]?.direction === 'input' },
      { label: 'port: sink (+ cut margin)', match: (n) => n.kind === 'port' && n.ports[0]?.direction === 'output' }
    ]
  }
];

interface OverlayPort {
  anchor: { x: number; y: number };
  surface: { x: number; y: number };
}

interface OverlayEntry {
  label: string;
  placementRect: { x: number; y: number; width: number; height: number };
  routingRect: { x: number; y: number; width: number; height: number };
  /** The same node's ELK box with its active net-cut margin(s) folded in —
   * only present for a port picked from a `cutNet` fixture selection. */
  marginRect?: { x: number; y: number; width: number; height: number };
  ports: OverlayPort[];
}

// Auto-detects, for a picked node, whichever of its own ports has a dangling
// cut-net end attached in this same view (found by walking the synthetic
// cut-stub edges), and the size that end's label would reserve. Mirrors
// netCutPortMargins in mergeLayout.ts, but read back from a built view
// instead of a SavedLayout, since these are hand-picked visual fixtures.
function netCutMarginsForNode(view: DiagramViewModel, node: DiagramNode): Map<string, { width: number; height: number }> | undefined {
  const margins = new Map<string, { width: number; height: number }>();
  for (const edge of view.edges) {
    if (!edge.metadata?.cutStub) continue;
    if (edge.source !== node.id && edge.target !== node.id) continue;
    const labelId = edge.source === node.id ? edge.target : edge.source;
    const portId = edge.source === node.id ? edge.sourcePort : edge.targetPort;
    const label = view.nodes.find((candidate) => candidate.id === labelId);
    if (!label || label.kind !== 'netLabel' || !portId) continue;
    margins.set(portId, diagramNodeDimensions(label));
  }
  return margins.size > 0 ? margins : undefined;
}

function snapFullGrid(value: number): number {
  return Math.round(value / GRID) * GRID;
}

function snapForKind(value: number, node: DiagramNode): number {
  const halfGrid = node.kind === 'port' || node.kind === 'literal' || (node.kind === 'interface' && structRole(node) === 'port');
  if (halfGrid) {
    return Math.round((value - GRID / 2) / GRID) * GRID + GRID / 2;
  }
  return snapFullGrid(value);
}

interface CollectedNode {
  label: string;
  node: DiagramNode;
  extraPortMargins?: Map<string, { width: number; height: number }>;
}

async function collectNodes(): Promise<CollectedNode[]> {
  const collected: CollectedNode[] = [];
  for (const selection of selections) {
    const view = await buildFixtureView(selection.fixture, selection.layoutMode ?? 'auto', selection.module);
    for (const pick of selection.picks) {
      const node = view.nodes.find((candidate) => pick.match(candidate));
      if (!node) {
        throw new Error(`No node matching "${pick.label}" in ${selection.fixture}${selection.module ? ` (module ${selection.module})` : ''}`);
      }
      collected.push({ label: pick.label, node, extraPortMargins: netCutMarginsForNode(view, node) });
    }
  }
  const ids = new Set<string>();
  for (const { node } of collected) {
    if (ids.has(node.id)) {
      throw new Error(`Duplicate node id across fixtures: ${node.id}`);
    }
    ids.add(node.id);
  }
  return collected;
}

function buildGridView(collected: CollectedNode[]): { view: DiagramViewModel; overlay: OverlayEntry[] } {
  const positioned: PositionedNode[] = [];
  const overlay: OverlayEntry[] = [];

  let rowStart = 0;
  let y = 0;
  while (rowStart < collected.length) {
    const row = collected.slice(rowStart, rowStart + COLUMNS);
    let x = 0;
    let rowHeight = 0;
    for (const { label, node, extraPortMargins } of row) {
      const withLeads = elkNodeForDiagramNode(node, true);
      const withRoutingMargins = elkRoutingNodeForDiagramNode(node, extraPortMargins);
      const bare = elkNodeForDiagramNode(node, false);
      // The margin-inflated box is for the overlay comparison only — the
      // node's own rendered position still comes from the plain lead offset,
      // exactly like it does in the real diagram (see makeCutLabelNode).
      const withMargins = extraPortMargins ? elkNodeForDiagramNode(node, true, extraPortMargins) : undefined;
      const offset = withLeads.layoutOffset;
      // A cut-net margin on the west/north side grows the offset beyond the
      // plain lead's — shift the node rightward/downward within its cell by
      // exactly that much so the inflated box's leading edge lands on the
      // cell's nominal start instead of bleeding into the previous cell/row.
      const extraLeft = Math.max(0, (withMargins?.layoutOffset.x ?? 0) - offset.x);
      const extraTop = Math.max(0, (withMargins?.layoutOffset.y ?? 0) - offset.y);

      const position = {
        x: snapFullGrid(x + offset.x + extraLeft),
        y: snapForKind(y + offset.y + extraTop, node)
      };
      positioned.push({ ...node, position, fixed: true });

      const placementRect = {
        x: position.x - offset.x,
        y: position.y - offset.y,
        width: withLeads.width,
        height: withLeads.height
      };
      const routingRect = {
        x: position.x - withRoutingMargins.layoutOffset.x,
        y: position.y - withRoutingMargins.layoutOffset.y,
        width: withRoutingMargins.width,
        height: withRoutingMargins.height
      };
      const marginRect = withMargins ? {
        x: position.x - withMargins.layoutOffset.x,
        y: position.y - withMargins.layoutOffset.y,
        width: withMargins.width,
        height: withMargins.height
      } : undefined;
      const barePortsById = new Map(bare.ports.map((port) => [port.id, port]));
      const ports = withLeads.ports.map((port) => {
        const barePort = barePortsById.get(port.id);
        if (!barePort) {
          throw new Error(`Port ${port.id} missing from bare elk node`);
        }
        // Prefer the rendered handle position (differs from the raw ELK port
        // where the visual attach point sits inside the box, e.g. interface
        // hats and array diagonal exits). Elk port ids are `${nodeId}:${portId}`.
        const rawPortId = port.id.slice(node.id.length + 1);
        const visual = visualHandleGeometry(node, rawPortId);
        // The bare call still applies its own margins (arrayLayerPad on
        // stacked nodes), so strip its layoutOffset to get the raw on-node
        // port position before re-basing onto the rendered node origin.
        return {
          anchor: { x: placementRect.x + port.x, y: placementRect.y + port.y },
          surface: visual
            ? { x: placementRect.x + offset.x + visual.offset.x, y: placementRect.y + offset.y + visual.offset.y }
            : {
              x: placementRect.x + offset.x + barePort.x - bare.layoutOffset.x,
              y: placementRect.y + offset.y + barePort.y - bare.layoutOffset.y
            }
        };
      });
      overlay.push({ label, placementRect, routingRect, marginRect, ports });

      const cellWidth = Math.max(extraLeft + withLeads.width, marginRect?.width ?? 0, withRoutingMargins.width);
      const cellHeight = Math.max(extraTop + withLeads.height, marginRect?.height ?? 0, withRoutingMargins.height);
      x += Math.ceil(cellWidth / GRID) * GRID + COLUMN_GAP;
      rowHeight = Math.max(rowHeight, cellHeight);
    }
    y += Math.ceil(rowHeight / GRID) * GRID + ROW_GAP;
    rowStart += COLUMNS;
  }

  const view: DiagramViewModel = {
    moduleName: 'elk_geometry_grid',
    nodes: positioned,
    edges: [],
    diagnostics: []
  };
  return { view, overlay };
}

const PLACEMENT_BOUNDS_COLOR = '#ff5f9e';
const ROUTING_BOUNDS_COLOR = '#a855f7';
const LEAD_COLOR = '#fb7a1f';
const MARGIN_COLOR = '#3ddc97';

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Overlay shapes in flow coordinates, shared between the live page injection
// and the exported SVG baseline.
function overlayMarkup(overlay: OverlayEntry[]): string {
  const parts: string[] = ['<g class="elk-geometry-overlay">'];
  for (const entry of overlay) {
    if (entry.marginRect) {
      parts.push(
        `<rect x="${entry.marginRect.x}" y="${entry.marginRect.y}" width="${entry.marginRect.width}" height="${entry.marginRect.height}" fill="none" stroke="${MARGIN_COLOR}" stroke-width="1.5" stroke-dasharray="2 3" />`,
        `<text x="${entry.marginRect.x}" y="${entry.marginRect.y + entry.marginRect.height + 16}" fill="${MARGIN_COLOR}" font-size="11" font-family="monospace">+ cut-net margin</text>`
      );
    }
    parts.push(
      `<rect x="${entry.placementRect.x}" y="${entry.placementRect.y}" width="${entry.placementRect.width}" height="${entry.placementRect.height}" fill="none" stroke="${PLACEMENT_BOUNDS_COLOR}" stroke-width="1.5" stroke-dasharray="6 4" />`,
      `<rect x="${entry.routingRect.x}" y="${entry.routingRect.y}" width="${entry.routingRect.width}" height="${entry.routingRect.height}" fill="none" stroke="${ROUTING_BOUNDS_COLOR}" stroke-width="1.75" stroke-dasharray="7 5" />`,
      `<text x="${entry.routingRect.x}" y="${entry.routingRect.y - 8}" fill="${ROUTING_BOUNDS_COLOR}" font-size="13" font-family="monospace">${escapeXml(entry.label)}</text>`
    );
    for (const port of entry.ports) {
      parts.push(
        `<line x1="${port.surface.x}" y1="${port.surface.y}" x2="${port.anchor.x}" y2="${port.anchor.y}" stroke="${LEAD_COLOR}" stroke-width="1.75" />`,
        `<circle cx="${port.surface.x}" cy="${port.surface.y}" r="5" fill="none" stroke="${LEAD_COLOR}" stroke-width="2" />`,
        `<circle cx="${port.anchor.x}" cy="${port.anchor.y}" r="7" fill="${LEAD_COLOR}" fill-opacity="0.9" />`
      );
    }
  }
  parts.push('</g>');
  return parts.join('\n');
}

async function injectOverlay(page: Page, overlay: OverlayEntry[]): Promise<void> {
  await page.evaluate((markup) => {
    const viewport = document.querySelector('.react-flow__viewport');
    if (!viewport) {
      throw new Error('react-flow viewport not found');
    }
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '1');
    svg.setAttribute('height', '1');
    svg.style.position = 'absolute';
    svg.style.left = '0';
    svg.style.top = '0';
    svg.style.overflow = 'visible';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '1000';
    svg.innerHTML = markup;
    viewport.appendChild(svg);
  }, overlayMarkup(overlay));
}

// renderSvg emits `<g transform="translate(..)">…</g>\n</svg>` at the end of
// the document; splice the overlay inside that translated group so it shares
// the node coordinate space.
function renderSvgWithOverlay(view: DiagramViewModel, overlay: OverlayEntry[]): string {
  const reactFlowCss = fs.readFileSync(require.resolve('@xyflow/react/dist/style.css'), 'utf8');
  const extensionCss = fs.readFileSync(path.resolve(__dirname, '../../src/webview/diagram.css'), 'utf8');
  const svg = renderSvg(view, { theme: 'dark', reactFlowCss, extensionCss, padding: GRID * 3 });
  const tail = '</g>\n</svg>';
  const tailIndex = svg.lastIndexOf(tail);
  if (tailIndex === -1) {
    throw new Error('Unexpected renderSvg output: closing tags not found');
  }
  return `${svg.slice(0, tailIndex)}${overlayMarkup(overlay)}\n${svg.slice(tailIndex)}`;
}

test.describe('elk geometry grid', () => {
  // The grid is taller than the default 1400x1000 viewport permits at React
  // Flow's minimum zoom, which would clip the bottom rows out of the PNG.
  test.use({ viewport: { width: 1700, height: 2200 } });

  test('shows elk bounds and port anchors for every node kind', async ({ page }) => {
    const collected = await collectNodes();
    const { view, overlay } = buildGridView(collected);

    await openView(page, view);
    await page.waitForFunction(
      (expected) => document.querySelectorAll('.react-flow__node').length >= expected,
      view.nodes.length
    );

    // Fit the viewport ourselves from the known overlay bounds instead of
    // fitView: the webview's own auto-fit races with it and can settle on a
    // clamped zoom that pushes the first grid row off screen.
    const margin = GRID * 2;
    const minX = Math.min(...overlay.map((e) => Math.min(e.placementRect.x, e.routingRect.x, e.marginRect?.x ?? Infinity))) - margin;
    const minY = Math.min(...overlay.map((e) => Math.min(e.placementRect.y, e.routingRect.y, e.marginRect?.y ?? Infinity))) - margin;
    const maxX = Math.max(...overlay.map((e) => Math.max(
      e.placementRect.x + e.placementRect.width,
      e.routingRect.x + e.routingRect.width,
      e.marginRect ? e.marginRect.x + e.marginRect.width : -Infinity
    ))) + margin;
    const maxY = Math.max(...overlay.map((e) => Math.max(
      e.placementRect.y + e.placementRect.height,
      e.routingRect.y + e.routingRect.height,
      e.marginRect ? e.marginRect.y + e.marginRect.height : -Infinity
    ))) + margin;
    await page.waitForFunction(() => Boolean((window as any).reactFlowInstance));
    await page.evaluate(async (bounds) => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const zoom = Math.min(viewport.width / (bounds.maxX - bounds.minX), viewport.height / (bounds.maxY - bounds.minY), 1);
      await (window as any).reactFlowInstance.setViewport({
        x: (viewport.width - (bounds.maxX - bounds.minX) * zoom) / 2 - bounds.minX * zoom,
        y: (viewport.height - (bounds.maxY - bounds.minY) * zoom) / 2 - bounds.minY * zoom,
        zoom
      });
    }, { minX, minY, maxX, maxY });
    await injectOverlay(page, overlay);
    await waitForViewportTransformToSettle(page);
    await page.waitForTimeout(100);
    recordPendingRenderDuration(page);

    await expect(page).toHaveScreenshot('elk-geometry-grid.png', {
      clip: await paddedAllNodesClip(page)
    });

    // Platform-independent SVG twin of the screenshot, with the same overlay
    // baked in (mirrors the update-mode handling in helper.ts).
    const snapshotsDir = path.dirname(test.info().snapshotPath('elk-geometry-grid.svg'));
    const resultsDir = path.resolve(__dirname, '../../test-results/visual/graph-diffs');
    const updateMode = test.info().config.updateSnapshots;
    const updateSnapshots = !!process.env.UPDATE_SNAPSHOTS
      || updateMode === 'all'
      || updateMode === 'changed';
    compareSvgSnapshot(renderSvgWithOverlay(view, overlay), 'elk-geometry-grid', snapshotsDir, resultsDir, updateSnapshots);
  });
});
