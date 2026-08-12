import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReactFlowProvider } from '@xyflow/react';
import { HdlNode } from '../../src/webview/nodes/HdlNode';
import type { HdlFlowNode } from '../../src/webview/nodes/types';
import type { PositionedNode } from '../../src/ir/types';

// Renders a representative fixture for every HdlNode dispatch branch and
// snapshots the resulting markup. This is the regression net for the
// per-kind-component refactor (issue #172): the pre-refactor snapshot is
// the ground truth for "no render/visual changes", so any diff here after
// the refactor lands is a real behavioral change, not a false positive.
function renderNode(node: PositionedNode, extra?: Partial<HdlFlowNode['data']>): string {
  const data: HdlFlowNode['data'] = { node, moduleName: 'top', ...extra };
  return renderToStaticMarkup(
    React.createElement(
      ReactFlowProvider,
      null,
      React.createElement(HdlNode, { id: node.id, data, selected: false } as any)
    )
  );
}

const pos = { x: 0, y: 0 };

function port(overrides: Partial<PositionedNode['ports'][number]> & { id: string; name: string; direction: 'input' | 'output' | 'inout' | 'unknown' }) {
  return overrides;
}

describe('HdlNode render snapshots (no-visual-change guard)', () => {
  it('register: clock + reset + rv + extra input', () => {
    const node: PositionedNode = {
      id: 'r1', kind: 'register', label: 'state_q', ports: [
        port({ id: 'd', name: 'D', direction: 'input' }),
        port({ id: 'q', name: 'Q', direction: 'output' }),
        port({ id: 'clk', name: 'clk', direction: 'input' }),
        port({ id: 'rst', name: 'rst_n', direction: 'input' }),
        port({ id: 'rv', name: 'RV', direction: 'input' }),
        port({ id: 'extra1', name: 'en', direction: 'input' })
      ], clockSignal: 'clk', resetSignal: 'rst_n', resetActiveLow: true, position: pos
    } as PositionedNode;
    expect(renderNode(node)).toMatchSnapshot();
  });

  it('register: array node', () => {
    const node: PositionedNode = {
      id: 'r2', kind: 'register', label: 'arr_q', ports: [
        port({ id: 'd2', name: 'D', direction: 'input' }),
        port({ id: 'q2', name: 'Q', direction: 'output' })
      ], isArrayNode: true, arrayDimension: '[3:0]', position: pos
    } as PositionedNode;
    expect(renderNode(node, { arrayConnections: [{ portId: 'd2', role: 'target', thick: true }, { portId: 'q2', role: 'source' }] })).toMatchSnapshot();
  });

  it('latch', () => {
    const node: PositionedNode = {
      id: 'l1', kind: 'latch', label: 'latch_q', ports: [
        port({ id: 'ld', name: 'D', direction: 'input' }),
        port({ id: 'lq', name: 'Q', direction: 'output' }),
        port({ id: 'lclk', name: 'en', direction: 'input' })
      ], clockSignal: 'en', position: pos
    } as PositionedNode;
    expect(renderNode(node)).toMatchSnapshot();
  });

  it('replicate', () => {
    const node: PositionedNode = {
      id: 'rep1', kind: 'replicate', label: 'x 4', ports: [
        port({ id: 'ri', name: 'in', direction: 'input' }),
        port({ id: 'ro', name: 'out', direction: 'output' })
      ], repeatExpression: 'N', repeatExpressionSource: { file: 'x.sv', startLine: 1 }, position: pos
    } as PositionedNode;
    expect(renderNode(node)).toMatchSnapshot();
  });

  it('literal', () => {
    const node: PositionedNode = {
      id: 'lit1', kind: 'literal', label: "8'hFF", ports: [
        port({ id: 'lito', name: 'out', direction: 'output' })
      ], position: pos
    } as PositionedNode;
    expect(renderNode(node)).toMatchSnapshot();
  });

  it('inverter', () => {
    const node: PositionedNode = {
      id: 'inv1', kind: 'inverter', label: 'inv', ports: [
        port({ id: 'invi', name: 'a', direction: 'input' }),
        port({ id: 'invo', name: 'y', direction: 'output' })
      ], position: pos
    } as PositionedNode;
    expect(renderNode(node)).toMatchSnapshot();
  });

  it('mux', () => {
    const node: PositionedNode = {
      id: 'mux1', kind: 'mux', label: 'mux', ports: [
        port({ id: 'sel', name: 'sel', direction: 'input' }),
        port({ id: 'i0', name: 'a', direction: 'input' }),
        port({ id: 'i1', name: 'b', direction: 'input' }),
        port({ id: 'muxo', name: 'y', direction: 'output' })
      ], position: pos
    } as PositionedNode;
    expect(renderNode(node)).toMatchSnapshot();
  });

  it('select', () => {
    const node: PositionedNode = {
      id: 'sel1', kind: 'select', label: 'select', ports: [
        port({ id: 'sw', name: 'width', direction: 'input' }),
        port({ id: 'ss', name: 's', direction: 'input' }),
        port({ id: 'si', name: 'in', direction: 'input' }),
        port({ id: 'selo', name: 'out', direction: 'output' })
      ], position: pos
    } as PositionedNode;
    expect(renderNode(node)).toMatchSnapshot();
  });

  it('alu', () => {
    const node: PositionedNode = {
      id: 'alu1', kind: 'alu', label: 'alu', operation: '+', ports: [
        port({ id: 'a1', name: 'a', direction: 'input' }),
        port({ id: 'a2', name: 'b', direction: 'input' }),
        port({ id: 'ao', name: 'y', direction: 'output' })
      ], position: pos
    } as PositionedNode;
    expect(renderNode(node)).toMatchSnapshot();
  });

  it('comb', () => {
    const node: PositionedNode = {
      id: 'comb1', kind: 'comb', label: 'comb', ports: [
        port({ id: 'ci', name: 'a', direction: 'input' }),
        port({ id: 'co', name: 'y', direction: 'output' })
      ], position: pos
    } as PositionedNode;
    expect(renderNode(node)).toMatchSnapshot();
  });

  it('loop', () => {
    const node: PositionedNode = {
      id: 'loop1', kind: 'loop', label: 'loop', ports: [
        port({ id: 'lpi', name: 'a', direction: 'input' }),
        port({ id: 'lpo', name: 'y', direction: 'output' })
      ], position: pos
    } as PositionedNode;
    expect(renderNode(node)).toMatchSnapshot();
  });

  it('instance: with parameters and warning', () => {
    const node: PositionedNode = {
      id: 'inst1', kind: 'instance', label: 'u_foo', instanceOf: 'foo_mod', ports: [
        port({ id: 'ii1', name: 'clk', direction: 'input' }),
        port({ id: 'ii2', name: 'data', direction: 'inout' }),
        port({ id: 'io1', name: 'out', direction: 'output' })
      ], instanceParameters: [{ name: 'WIDTH', value: '8' }], warningNote: 'example warning', position: pos
    } as PositionedNode;
    expect(renderNode(node)).toMatchSnapshot();
  });

  it('port: input', () => {
    const node: PositionedNode = {
      id: 'p1', kind: 'port', label: 'clk', ports: [
        port({ id: 'p1a', name: 'clk', direction: 'input' })
      ], position: pos
    } as PositionedNode;
    expect(renderNode(node)).toMatchSnapshot();
  });

  it('port: output array', () => {
    const node: PositionedNode = {
      id: 'p2', kind: 'port', label: 'y', ports: [
        port({ id: 'p2a', name: 'y', direction: 'output' })
      ], isArrayNode: true, arrayDimension: '[1:0]', position: pos
    } as PositionedNode;
    expect(renderNode(node)).toMatchSnapshot();
  });

  it('port: interface bundle (isInterfacePortNode)', () => {
    const node: PositionedNode = {
      id: 'p3', kind: 'interface', label: 'bus_if', role: 'port', typeName: 'axi_if', ports: [
        port({ id: 'p3a', name: 'bus_if', direction: 'input', typeName: 'axi_if', preferredSide: 'left' })
      ], position: pos
    } as PositionedNode;
    expect(renderNode(node)).toMatchSnapshot();
  });

  it('bus: breakout', () => {
    const node: PositionedNode = {
      id: 'b1', kind: 'bus', label: 'bus_out', ports: [
        port({ id: 'b1a', name: 'a', direction: 'output' }),
        port({ id: 'b1b', name: 'b', direction: 'output' })
      ], position: pos
    } as PositionedNode;
    expect(renderNode(node)).toMatchSnapshot();
  });

  it('bus: composition, array', () => {
    const node: PositionedNode = {
      id: 'b2', kind: 'bus', label: 'bus_in', ports: [
        port({ id: 'b2a', name: 'a', direction: 'input' }),
        port({ id: 'b2b', name: 'b', direction: 'input' })
      ], isArrayNode: true, metadata: { aggregateKind: 'array' }, position: pos
    } as PositionedNode;
    expect(renderNode(node)).toMatchSnapshot();
  });

  it('struct: composition', () => {
    const node: PositionedNode = {
      id: 's1', kind: 'struct', label: 'my_struct', role: 'composition', ports: [
        port({ id: 's1a', name: 'x', direction: 'input' }),
        port({ id: 's1b', name: 'y', direction: 'input' })
      ], position: pos
    } as PositionedNode;
    expect(renderNode(node)).toMatchSnapshot();
  });

  it('interface: instance (chevron)', () => {
    const node: PositionedNode = {
      id: 'if1', kind: 'interface', label: 'axi_inst', typeName: 'axi_if', ports: [
        port({ id: 'if1a', name: 'clk', direction: 'input' }),
        port({ id: 'if1b', name: 'mst', direction: 'unknown', width: 'interface', preferredSide: 'left' }),
        port({ id: 'if1c', name: 'slv', direction: 'unknown', width: 'interface', preferredSide: 'right' })
      ], position: pos
    } as PositionedNode;
    expect(renderNode(node)).toMatchSnapshot();
  });

  it('interface: modport', () => {
    const node: PositionedNode = {
      id: 'if2', kind: 'interface', label: 'axi_inst', role: 'modport', typeName: 'axi_if', modportName: 'mst', ports: [
        port({ id: 'if2a', name: 'req', direction: 'output' }),
        port({ id: 'if2b', name: 'ack', direction: 'input' })
      ], position: pos
    } as PositionedNode;
    expect(renderNode(node)).toMatchSnapshot();
  });

  it('netLabel', () => {
    const node: PositionedNode = {
      id: 'nl1', kind: 'netLabel', label: 'foo_net', ports: [], metadata: {
        cutNet: { netKey: 'foo_net', role: 'source', align: 'start', handleSide: 'left', origin: 'declared' }
      }, position: pos
    } as PositionedNode;
    expect(renderNode(node)).toMatchSnapshot();
  });
});
