import { describe, expect, test } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CombNodeSvg } from '../../src/webview/nodes/comb/CombNodeSvg';
import { AluNodeSvg } from '../../src/webview/nodes/alu/AluNodeSvg';
import { InverterNodeSvg } from '../../src/webview/nodes/inverter/InverterNodeSvg';
import { MuxNodeSvg } from '../../src/webview/nodes/mux/MuxNodeSvg';
import type { DiagramNode, DiagramNodeKind, DiagramPort } from '../../src/ir/types';
import type { NodeSvgProps } from '../../src/webview/nodes/shared/NodeSvgProps';

type NodeSvgComponent = (props: NodeSvgProps) => React.ReactNode;

function arrayNode(kind: DiagramNodeKind, ports: DiagramPort[]): DiagramNode {
  return { id: 'n1', kind, label: 'n1', ports, isArrayNode: true } as DiagramNode;
}

function renderLeft(Component: NodeSvgComponent, node: DiagramNode, portId: string, thick = false): string {
  const markup = renderToStaticMarkup(
    React.createElement(
      'svg',
      null,
      Component({
        node,
        width: 160,
        height: 80,
        arrayConnections: [{ portId, role: 'source', thick }]
      })
    )
  );
  return markup;
}

describe('array-stack leads for source-connected inout ports', () => {
  test.each([
    ['comb', CombNodeSvg, [
      { id: 'io', name: 'io', direction: 'inout' },
      { id: 'out', name: 'out', direction: 'output' }
    ]],
    ['alu', AluNodeSvg, [
      { id: 'io', name: 'io', direction: 'inout' },
      { id: 'b', name: 'b', direction: 'input' },
      { id: 'out', name: 'out', direction: 'output' }
    ]],
    ['inverter', InverterNodeSvg, [
      { id: 'io', name: 'io', direction: 'inout' },
      { id: 'out', name: 'out', direction: 'output' }
    ]],
    ['mux', MuxNodeSvg, [
      { id: 'io', name: 'io', direction: 'inout' },
      { id: 'sel', name: 'sel', direction: 'input' },
      { id: 'out', name: 'out', direction: 'output' }
    ]]
  ] as Array<[string, NodeSvgComponent, DiagramPort[]]>)(
    'renders the input-side lead for an inout port that is only a source (%s)',
    (_kind, Component, ports) => {
      const markup = renderLeft(Component, arrayNode(_kind as DiagramNodeKind, ports), 'io');
      expect(markup).toContain('svsch-array-stack-leads-left');
    }
  );

  test.each([
    ['comb', CombNodeSvg, [
      { id: 'io', name: 'io', direction: 'inout' },
      { id: 'out', name: 'out', direction: 'output' }
    ]],
    ['alu', AluNodeSvg, [
      { id: 'io', name: 'io', direction: 'inout' },
      { id: 'b', name: 'b', direction: 'input' },
      { id: 'out', name: 'out', direction: 'output' }
    ]],
    ['inverter', InverterNodeSvg, [
      { id: 'io', name: 'io', direction: 'inout' },
      { id: 'out', name: 'out', direction: 'output' }
    ]],
    ['mux', MuxNodeSvg, [
      { id: 'io', name: 'io', direction: 'inout' },
      { id: 'sel', name: 'sel', direction: 'input' },
      { id: 'out', name: 'out', direction: 'output' }
    ]]
  ] as Array<[string, NodeSvgComponent, DiagramPort[]]>)(
    'uses the source connection thickness for an inout port that is only a source (%s)',
    (_kind, Component, ports) => {
      const markup = renderLeft(Component, arrayNode(_kind as DiagramNodeKind, ports), 'io', true);
      expect(markup).toContain('svsch-array-stack-lead-thick');
    }
  );

  test('renders the top lead for a mux inout sel port that is only a source', () => {
    const ports: DiagramPort[] = [
      { id: 'sel', name: 'sel', direction: 'inout' },
      { id: 'a', name: 'a', direction: 'input' },
      { id: 'b', name: 'b', direction: 'input' },
      { id: 'out', name: 'out', direction: 'output' }
    ] as DiagramPort[];
    const markup = renderLeft(MuxNodeSvg, arrayNode('mux', ports), 'sel');
    expect(markup).toContain('svsch-array-stack-leads-top');
  });
});
