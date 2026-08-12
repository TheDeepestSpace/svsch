import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runParser } from '../helper';
import { buildViewModel } from '../../src/layout/mergeLayout';
import { renderSvg } from '../../src/cli/svgRenderer';

// The exported SVG embeds the shared diagram stylesheet (diagram.css)
// verbatim inside a <style> element. Browsers happily render even mildly
// malformed XML there, but strict XML consumers (GitHub's own SVG preview
// among them) reject the whole document outright — as happened when a source
// comment in styles.css contained a literal '<...>' tag reference. This
// guards against that class of regression recurring unnoticed in
// diagram.css, since every other test in this repo renders through a
// browser (Playwright/Chromium), which never catches it.
describe('exported SVG XML validity', () => {
  it('parses as strict, well-formed XML with the real embedded stylesheet', async () => {
    const graph = await runParser('uhdm', 'top.sv', `
      module top(input logic a, output logic y);
        assign y = a;
      endmodule
    `);
    const viewModel = await buildViewModel(graph, 'top', { version: 1, modules: {} });

    const extensionCss = fs.readFileSync(path.resolve(__dirname, '../../src/webview/diagram.css'), 'utf8');
    const reactFlowCssCandidates = [
      path.resolve(__dirname, '../../node_modules/@xyflow/react/dist/style.css'),
      path.resolve(__dirname, '../../../node_modules/@xyflow/react/dist/style.css')
    ];
    const reactFlowCss = fs.readFileSync(reactFlowCssCandidates.find((p) => fs.existsSync(p))!, 'utf8');

    const svg = renderSvg(viewModel, { reactFlowCss, extensionCss, theme: 'dark' });

    const doc = new DOMParser().parseFromString(svg, 'application/xml');
    const parserError = doc.querySelector('parsererror');
    expect(parserError?.textContent ?? null).toBeNull();
    expect(doc.documentElement.tagName).toBe('svg');
  });
});
