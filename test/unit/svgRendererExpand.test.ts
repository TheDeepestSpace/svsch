import { AvoidLib } from 'libavoid-js';
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  DesignGraph,
  DesignModule,
  DiagramPort,
  InstanceDiagramNode,
} from '../../src/ir/types';
import { applyExpandedInstances } from '../../src/layout/expandSpliceView';
import { setLibavoidRuntimeForTests } from '../../src/layout/libavoidRouter';
import { buildViewModel } from '../../src/layout/mergeLayout';
import { renderSvg } from '../../src/cli/svgRenderer';
import type { SavedLayout } from '../../src/storage/layoutStore';

beforeAll(async () => {
  await AvoidLib.load();
  setLibavoidRuntimeForTests(AvoidLib.getInstance());
});

const innerAPort: DiagramPort = { id: 'p:a', name: 'a', direction: 'input' };
const innerYPort: DiagramPort = { id: 'p:y', name: 'y', direction: 'output' };

const innerModule: DesignModule = {
  name: 'inner',
  file: 'inner.sv',
  ports: [innerAPort, innerYPort],
  nodes: [
    { id: 'port:a', kind: 'port', label: 'a', ports: [innerAPort] },
    { id: 'port:y', kind: 'port', label: 'y', ports: [innerYPort] },
    {
      id: 'comb1',
      kind: 'comb',
      label: 'comb1',
      ports: [
        { id: 'in', name: 'in', direction: 'input' },
        { id: 'out', name: 'out', direction: 'output' },
      ],
    },
  ],
  edges: [
    { id: 'e-a-comb1', source: 'port:a', target: 'comb1', sourcePort: 'p:a', targetPort: 'in' },
    { id: 'e-comb1-y', source: 'comb1', target: 'port:y', sourcePort: 'out', targetPort: 'p:y' },
  ],
};

const u1Node: InstanceDiagramNode = {
  id: 'u1',
  kind: 'instance',
  label: 'u1',
  moduleName: 'inner',
  ports: [
    { id: 'u1:a', name: 'a', direction: 'input' },
    { id: 'u1:y', name: 'y', direction: 'output' },
  ],
};

const topAPort: DiagramPort = { id: 'p:top-a', name: 'a', direction: 'input' };
const topYPort: DiagramPort = { id: 'p:top-y', name: 'y', direction: 'output' };

const topModule: DesignModule = {
  name: 'top',
  file: 'top.sv',
  ports: [topAPort, topYPort],
  nodes: [
    { id: 'port:top:a', kind: 'port', label: 'a', ports: [topAPort] },
    { id: 'port:top:y', kind: 'port', label: 'y', ports: [topYPort] },
    u1Node,
  ],
  edges: [
    {
      id: 'e-top-a-u1',
      source: 'port:top:a',
      target: 'u1',
      sourcePort: 'p:top-a',
      targetPort: 'u1:a',
    },
    {
      id: 'e-u1-top-y',
      source: 'u1',
      target: 'port:top:y',
      sourcePort: 'u1:y',
      targetPort: 'p:top-y',
    },
  ],
};

const graph: DesignGraph = {
  rootModules: ['top'],
  modules: { top: topModule, inner: innerModule },
  diagnostics: [],
  generatedAt: 'test',
};

// Regression coverage for issue #248: `svsch render` (renderSvg) used to only
// ever see the flat/collapsed view, since the expand splice was applied
// entirely client-side in React Flow state and never round-tripped back into
// a DiagramViewModel. applyExpandedInstances (src/layout/expandSpliceView.ts)
// is the server-side counterpart that fixes that — this locks in that the SVG
// renderer actually draws what it produces.
describe('renderSvg with an expanded instance', () => {
  it('renders boundary-port labels + internal content, not just the flat box', async () => {
    const layout: SavedLayout = {
      version: 1,
      modules: { top: { nodes: {}, expanded: { u1: true } } },
    };
    const baseView = await buildViewModel(graph, 'top', layout);
    const view = await applyExpandedInstances({
      graph,
      layout,
      view: baseView,
    });

    const svg = renderSvg(view, { theme: 'dark' });

    expect(svg).toContain('data-node-id="expand:u1::port:a"');
    expect(svg).toContain('data-node-kind="boundaryPort"');
    expect(svg).toContain('svsch-boundary-port-text');
    expect(svg).toContain('data-node-id="expand:u1::comb1"');

    // The collapsed instance itself is dimmed into a ghost backdrop.
    expect(svg).toContain('hdl-node-expand-ghost');
    expect(svg).toContain('svsch-expand-content-border');

    // The ghost keeps the same tinted outer ring as the webview while the
    // even-odd hole leaves the child-diagram cut-out fully transparent.
    const doc = new DOMParser().parseFromString(svg, 'application/xml');
    const ring = doc.querySelector('.svsch-expand-ring-backdrop');
    expect(ring).not.toBeNull();
    expect(ring?.getAttribute('fill')).toBe('var(--vscode-editorWidget-background)');
    expect(ring?.getAttribute('fill-rule')).toBe('evenodd');
    expect(ring?.getAttribute('opacity')).toBe('0.35');
    expect(ring?.getAttribute('d')?.match(/M/g)).toHaveLength(2);

    // The expand region is pure bookkeeping — it must not draw the orange
    // generate-arm box a real SV generate region would (the CSS rule for it
    // is always embedded in the stylesheet, so check for the element).
    expect(svg).not.toContain('<rect class="svsch-generate-region-box"');
    expect(svg).not.toContain('data-region-id="expand:region::u1"');
  });

  it('is still valid, well-formed XML with the expand splice embedded', async () => {
    const layout: SavedLayout = {
      version: 1,
      modules: { top: { nodes: {}, expanded: { u1: true } } },
    };
    const baseView = await buildViewModel(graph, 'top', layout);
    const view = await applyExpandedInstances({
      graph,
      layout,
      view: baseView,
    });
    const svg = renderSvg(view, { theme: 'dark' });

    const doc = new DOMParser().parseFromString(svg, 'application/xml');
    const parserError = doc.querySelector('parsererror');
    expect(parserError?.textContent ?? null).toBeNull();
    expect(doc.documentElement.tagName).toBe('svg');
  });
});
