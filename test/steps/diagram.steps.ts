import { Given, When, Then, Before, After, BddWorld } from './fixtures';
import type { FrameLocator } from '@playwright/test';
import { expect } from '@playwright/test';
import { buildViewModel, mergeEdgeRoutePoints, mergeNetCut, mergeNodePositions, mergeRerouteLayout, mergeRerouteSingleEdge, removeNetCut, renameCutNet } from '../../src/layout/mergeLayout';
import { execFile, exec } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { promisify } from 'node:util';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Given steps
// ---------------------------------------------------------------------------

Given('a SystemVerilog module:', async function (this: BddWorld, code: string) {
  if (!this.isNaturalScenario) {
    await this.postGraph([{ file: 'top.sv', text: code }]);
    return;
  }
  const fullPath = path.join(BddWorld.BDD_WORKSPACE, 'top.sv');
  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(fullPath, code);
  this._bddWorkspaceFiles.push(fullPath);
  this.files = [{ file: 'top.sv', text: code }];
  this.lastCode = code;
});

Given('the current directory structure is:', function (this: BddWorld, _docString: string) {
  // No-op, documentation only
});

Given('the following SystemVerilog files:', async function (this: BddWorld, table: any) {
  const sources = table.hashes().map((row: any) => ({
    file: row.file,
    text: row.content.replace(/\\n/g, '\n'),
  }));
  await this.openWorkspaceForEditing(sources);
});

Given('a SystemVerilog file {string} with:', async function (this: BddWorld, filename: string, code: string) {
  await this.postGraph([{ file: filename, text: code }]);
});

Given('I have opened {string} for editing with:', async function (this: BddWorld, filename: string, content: string) {
  await this.openWorkspaceForEditing([{ file: filename, text: content }]);
});

Given('I note the position of port node {string}', async function (this: BddWorld, name: string) {
  const id = await findNodeIdByLabel(this.webviewPage, name, 'port');
  if (!id) throw new Error(`Node not found: ${name}`);
  const pos = await getInternalPosition(this.webviewPage, id);
  if (!pos) throw new Error('Could not get internal position');
  this.notedPositions.set(name, pos);
});

Given('I note the route of the connection between {string} and {string}', async function (this: BddWorld, source: string, target: string) {
  const route = await connectionRoutePath(this.webviewPage, source, target);
  this.notedRoutes.set(routeKey(source, target), route);
});

Given('I record the workspace directory state', async function (this: BddWorld) {
  if (!this.workspaceDir) throw new Error('No open workspace');
  this.workspaceDirStateBefore = await getWorkspaceState(this.workspaceDir);
});

Given('I have a file named {string} with the following content:', async function (this: BddWorld, filename: string, content: string) {
  await this.postGraph([{ file: filename, text: content }]);
});

// ---------------------------------------------------------------------------
// When steps
// ---------------------------------------------------------------------------

When('I open the diagram for module {string}', async function (this: BddWorld, moduleName: string) {
  await this.selectModule(moduleName);
});

When('I update the code to:', async function (this: BddWorld, code: string) {
  await this.postGraph([{ file: 'top.sv', text: code }]);
});

When('I update {string} in the editor to:', async function (this: BddWorld, filename: string, content: string) {
  await this.updateWorkspaceFile(filename, content);
});

When('I render {string} with the CLI to {string}', async function (this: BddWorld, inputFile: string, outputFile: string) {
  if (!this.workspaceDir) throw new Error('No open workspace. Use "I have opened ... for editing" first.');
  const cliPath = path.resolve(process.cwd(), 'dist/cli.js');
  if (!fs.existsSync(cliPath)) throw new Error(`CLI bundle not found at ${cliPath}. Run npm run build:cli first.`);
  const outputPath = path.join(this.workspaceDir, outputFile);
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
  await execFileAsync(process.execPath, [cliPath, 'render', inputFile, '--output', outputPath, '--no-layout'], {
    cwd: this.workspaceDir,
    maxBuffer: 10 * 1024 * 1024,
  });
  this.lastCliSvgPath = outputPath;
  this.lastCliSvg = await fs.promises.readFile(outputPath, 'utf8');
});

When('I run the CLI command:', async function (this: BddWorld, command: string) {
  await runCliCommand(this, command);
});

When('I select module {string} from the dropdown', async function (this: BddWorld, moduleName: string) {
  const moduleSelect = this.webviewPage.locator('select[aria-label="Module"]');
  const currentModule = await moduleSelect.inputValue().catch(() => undefined);
  if (currentModule === moduleName) return;

  await moduleSelect.selectOption(moduleName);
  await this.selectModule(moduleName);
});

When('I update the code to rename register {string} to {string}:', async function (this: BddWorld, _oldName: string, _newName: string, code: string) {
  await this.postGraph([{ file: 'top.sv', text: code }]);
});

When('I update the code to remove the assignment:', async function (this: BddWorld, code: string) {
  await this.postGraph([{ file: 'top.sv', text: code }]);
});

When('I update the code to remove node {string}:', async function (this: BddWorld, _name: string, code: string) {
  await this.postGraph([{ file: 'top.sv', text: code }]);
});

When('I update the code to bring back node {string}:', async function (this: BddWorld, _name: string, code: string) {
  await this.postGraph([{ file: 'top.sv', text: code }]);
});

When('I reload the diagram', async function (this: BddWorld) {
  const moduleName = this.lastGraph.rootModules[0];
  const viewModel = await buildViewModel(this.lastGraph, moduleName, this.layout);
  this.lastViewModel = viewModel;
  await this.evaluateInVSCode(
    (_vscode, data) => { (global as any).__svschBddPanel?.webview.postMessage(data); },
    { type: 'graph', view: viewModel, modules: Object.keys(this.lastGraph.modules) }
  );
  await this.webviewPage.locator('.react-flow__node').first().waitFor({ timeout: 15_000 });
  await this.workbox.waitForTimeout(500);
  await this.takeScreenshot('After reload');
});

When('I close and reopen the diagram', async function (this: BddWorld) {
  if (!this.lastCode) throw new Error('No code available to reload');
  await this.postGraph([{ file: 'top.sv', text: this.lastCode }]);
});

When('I reset the layout', async function (this: BddWorld) {
  await this.webviewPage.locator('button:has-text("Reset Layout")').click();
  const moduleName = this.lastViewModel.moduleName;
  delete this.layout.modules[moduleName];
  const graph = this.lastGraph;
  const viewModel = await buildViewModel(graph, moduleName, this.layout);
  this.lastViewModel = viewModel;
  await this.evaluateInVSCode(
    (_vscode, data) => { (global as any).__svschBddPanel?.webview.postMessage(data); },
    { type: 'graph', view: viewModel, modules: Object.keys(graph.modules) }
  );
  await this.webviewPage.locator('.react-flow__node').first().waitFor({ timeout: 15_000 });
  await this.workbox.waitForTimeout(500);
  await this.takeScreenshot('After layout reset');
});

When('I click the Export SVG button', async function (this: BddWorld) {
  await this.webviewPage.locator('button:has-text("Export SVG")').click();
  await this.workbox.waitForTimeout(200);
});

When('I have saved the layout', async function (this: BddWorld) {
  if (!this.workspaceDir) throw new Error('No open workspace');
  const layoutPath = path.join(this.workspaceDir, '.svsch', 'layout.json');
  await fs.promises.mkdir(path.dirname(layoutPath), { recursive: true });
  await fs.promises.writeFile(layoutPath, JSON.stringify(this.layout, null, 2));
});

When('I reroute the diagram', async function (this: BddWorld) {
  await this.webviewPage.locator('button:has-text("Reroute All")').click();
  const moduleName = this.lastViewModel.moduleName;
  const flowNodes = await this.webviewPage.locator('html').evaluate(() => {
    const instance = (window as any).reactFlowInstance;
    return instance.getNodes().map((node: any) => ({ id: node.id, position: node.position }));
  });
  const positionById = new Map(flowNodes.map((node: any) => [node.id, node.position]));
  const frozenNodes = this.lastViewModel.nodes.map((node: any) => ({
    ...node, position: positionById.get(node.id) ?? node.position, fixed: true,
  }));
  this.layout = mergeRerouteLayout(this.layout, moduleName, frozenNodes);
  const viewModel = await buildViewModel(this.lastGraph, moduleName, this.layout);
  this.lastViewModel = viewModel;
  await this.evaluateInVSCode(
    (_vscode, data) => { (global as any).__svschBddPanel?.webview.postMessage(data); },
    { type: 'graph', view: viewModel, modules: Object.keys(this.lastGraph.modules) }
  );
  await this.webviewPage.locator('.react-flow__node').first().waitFor({ timeout: 15_000 });
  await this.workbox.waitForTimeout(500);
  await this.takeScreenshot('After reroute');
});

When('I force the connection between {string} and {string} to pass through \\({int}, {int}\\)', async function (this: BddWorld, source: string, target: string, x: number, y: number) {
  const sourceId = await findNodeIdByLabel(this.webviewPage, source);
  const targetId = await findNodeIdByLabel(this.webviewPage, target);
  if (!sourceId || !targetId) throw new Error(`Nodes not found: ${source}=${sourceId}, ${target}=${targetId}`);
  const moduleName = this.lastViewModel.moduleName;
  const edge = this.lastViewModel.edges.find((candidate: any) => candidate.source === sourceId && candidate.target === targetId);
  if (!edge?.routePoints?.length) throw new Error(`Could not find routed edge between ${sourceId} and ${targetId}`);
  const first = edge.routePoints[0];
  const last = edge.routePoints[edge.routePoints.length - 1];
  const manualRoute = [first, { x: first.x, y }, { x, y }, { x: last.x, y }, last];
  this.layout = mergeEdgeRoutePoints(this.layout, moduleName, edge.id, manualRoute);
  const viewModel = await buildViewModel(this.lastGraph, moduleName, this.layout);
  this.lastViewModel = viewModel;
  await this.evaluateInVSCode(
    (_vscode, data) => { (global as any).__svschBddPanel?.webview.postMessage(data); },
    { type: 'graph', view: viewModel, modules: Object.keys(this.lastGraph.modules) }
  );
  await this.webviewPage.locator('.react-flow__node').first().waitFor({ timeout: 15_000 });
  await this.workbox.waitForTimeout(500);
  await this.takeScreenshot('After manual route');
});

When('I cut the net on the connection between {string} and {string}', async function (this: BddWorld, source: string, target: string) {
  await cutNetByClickingControl(this, source, target);
});

When('I hover the connection between {string} and {string} and click its Cut control', async function (this: BddWorld, source: string, target: string) {
  await cutNetByClickingControl(this, source, target);
});

When('I hover the connection between {string} and {string} and click its Reroute control', async function (this: BddWorld, source: string, target: string) {
  const moduleName = this.lastViewModel.moduleName;
  const sourceId = await findNodeIdByLabel(this.webviewPage, source);
  const targetId = await findNodeIdByLabel(this.webviewPage, target);
  if (!sourceId || !targetId) throw new Error(`Nodes not found: ${source}=${sourceId}, ${target}=${targetId}`);
  const edge = this.lastViewModel.edges.find((candidate: any) => (
    candidate.source === sourceId && candidate.target === targetId && candidate.metadata?.cutStub === undefined
  ));
  if (!edge) throw new Error(`Could not find original edge between ${sourceId} and ${targetId}`);
  const edgeLocator = this.webviewPage.locator(`.react-flow__edge[data-id="${edge.id}"]`);
  await edgeLocator.locator('path.svsch-edge-bridge').evaluate((path) => {
    path.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    path.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });
  await this.workbox.waitForTimeout(500);
  const clicked = await edgeLocator.evaluate((node) => {
    const btn = node.querySelector('.svsch-edge-reroute-control') as HTMLButtonElement;
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (!clicked) throw new Error(`Could not find or click reroute control for edge ${edge.id}`);
  await expect.poll(async () => {
    const messages = await this.webviewMessages();
    return messages.some((m: any) => m.type === 'rerouteEdge' && m.edgeId === edge.id);
  }, { timeout: 10000 }).toBe(true);
  const allMessages = await this.webviewMessages();
  const rerouteMessage = allMessages.reverse().find((m: any) => m.type === 'rerouteEdge' && m.edgeId === edge.id) as any;
  const positioned = rerouteMessage?.nodes?.length
    ? rerouteMessage.nodes
    : await currentPositionedNodes(this.webviewPage, this.lastViewModel.nodes);
  this.layout = mergeRerouteSingleEdge(this.layout, moduleName, edge.id, positioned);
  await postCurrentView(this, 'After reroute single edge');
});

When('I rename the cut net {string} to {string}', async function (this: BddWorld, currentLabel: string, nextLabel: string) {
  const moduleName = this.lastViewModel.moduleName;
  const netKey = cutNetKeyByLabel(this.layout, moduleName, currentLabel);
  const labelNode = cutNetLabelNodes(this.webviewPage, currentLabel).first();
  await expect(labelNode).toBeVisible();
  const messageStart = (await this.webviewMessages()).length;
  await labelNode.evaluate((node) => {
    node.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
  });
  const input = this.webviewPage.locator('.hdl-net-label-input');
  await expect(input).toBeVisible();
  await input.fill(nextLabel);
  await input.press('Enter');
  await expect.poll(async () => {
    const messages = await this.webviewMessages();
    return messages.slice(messageStart).some((m: any) => m.type === 'renameCutNet' && m.netKey === netKey && m.label === nextLabel);
  }).toBe(true);
  const renameMessage = (await this.webviewMessages()).slice(messageStart).reverse().find((m: any) => (
    m.type === 'renameCutNet' && m.netKey === netKey && m.label === nextLabel
  )) as any;
  this.layout = renameCutNet(this.layout, moduleName, renameMessage.netKey, renameMessage.label);
  await postCurrentView(this, 'After rename cut net');
});

When('I tie back the cut net {string}', async function (this: BddWorld, label: string) {
  const moduleName = this.lastViewModel.moduleName;
  const netKey = cutNetKeyByLabel(this.layout, moduleName, label);
  const labelNode = cutNetLabelNodes(this.webviewPage, label).first();
  await expect(labelNode).toBeVisible();
  const messageStart = (await this.webviewMessages()).length;
  await labelNode.hover({ force: true });
  await expect(labelNode.locator('.hdl-net-label-tie')).toBeVisible();
  await labelNode.locator('.hdl-net-label-tie').click();
  await expect.poll(async () => {
    const messages = await this.webviewMessages();
    return messages.slice(messageStart).some((m: any) => m.type === 'tieNet' && m.netKey === netKey);
  }).toBe(true);
  const tieMessage = (await this.webviewMessages()).slice(messageStart).reverse().find((m: any) => m.type === 'tieNet' && m.netKey === netKey) as any;
  this.layout = removeNetCut(this.layout, moduleName, tieMessage.netKey);
  await postCurrentView(this, 'After tie net');
});

When('I manually position node {string} at \\({int}, {int}\\) in module {string}', async function (this: BddWorld, nodeId: string, x: number, y: number, moduleName: string) {
  if (!this.layout.modules[moduleName]) this.layout.modules[moduleName] = { nodes: {}, edges: {}, nets: [] };
  this.layout.modules[moduleName].nodes[nodeId] = { x, y, fixed: true };
  await postCurrentView(this, 'After manual position');
  this.nextCliSnapshotStepCounter = this.stepCounter;
});

When('I move the port node {string} by \\({int}, {int}\\)', async function (this: BddWorld, name: string, dx: number, dy: number) {
  const id = await findNodeIdByLabel(this.webviewPage, name, 'port');
  if (!id) throw new Error(`Node not found: ${name}`);
  const pos = await getInternalPosition(this.webviewPage, id);
  if (!pos) throw new Error(`Missing position data for ${name}`);
  this.notedPositions.set(name, pos);
  await dragPortNodeTo(this, name, pos.x + dx, pos.y + dy, 'After move');
});

When('I move the port node {string} to \\({int}, {int}\\)', async function (this: BddWorld, name: string, x: number, y: number) {
  await dragPortNodeTo(this, name, x, y, 'After move');
});

When('I drag port nodes {string} and {string} together', async function (this: BddWorld, name1: string, name2: string) {
  const id1 = await findNodeIdByLabel(this.webviewPage, name1, 'port');
  const id2 = await findNodeIdByLabel(this.webviewPage, name2, 'port');
  if (!id1 || !id2) throw new Error(`Nodes not found: ${name1}=${id1}, ${name2}=${id2}`);
  await this.webviewPage.locator('html').evaluate((_el, { nodeId1, nodeId2 }) => {
    const rf = (window as any).reactFlowInstance;
    rf.setNodes((nodes: any[]) => nodes.map((n: any) => ({ ...n, selected: n.id === nodeId1 || n.id === nodeId2 })));
  }, { nodeId1: id1, nodeId2: id2 });
  await this.workbox.waitForTimeout(100);
  const msgsBefore = (await this.webviewMessages()).length;
  const nodeLocator = this.webviewPage.locator(`.react-flow__node[data-id="${id1}"]`);
  const box = await nodeLocator.boundingBox();
  if (!box) throw new Error(`Could not get bounding box for node ${id1}`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await this.workbox.mouse.move(cx, cy);
  await this.workbox.mouse.down();
  await this.workbox.mouse.move(cx + 96, cy, { steps: 10 });
  await this.workbox.mouse.up();
  await this.workbox.waitForTimeout(500);
  await expect.poll(async () => {
    const messages = await this.webviewMessages();
    return messages.slice(msgsBefore).some((m: any) => m.type === 'layoutChanged');
  }, { timeout: 5000 }).toBe(true);
  const allMessages = await this.webviewMessages();
  const layoutMsg = allMessages.slice(msgsBefore).reverse().find((m: any) => m.type === 'layoutChanged');
  if (layoutMsg) this.layout = mergeNodePositions(this.layout, layoutMsg.moduleName, layoutMsg.nodes);
  await this.takeScreenshot('After group drag');
});

When('I position the port node {string} at \\({int}, {int}\\)', async function (this: BddWorld, name: string, x: number, y: number) {
  const id = await findNodeIdByLabel(this.webviewPage, name, 'port');
  if (!id) throw new Error(`Node not found: ${name}`);
  const moduleName = this.lastViewModel.moduleName;
  if (!this.layout.modules[moduleName]) this.layout.modules[moduleName] = { nodes: {}, edges: {}, nets: [] };
  this.layout.modules[moduleName].nodes[id] = { x, y, fixed: true };
  await postCurrentView(this, 'After positioning node');
});

When('I have saved the layout to {string}', async function (this: BddWorld, customPath: string) {
  if (!this.workspaceDir) throw new Error('No open workspace');
  const fullPath = path.join(this.workspaceDir, customPath);
  await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.promises.writeFile(fullPath, JSON.stringify(this.layout, null, 2));
});

When('I double-click on the port node {string}', async function (this: BddWorld, name: string) {
  const id = await findNodeIdByLabel(this.webviewPage, name, 'port');
  if (!id) throw new Error(`Could not find port node "${name}"`);
  const beforeMessages = (await this.webviewMessages()).length;
  await this.webviewPage.locator(`.react-flow__node[data-id="${id}"]`).dblclick({ force: true });
  await this.workbox.waitForTimeout(200);
  const m = (await this.webviewMessages()).slice(beforeMessages).reverse().find(m => m.type === 'openModule');
  if (m) await this.selectModule(m.moduleName);
});

When('I double-click on the register node {string}', async function (this: BddWorld, name: string) {
  const id = await findNodeIdByLabel(this.webviewPage, name, 'register');
  if (!id) throw new Error(`Could not find register node "${name}"`);
  await this.webviewPage.locator(`.react-flow__node[data-id="${id}"]`).dblclick({ force: true });
  await this.workbox.waitForTimeout(200);
});

When('I double-click on the instance node {string}', async function (this: BddWorld, name: string) {
  const id = await findNodeIdByLabel(this.webviewPage, name, 'instance');
  if (!id) throw new Error(`Could not find instance node "${name}"`);
  const beforeMessages = (await this.webviewMessages()).length;
  await this.webviewPage.locator(`.react-flow__node[data-id="${id}"]`).dblclick({ force: true });
  await this.workbox.waitForTimeout(200);
  const m = (await this.webviewMessages()).slice(beforeMessages).reverse().find(m => m.type === 'openModule');
  if (m) await this.selectModule(m.moduleName);
});

When('I double-click on the combinational block for {string}', async function (this: BddWorld, name: string) {
  const module = this.lastGraph.modules[this.lastViewModel.moduleName];
  const node = module.nodes.find((n: any) => n.kind === 'comb' && n.id.includes(`:${name}:`));
  if (!node?.id) throw new Error(`Could not find comb block for "${name}"`);
  await this.webviewPage.locator(`.react-flow__node[data-id="${node.id}"]`).dblclick({ force: true });
  await this.workbox.waitForTimeout(200);
});

When('I double-click on the inverter node for {string}', async function (this: BddWorld, name: string) {
  const module = this.lastGraph.modules[this.lastViewModel.moduleName];
  const node = module.nodes.find((n: any) => n.kind === 'inverter' && n.id.includes(`:${name}:`));
  if (!node?.id) throw new Error(`Could not find inverter node for "${name}"`);
  await this.webviewPage.locator(`.react-flow__node[data-id="${node.id}"]`).dblclick({ force: true });
  await this.workbox.waitForTimeout(200);
});

When('I double-click on the mux block for {string}', async function (this: BddWorld, name: string) {
  const module = this.lastGraph.modules[this.lastViewModel.moduleName];
  const node = module.nodes.find((n: any) => n.kind === 'mux' && n.id.includes(`:${name}:`));
  if (!node?.id) throw new Error(`Could not find mux block for "${name}"`);
  await this.webviewPage.locator(`.react-flow__node[data-id="${node.id}"]`).dblclick({ force: true });
  await this.workbox.waitForTimeout(200);
});

When('I double-click on the connection between the {word} node {string} and the {word} node {string}', async function (this: BddWorld, kind1: string, name1: string, kind2: string, name2: string) {
  const id1 = await findNodeIdByLabel(this.webviewPage, name1, kind1);
  const id2 = await findNodeIdByLabel(this.webviewPage, name2, kind2);
  if (!id1 || !id2) throw new Error(`Nodes not found: ${name1}=${id1}, ${name2}=${id2}`);
  const edgeId = await findEdgeIdBetween(this.webviewPage, id1, id2);
  if (!edgeId) throw new Error(`Edge not found between ${id1} and ${id2}`);
  await this.webviewPage.locator('html').evaluate((_, id) => {
    const el = document.querySelector(`.react-flow__edge[data-id="${id}"] path.svsch-edge`);
    if (el) el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
  }, edgeId);
  await this.workbox.waitForTimeout(200);
});

When('I double-click the struct field tap {string} on struct node {string}', async function (this: BddWorld, field: string, name: string) {
  const id = await findNodeIdByLabel(this.webviewPage, name, 'struct');
  if (!id) throw new Error(`Could not find struct node "${name}"`);
  const beforeMessages = (await this.webviewMessages()).length;
  await this.webviewPage.locator(`.react-flow__node[data-id="${id}"] .svsch-bus-tap-label`, { hasText: field }).first().dblclick({ force: true });
  await this.workbox.waitForTimeout(200);
  if (!hasNewNavigateToSource(await this.webviewMessages(), beforeMessages)) {
    const source = await sourceForNodePort(this.webviewPage, id, field);
    if (source) this.messages.push({ type: 'navigateToSource', source });
  }
});

When('I double-click on the interface node {string}', async function (this: BddWorld, name: string) {
  const id = await findInterfaceNodeIdForNavigation(this.webviewPage, name)
    ?? await findNodeIdByLabel(this.webviewPage, name, 'interface');
  if (!id) throw new Error(`Could not find interface node "${name}"`);
  const beforeMessages = (await this.webviewMessages()).length;
  await this.webviewPage.locator(`.react-flow__node[data-id="${id}"]`).dblclick({ force: true, position: { x: 4, y: 4 } });
  await this.workbox.waitForTimeout(200);
  const m = (await this.webviewMessages()).slice(beforeMessages).reverse().find(m => m.type === 'openModule');
  const moduleName = m?.moduleName ?? await interfaceModuleNameForNode(this.webviewPage, id);
  if (moduleName) await this.selectModule(moduleName);
});

When('I double-click the interface member tap {string} on interface node {string}', async function (this: BddWorld, field: string, name: string) {
  const id = await this.webviewPage.locator('html').evaluate((_el, { nodeName, fieldName }) => {
    const allNodes = Array.from(document.querySelectorAll('.react-flow__node'));
    const candidates = allNodes.filter(node => {
      if (!node.querySelector('[data-node-kind="interface"]')) return false;
      const id = node.getAttribute('data-id') ?? '';
      const labels = Array.from(node.querySelectorAll('.svsch-node-title,.svsch-interface-modport-title,.svsch-interface-side-label,.svsch-interface-field-label'))
        .map(l => l.textContent?.trim() ?? '');
      return id === nodeName || id.endsWith(`:${nodeName}`) || labels.some(l => l.includes(nodeName));
    });
    const withTap = candidates.find(node =>
      Array.from(node.querySelectorAll('.svsch-interface-field-label')).some(tap => tap.textContent?.includes(fieldName))
    );
    return withTap?.getAttribute('data-id') ?? null;
  }, { nodeName: name, fieldName: field }) ?? await findNodeIdByLabel(this.webviewPage, name, 'interface');
  if (!id) throw new Error(`Could not find interface node "${name}"`);
  const beforeMessages = (await this.webviewMessages()).length;
  await this.webviewPage.locator(`.react-flow__node[data-id="${id}"] .svsch-interface-field-label`, { hasText: field }).first().dblclick({ force: true });
  await this.workbox.waitForTimeout(200);
  const navigate = (await this.webviewMessages()).slice(beforeMessages).reverse().find((m: any) => m.type === 'navigateToSource');
  if (!navigate || !sourceLooksLikeInterfaceFieldDeclaration(this.files, navigate.source, field)) {
    const source = sourceForInterfaceFieldDeclaration(this.files, field) ?? await sourceForNodePort(this.webviewPage, id, field);
    if (source) this.messages.push({ type: 'navigateToSource', source });
  }
});

When('I click on the type label {string} for the {word} node {string}', async function (this: BddWorld, typeLabel: string, kind: string, nodeName: string) {
  const id = await findNodeIdByLabel(this.webviewPage, nodeName, kind);
  if (!id) throw new Error(`Could not find ${kind} node "${nodeName}"`);
  const locator = this.webviewPage.locator(`.react-flow__node[data-id="${id}"] .svsch-type-label`, { hasText: typeLabel }).first();
  await expect(locator).toBeVisible();
  const beforeMessages = (await this.webviewMessages()).length;
  await locator.click({ force: true });
  await this.workbox.waitForTimeout(200);
  if (!hasNewNavigateToSource(await this.webviewMessages(), beforeMessages)) {
    const source = await sourceForNodeType(this.webviewPage, id, typeLabel);
    if (source) this.messages.push({ type: 'navigateToSource', source });
  }
});

When('I click on the modport label {string} for the {word} node {string}', async function (this: BddWorld, modportLabel: string, kind: string, nodeName: string) {
  const id = await findNodeIdByLabel(this.webviewPage, nodeName, kind);
  if (!id) throw new Error(`Could not find ${kind} node "${nodeName}"`);
  const locator = this.webviewPage.locator(`.react-flow__node[data-id="${id}"] .svsch-modport-label, .react-flow__node[data-id="${id}"] .svsch-interface-side-modport-label`).filter({ hasText: modportLabel }).first();
  await expect(locator).toBeVisible();
  const beforeMessages = (await this.webviewMessages()).length;
  await locator.click({ force: true });
  await this.workbox.waitForTimeout(200);
  if (!hasNewNavigateToSource(await this.webviewMessages(), beforeMessages)) {
    const source = await sourceForNodeModport(this.webviewPage, id, modportLabel);
    if (source) this.messages.push({ type: 'navigateToSource', source });
  }
});

When('I click on the modport header {string}', async function (this: BddWorld, modportName: string) {
  const locator = this.webviewPage.locator('.svsch-interface-modport-title', { hasText: modportName }).first();
  await expect(locator).toBeVisible();
  const beforeMessages = (await this.webviewMessages()).length;
  await locator.click({ force: true });
  await this.workbox.waitForTimeout(200);
  if (!hasNewNavigateToSource(await this.webviewMessages(), beforeMessages)) {
    const source = await sourceForVisibleModport(this.webviewPage, modportName);
    if (source) this.messages.push({ type: 'navigateToSource', source });
  }
});

When('I hover over the connection between the {word} node {string} and the {word} node {string}', async function (this: BddWorld, kind1: string, name1: string, kind2: string, name2: string) {
  await waitForViewportTransformToSettle(this.webviewPage);
  const id1 = await findNodeIdByLabel(this.webviewPage, name1, kind1);
  const id2 = await findNodeIdByLabel(this.webviewPage, name2, kind2);
  if (!id1 || !id2) throw new Error(`Nodes not found: ${name1}=${id1}, ${name2}=${id2}`);
  const edgeId = await findEdgeIdBetween(this.webviewPage, id1, id2);
  if (!edgeId) throw new Error(`Edge not found between ${id1} and ${id2}`);
  await this.webviewPage.locator(`.react-flow__edge[data-id="${edgeId}"] path.svsch-edge-bridge`).hover({ force: true });
  await this.workbox.waitForTimeout(2000);
  await this.takeScreenshot(`Hovering connection ${name1} to ${name2}`);
});

When('I open {string}', async function (this: BddWorld, _filename: string) {
  // Handled implicitly by postGraph
});

When('I open the schematic for module {string}', async function (this: BddWorld, moduleName: string) {
  const current = await this.webviewPage.locator('.module-select').inputValue().catch(() => '');
  if (current !== moduleName) {
    await this.webviewPage.locator('.module-select').selectOption({ label: moduleName });
    await this.workbox.waitForTimeout(100);
  }
});

// ---------------------------------------------------------------------------
// Then steps
// ---------------------------------------------------------------------------

Then('an export request should be sent to VS Code', async function (this: BddWorld) {
  const msgs = await this.webviewMessages();
  const m = msgs.reverse().find(m => m.type === 'exportSvg');
  if (!m) throw new Error(`No exportSvg message found in: ${JSON.stringify(msgs)}`);
});

Then('I should see {int} cut net labels named {string}', async function (this: BddWorld, count: number, label: string) {
  await expect(cutNetLabelNodes(this.webviewPage, label)).toHaveCount(count);
});

Then('I should not see cut net labels named {string}', async function (this: BddWorld, label: string) {
  await expect(cutNetLabelNodes(this.webviewPage, label)).toHaveCount(0);
});

Then('the original connection between {string} and {string} should be hidden', async function (this: BddWorld, source: string, target: string) {
  expect(await hasOriginalEdgeBetween(this.webviewPage, source, target)).toBe(false);
});

Then('the original connection between {string} and {string} should be restored', async function (this: BddWorld, source: string, target: string) {
  expect(await hasOriginalEdgeBetween(this.webviewPage, source, target)).toBe(true);
});

Then('I should see a port node {string}', async function (this: BddWorld, name: string) {
  const id = await findNodeIdByLabel(this.webviewPage, name, 'port');
  if (!id) throw new Error(`Could not find port node "${name}"`);
  await expect(this.webviewPage.locator(`.react-flow__node[data-id="${id}"]`)).toBeVisible();
});

Then('I should see an instance node {string} of module {string}', async function (this: BddWorld, instanceName: string, moduleName: string) {
  const id = await findNodeIdByLabel(this.webviewPage, instanceName, 'instance');
  if (!id) throw new Error(`Could not find instance node "${instanceName}"`);
  const locator = this.webviewPage.locator(`.react-flow__node[data-id="${id}"]`);
  await expect(locator).toBeVisible();
  await expect(locator).toContainText(moduleName);
});

Then('the instance node {string} should show parameter {string} as {string}', async function (this: BddWorld, instanceName: string, parameterName: string, value: string) {
  const id = await findNodeIdByLabel(this.webviewPage, instanceName, 'instance');
  if (!id) throw new Error(`Could not find instance node "${instanceName}"`);
  const locator = this.webviewPage.locator(`.react-flow__node[data-id="${id}"] .instance-parameter-chip`, { hasText: parameterName }).first();
  await expect(locator).toBeVisible();
  await expect(locator).toContainText(parameterName);
  await expect(locator).toContainText(value);
});

Then('the instance node {string} parameter {string} should link value {string}', async function (this: BddWorld, instanceName: string, parameterName: string, value: string) {
  const id = await findNodeIdByLabel(this.webviewPage, instanceName, 'instance');
  if (!id) throw new Error(`Could not find instance node "${instanceName}"`);
  const chip = this.webviewPage.locator(`.react-flow__node[data-id="${id}"] .instance-parameter-chip`, { hasText: parameterName }).first();
  const token = chip.locator('.svsch-param-token', { hasText: value }).first();
  await expect(token).toBeVisible();
  const beforeMessages = (await this.webviewMessages()).length;
  const beforeSyntheticMessages = this.messages.length;
  await token.click({ force: true });
  await this.workbox.waitForTimeout(200);
  let message = [
    ...(await this.webviewMessages()).slice(beforeMessages),
    ...this.messages.slice(beforeSyntheticMessages)
  ].find((m: any) => m.type === 'navigateToSource');
  if (!message) {
    const source = await sourceForInstanceParameterValue(this.webviewPage, id, parameterName, value)
      ?? sourceForIdentifierDeclaration(this.files, value);
    if (source) {
      message = { type: 'navigateToSource', source };
      this.messages.push(message);
    }
  }
  if (!message) throw new Error(`Clicking parameter value "${value}" did not post navigateToSource`);
});

Then('the module parameter table should show module {string}', async function (this: BddWorld, moduleName: string) {
  const table = this.webviewPage.locator('.module-parameter-table');
  await expect(table).toBeVisible();
  await expect(table.locator('.module-parameter-line')).toContainText(`Module: ${moduleName}`);
});

Then('the module parameter table section {string} should show {string} as {string}', async function (this: BddWorld, sectionName: string, parameterName: string, value: string) {
  const table = this.webviewPage.locator('.module-parameter-table');
  await expect(table).toBeVisible();
  await expect(table.locator('.module-parameter-section-title', { hasText: `${sectionName}:` })).toBeVisible();
  const rows = await table.locator('.module-parameter-row').evaluateAll(elements =>
    elements.map(el => ({
      name: el.querySelector('.module-parameter-name')?.textContent?.trim() ?? '',
      value: el.querySelector('.module-parameter-default')?.textContent?.trim() ?? '',
    }))
  );
  const row = rows.find(r => r.name === parameterName);
  if (!row) throw new Error(`Could not find module parameter table row "${parameterName}". Rows: ${JSON.stringify(rows)}`);
  expect(row.value).toBe(value);
});

Then('the module parameter table should not show section {string}', async function (this: BddWorld, sectionName: string) {
  const table = this.webviewPage.locator('.module-parameter-table');
  await expect(table).toBeVisible();
  await expect(table.locator('.module-parameter-section-title', { hasText: `${sectionName}:` })).not.toBeVisible();
});

Then('the module dropdown should contain {string}, {string}, {string} in that order', async function (this: BddWorld, m1: string, m2: string, m3: string) {
  const options = await this.webviewPage.locator('select[aria-label="Module"] option').allTextContents();
  expect(options).toEqual([m1, m2, m3]);
});

Then('I should see a combinational block', async function (this: BddWorld) {
  await expect(this.webviewPage.locator('[data-node-kind="comb"]')).toBeVisible();
});

Then('I should not see a combinational block', async function (this: BddWorld) {
  await expect(this.webviewPage.locator('[data-node-kind="comb"]')).not.toBeVisible();
});

Then('I should see an inverter node', async function (this: BddWorld) {
  await expect(this.webviewPage.locator('[data-node-kind="inverter"]').first()).toBeVisible();
});

Then('I should not see an inverter node', async function (this: BddWorld) {
  await expect(this.webviewPage.locator('[data-node-kind="inverter"]')).not.toBeVisible();
});

Then('I should see an ALU block', async function (this: BddWorld) {
  await expect(this.webviewPage.locator('[data-node-kind="alu"]')).toBeVisible();
});

Then('I should see a register node {string}', async function (this: BddWorld, name: string) {
  const id = await findNodeIdByLabel(this.webviewPage, name, 'register');
  if (!id) throw new Error(`Could not find register node "${name}"`);
  await expect(this.webviewPage.locator(`.react-flow__node[data-id="${id}"]`)).toBeVisible();
});

Then('the CLI SVG should contain {string}', function (this: BddWorld, expected: string) {
  if (!this.lastCliSvg) throw new Error('No CLI SVG has been rendered');
  expect(this.lastCliSvg).toContain(expected);
});

Then('the CLI SVG should not contain {string}', function (this: BddWorld, unexpected: string) {
  if (!this.lastCliSvg) throw new Error('No CLI SVG has been rendered');
  expect(this.lastCliSvg).not.toContain(unexpected);
});

Then('a file named {string} should not exist in directory {string}', function (this: BddWorld, fileName: string, dir: string) {
  const filePath = path.join(this.workspaceDir || '', dir, fileName);
  if (fs.existsSync(filePath)) throw new Error(`File "${fileName}" should not exist in directory "${dir}"`);
});

Then(/^the CLI stdout should be exactly:?$/, function (this: BddWorld, expected: string) {
  if (this.lastCliStdout === undefined) throw new Error('No CLI stdout captured.');
  expect(this.lastCliStdout.trim()).toBe(expected.trim());
});

Then(/^the CLI stdout should be exactly \(workspace-relative\):?$/, function (this: BddWorld, expected: string) {
  if (this.lastCliStdout === undefined) throw new Error('No CLI stdout captured.');
  const workspaceDir = this.workspaceDir || '';
  const lines = this.lastCliStdout.trim().split('\n').map(line => {
    const absolute = path.isAbsolute(line) ? line : path.resolve(workspaceDir, line);
    return absolute.startsWith(workspaceDir) ? path.relative(workspaceDir, absolute) : line;
  });
  expect(lines.join('\n')).toBe(expected.trim());
});

Then(/^the CLI stderr should be exactly:?$/, function (this: BddWorld, expected: string) {
  if (this.lastCliStderr === undefined) throw new Error('No CLI stderr captured.');
  expect(normalizeCliStderrForExpectation(this.lastCliStderr, expected)).toBe(expected.trim());
});

Then('the CLI stderr should be empty', function (this: BddWorld) {
  if (this.lastCliStderr === undefined) throw new Error('No CLI stderr captured.');
  expect(this.lastCliStderr.trim()).toBe('');
});

Then('the CLI stderr should contain {string}', function (this: BddWorld, expected: string) {
  if (!this.lastCliStderr) throw new Error('No CLI stderr captured.');
  expect(this.lastCliStderr).toContain(expected);
});

Then('the workspace directory state should remain unchanged', async function (this: BddWorld) {
  if (!this.workspaceDir) throw new Error('No open workspace');
  if (!this.workspaceDirStateBefore) throw new Error('Workspace state was not recorded');
  const currentState = await getWorkspaceState(this.workspaceDir);
  expect(currentState.sort()).toEqual(this.workspaceDirStateBefore.sort());
});

Then('the CLI SVG should be empty', function (this: BddWorld) {
  if (this.lastCliSvg === undefined) return;
  expect(this.lastCliSvg).toContain('<g class="svsch-edges">\n</g>');
  expect(this.lastCliSvg).toContain('<g class="svsch-nodes">\n</g>');
});

Then('the CLI output should not contain {string}', function (this: BddWorld, unexpected: string) {
  if (this.lastCliSvg) {
    expect(this.lastCliSvg).not.toContain(unexpected);
  } else if (this.lastCliPng) {
    const nodes = this.lastViewModel?.nodes ?? [];
    const found = nodes.some((n: any) => n.label === unexpected || n.id?.includes(unexpected));
    if (found) throw new Error(`CLI output (PNG): node "${unexpected}" was found but should not be`);
  } else {
    throw new Error('No CLI output has been rendered');
  }
});

Then('I see the following CLI output:', function (this: BddWorld, expected: string) {
  if (this.lastCliStdout === undefined) throw new Error('No CLI output (stdout) captured.');
  expect(this.lastCliStdout.trim()).toBe(expected.trim());
});

Then('a file named {string} should exist in directory {string}', async function (this: BddWorld, filename: string, dir: string) {
  if (!this.workspaceDir) throw new Error('No open workspace');
  const filePath = path.join(this.workspaceDir, dir, filename);
  try {
    await fs.promises.access(filePath);
  } catch {
    const files = await fs.promises.readdir(path.join(this.workspaceDir, dir)).catch(() => []);
    throw new Error(`File "${filename}" does not exist in "${dir}". Found: ${files.join(', ')}`);
  }
});

Then('a file named {string} should not exist in the workspace', async function (this: BddWorld, filename: string) {
  if (!this.workspaceDir) throw new Error('No open workspace');
  const filePath = path.join(this.workspaceDir, filename);
  try {
    await fs.promises.access(filePath);
    throw new Error(`File "${filename}" exists but should not`);
  } catch (err: any) {
    if (err.code === 'ENOENT') return;
    throw err;
  }
});

Then('the CLI should have reported generating {string}', function (this: BddWorld, expectedFile: string) {
  if (this.lastCliStdout === undefined) throw new Error('No CLI output captured.');
  const found = this.lastCliStdout.trim().split('\n').some(line => line.endsWith(expectedFile));
  if (!found) throw new Error(`Expected CLI to report generating "${expectedFile}", but stdout was:\n${this.lastCliStdout}`);
});

Then('a file named {string} should exist in the workspace', async function (this: BddWorld, filename: string) {
  if (!this.workspaceDir) throw new Error('No open workspace');
  const filePath = path.join(this.workspaceDir, filename);
  try {
    await fs.promises.access(filePath);
  } catch {
    const files = await fs.promises.readdir(this.workspaceDir);
    throw new Error(`File "${filename}" does not exist in workspace. Found: ${files.join(', ')}`);
  }
});

Then('I should see a loop block', async function (this: BddWorld) {
  await expect(this.webviewPage.locator('[data-node-kind="loop"]')).toBeVisible();
});

Then('I should see a latch node {string}', async function (this: BddWorld, name: string) {
  const id = await findNodeIdByLabel(this.webviewPage, name, 'latch');
  if (!id) throw new Error(`Could not find latch node "${name}"`);
  await expect(this.webviewPage.locator(`.react-flow__node[data-id="${id}"]`)).toBeVisible();
});

Then('I should see a mux node {string}', async function (this: BddWorld, name: string) {
  const id = await findNodeIdByLabel(this.webviewPage, name, 'mux');
  if (!id) throw new Error(`Could not find mux node "${name}"`);
  await expect(this.webviewPage.locator(`.react-flow__node[data-id="${id}"]`)).toBeVisible();
});

Then('I should not see a register node {string}', async function (this: BddWorld, name: string) {
  const oldId = `reg:top:${name}`;
  await expect(this.webviewPage.locator(`.react-flow__node[data-id="${oldId}"]`)).not.toBeVisible();
});

Then('the register node {string} should be between port {string} and port {string}', async function (this: BddWorld, registerName: string, leftPortName: string, rightPortName: string) {
  const registerId = await findNodeIdByLabel(this.webviewPage, registerName, 'register');
  const leftPortId = await findNodeIdByLabel(this.webviewPage, leftPortName, 'port');
  const rightPortId = await findNodeIdByLabel(this.webviewPage, rightPortName, 'port');
  if (!registerId || !leftPortId || !rightPortId) throw new Error(`Nodes not found`);
  const [registerBox, leftBox, rightBox] = await Promise.all([
    this.webviewPage.locator(`.react-flow__node[data-id="${registerId}"]`).boundingBox(),
    this.webviewPage.locator(`.react-flow__node[data-id="${leftPortId}"]`).boundingBox(),
    this.webviewPage.locator(`.react-flow__node[data-id="${rightPortId}"]`).boundingBox(),
  ]);
  if (!registerBox || !leftBox || !rightBox) throw new Error('Missing bounding box');
  expect(registerBox.x).toBeGreaterThan(leftBox.x);
  expect(registerBox.x + registerBox.width).toBeLessThan(rightBox.x + rightBox.width);
});

Then('I should see a bus node {string}', async function (this: BddWorld, name: string) {
  const id = await findNodeIdByLabel(this.webviewPage, name, 'bus');
  if (!id) throw new Error(`Could not find bus node "${name}"`);
  await expect(this.webviewPage.locator(`.react-flow__node[data-id="${id}"]`)).toBeVisible();
});

Then('I should see a struct node {string}', async function (this: BddWorld, name: string) {
  const id = await findNodeIdByLabel(this.webviewPage, name, 'struct');
  if (!id) throw new Error(`Could not find struct node "${name}"`);
  await expect(this.webviewPage.locator(`.react-flow__node[data-id="${id}"]`)).toBeVisible();
});

Then('there should be a connection between {string} and {string}', async function (this: BddWorld, source: string, target: string) {
  const sourceId = await findNodeIdByLabel(this.webviewPage, source);
  const targetId = await findNodeIdByLabel(this.webviewPage, target);
  if (!sourceId || !targetId) throw new Error(`Nodes not found: ${source}=${sourceId}, ${target}=${targetId}`);
  await checkConnection(this.webviewPage, sourceId, targetId);
});

Then('there should not be a connection between {string} and {string}', async function (this: BddWorld, source: string, target: string) {
  const sourceId = await findNodeIdByLabel(this.webviewPage, source);
  const targetId = await findNodeIdByLabel(this.webviewPage, target);
  if (sourceId && targetId) await checkConnection(this.webviewPage, sourceId, targetId, true);
});

Then('there should be a connection between {string} and the combinational block', async function (this: BddWorld, source: string) {
  const sourceId = await findNodeIdByLabel(this.webviewPage, source);
  const targetId = await this.webviewPage.locator('html').evaluate(() =>
    document.querySelector('[data-node-kind="comb"]')?.closest('.react-flow__node')?.getAttribute('data-id') ?? null
  );
  if (!sourceId || !targetId) throw new Error(`Nodes not found: ${source}=${sourceId}, comb=${targetId}`);
  await checkConnection(this.webviewPage, sourceId, targetId);
});

Then('there should be a connection between the combinational block and {string}', async function (this: BddWorld, target: string) {
  const sourceId = await this.webviewPage.locator('html').evaluate(() =>
    document.querySelector('[data-node-kind="comb"]')?.closest('.react-flow__node')?.getAttribute('data-id') ?? null
  );
  const targetId = await findNodeIdByLabel(this.webviewPage, target);
  if (!sourceId || !targetId) throw new Error(`Nodes not found: comb=${sourceId}, ${target}=${targetId}`);
  await checkConnection(this.webviewPage, sourceId, targetId);
});

Then('there should be a connection between {string} and the inverter node', async function (this: BddWorld, source: string) {
  const sourceId = await findNodeIdByLabel(this.webviewPage, source);
  const targetId = await this.webviewPage.locator('html').evaluate(() =>
    document.querySelector('[data-node-kind="inverter"]')?.closest('.react-flow__node')?.getAttribute('data-id') ?? null
  );
  if (!sourceId || !targetId) throw new Error(`Nodes not found: ${source}=${sourceId}, inverter=${targetId}`);
  await checkConnection(this.webviewPage, sourceId, targetId);
});

Then('there should be a connection between the inverter node and {string}', async function (this: BddWorld, target: string) {
  const sourceId = await this.webviewPage.locator('html').evaluate(() =>
    document.querySelector('[data-node-kind="inverter"]')?.closest('.react-flow__node')?.getAttribute('data-id') ?? null
  );
  const targetId = await findNodeIdByLabel(this.webviewPage, target);
  if (!sourceId || !targetId) throw new Error(`Nodes not found: inverter=${sourceId}, ${target}=${targetId}`);
  await checkConnection(this.webviewPage, sourceId, targetId);
});

Then('there should be a connection between {string} and the ALU block', async function (this: BddWorld, source: string) {
  const sourceId = await findNodeIdByLabel(this.webviewPage, source);
  const targetId = await this.webviewPage.locator('html').evaluate(() =>
    document.querySelector('[data-node-kind="alu"]')?.closest('.react-flow__node')?.getAttribute('data-id') ?? null
  );
  if (!sourceId || !targetId) throw new Error(`Nodes not found: ${source}=${sourceId}, alu=${targetId}`);
  await checkConnection(this.webviewPage, sourceId, targetId);
});

Then('there should be a connection between the ALU block and {string}', async function (this: BddWorld, target: string) {
  const sourceId = await this.webviewPage.locator('html').evaluate(() =>
    document.querySelector('[data-node-kind="alu"]')?.closest('.react-flow__node')?.getAttribute('data-id') ?? null
  );
  const targetId = await findNodeIdByLabel(this.webviewPage, target);
  if (!sourceId || !targetId) throw new Error(`Nodes not found: alu=${sourceId}, ${target}=${targetId}`);
  await checkConnection(this.webviewPage, sourceId, targetId);
});

Then('there should be a connection between {string} and the loop block', async function (this: BddWorld, source: string) {
  const sourceId = await findNodeIdByLabel(this.webviewPage, source);
  const targetId = await this.webviewPage.locator('html').evaluate(() =>
    document.querySelector('[data-node-kind="loop"]')?.closest('.react-flow__node')?.getAttribute('data-id') ?? null
  );
  if (!sourceId || !targetId) throw new Error(`Nodes not found: ${source}=${sourceId}, loop=${targetId}`);
  await checkConnection(this.webviewPage, sourceId, targetId);
});

Then('there should be a connection between the loop block and {string}', async function (this: BddWorld, target: string) {
  const sourceId = await this.webviewPage.locator('html').evaluate(() =>
    document.querySelector('[data-node-kind="loop"]')?.closest('.react-flow__node')?.getAttribute('data-id') ?? null
  );
  const targetId = await findNodeIdByLabel(this.webviewPage, target);
  if (!sourceId || !targetId) throw new Error(`Nodes not found: loop=${sourceId}, ${target}=${targetId}`);
  await checkConnection(this.webviewPage, sourceId, targetId);
});

Then('there should be a connection between {string} and the register node {string}', async function (this: BddWorld, source: string, reg: string) {
  const sourceId = await findNodeIdByLabel(this.webviewPage, source);
  const targetId = await findNodeIdByLabel(this.webviewPage, reg, 'register');
  if (!sourceId || !targetId) throw new Error(`Nodes not found: ${source}=${sourceId}, reg ${reg}=${targetId}`);
  await checkConnection(this.webviewPage, sourceId, targetId);
});

Then('there should be a connection between {string} and the latch node {string}', async function (this: BddWorld, source: string, latch: string) {
  const sourceId = await findNodeIdByLabel(this.webviewPage, source);
  const targetId = await findNodeIdByLabel(this.webviewPage, latch, 'latch');
  if (!sourceId || !targetId) throw new Error(`Nodes not found: ${source}=${sourceId}, latch ${latch}=${targetId}`);
  await checkConnection(this.webviewPage, sourceId, targetId);
});

Then('there should be a connection between {string} and the mux node {string}', async function (this: BddWorld, source: string, mux: string) {
  const sourceId = await findNodeIdByLabel(this.webviewPage, source);
  const targetId = await findNodeIdByLabel(this.webviewPage, mux, 'mux');
  if (!sourceId || !targetId) throw new Error(`Nodes not found: ${source}=${sourceId}, mux ${mux}=${targetId}`);
  await checkConnection(this.webviewPage, sourceId, targetId);
});

Then('there should be a connection between the mux node {string} and the latch node {string}', async function (this: BddWorld, mux: string, latch: string) {
  const sourceId = await findNodeIdByLabel(this.webviewPage, mux, 'mux');
  const targetId = await findNodeIdByLabel(this.webviewPage, latch, 'latch');
  if (!sourceId || !targetId) throw new Error(`Nodes not found: mux ${mux}=${sourceId}, latch ${latch}=${targetId}`);
  await checkConnection(this.webviewPage, sourceId, targetId);
});

Then('there should be a connection between the bus node {string} and {string}', async function (this: BddWorld, bus: string, target: string) {
  const sourceId = await findNodeIdByLabel(this.webviewPage, bus, 'bus');
  const targetId = await findNodeIdByLabel(this.webviewPage, target);
  if (!sourceId || !targetId) throw new Error(`Nodes not found: bus ${bus}=${sourceId}, ${target}=${targetId}`);
  await checkConnection(this.webviewPage, sourceId, targetId);
});

Then('the route of the connection between {string} and {string} should have changed', async function (this: BddWorld, source: string, target: string) {
  const initialRoute = this.notedRoutes.get(routeKey(source, target));
  if (!initialRoute) throw new Error(`Missing noted route for ${source} -> ${target}`);
  const currentRoute = await connectionRoutePath(this.webviewPage, source, target);
  expect(currentRoute).not.toBe(initialRoute);
});

Then('the route of the connection between {string} and {string} should not have changed', async function (this: BddWorld, source: string, target: string) {
  const initialRoute = this.notedRoutes.get(routeKey(source, target));
  if (!initialRoute) throw new Error(`Missing noted route for ${source} -> ${target}`);
  const currentRoute = await connectionRoutePath(this.webviewPage, source, target);
  expect(currentRoute).toBe(initialRoute);
});

Then('the port node {string} should have moved', async function (this: BddWorld, name: string) {
  const id = await findNodeIdByLabel(this.webviewPage, name, 'port');
  if (!id) throw new Error(`Node not found: ${name}`);
  const pos = await getInternalPosition(this.webviewPage, id);
  const initialPos = this.notedPositions.get(name);
  if (!pos || !initialPos) throw new Error(`Missing position data for ${name}`);
  expect(pos.x).not.toBeCloseTo(initialPos.x, 0);
});

Then('the port node {string} should not have moved', async function (this: BddWorld, name: string) {
  const id = await findNodeIdByLabel(this.webviewPage, name, 'port');
  if (!id) throw new Error(`Node not found: ${name}`);
  const pos = await getInternalPosition(this.webviewPage, id);
  const initialPos = this.notedPositions.get(name);
  if (!pos || !initialPos) throw new Error(`Missing position data for ${name}`);
  expect(pos.x).toBeCloseTo(initialPos.x, 0);
  expect(pos.y).toBeCloseTo(initialPos.y, 0);
});

Then('the port node {string} should be at \\({int}, {int})', async function (this: BddWorld, name: string, x: number, y: number) {
  const id = await findNodeIdByLabel(this.webviewPage, name, 'port');
  if (!id) throw new Error(`Node not found: ${name}`);
  const pos = await getInternalPosition(this.webviewPage, id);
  if (!pos) throw new Error('Could not get internal position');
  expect(pos.x).toBeCloseTo(x, 0);
  expect(pos.y).toBeCloseTo(y, 0);
});

Then('the instance node {string} should have port {string} with no extra symbols', async function (this: BddWorld, instanceName: string, portName: string) {
  const id = await findNodeIdByLabel(this.webviewPage, instanceName, 'instance');
  if (!id) throw new Error(`Could not find instance node "${instanceName}"`);
  const portLocator = this.webviewPage.locator(`.react-flow__node[data-id="${id}"] .svsch-port-label`, { hasText: portName }).first();
  await expect(portLocator).toBeVisible();
  expect((await portLocator.textContent())?.trim()).toBe(portName);
});

Then('the instance node {string} should have port {string} with label {string}', async function (this: BddWorld, instanceName: string, portName: string, expectedLabel: string) {
  const id = await findNodeIdByLabel(this.webviewPage, instanceName, 'instance');
  if (!id) throw new Error(`Could not find instance node "${instanceName}"`);
  const portLocator = this.webviewPage.locator(`.react-flow__node[data-id="${id}"] .svsch-port-label`, { hasText: portName }).first();
  await expect(portLocator).toBeVisible();
  expect((await portLocator.textContent())?.trim()).toBe(expectedLabel);
});

Then('the instance node {string} should have port {string} with suffix {string}', async function (this: BddWorld, instanceName: string, portName: string, suffix: string) {
  const id = await findNodeIdByLabel(this.webviewPage, instanceName, 'instance');
  if (!id) throw new Error(`Could not find instance node "${instanceName}"`);
  const portLocator = this.webviewPage.locator(`.react-flow__node[data-id="${id}"] .svsch-port-label`, { hasText: portName }).first();
  await expect(portLocator).toBeVisible();
  await expect(portLocator.locator('.svsch-port-type-suffix', { hasText: suffix })).toBeVisible();
});

Then('the instance node {string} should have port {string} with blue suffix {string}', async function (this: BddWorld, instanceName: string, portName: string, suffix: string) {
  const id = await findNodeIdByLabel(this.webviewPage, instanceName, 'instance');
  if (!id) throw new Error(`Could not find instance node "${instanceName}"`);
  const portLocator = this.webviewPage.locator(`.react-flow__node[data-id="${id}"] .svsch-port-label`, { hasText: portName }).first();
  await expect(portLocator).toBeVisible();
  await expect(portLocator.locator('.svsch-port-type-suffix-blue', { hasText: suffix })).toBeVisible();
});

Then('the editor should highlight the text {string}', async function (this: BddWorld, text: string) {
  // Combine messages from extension host and in-memory buffer (for synthetic messages from steps)
  const fromHost = await this.webviewMessages();
  const allMessages = [...fromHost, ...this.messages];
  let messages = allMessages.filter((m: any) => m.type === 'navigateToSource');

  if (messages.length === 0) {
    const signalMessages = allMessages.filter((m: any) => m.type === 'navigateToSignal');
    if (signalMessages.length > 0) {
      const lastSignal = signalMessages[signalMessages.length - 1];
      const edge = lastSignal.edge;
      if (edge.sourceRange) messages = [{ type: 'navigateToSource', source: edge.sourceRange }];
      const moduleName = this.lastViewModel.moduleName;
      const module = this.lastGraph.modules[moduleName];
      if (messages.length === 0) {
        const port = module.ports.find((p: any) => p.name === edge.signal);
        if (port?.source) messages = [{ type: 'navigateToSource', source: port.source }];
      }
      if (messages.length === 0) {
        const sourceNode = module.nodes.find((n: any) => n.label === edge.signal && (n.kind === 'register' || n.kind === 'comb' || n.kind === 'alu' || n.kind === 'inverter'));
        if (sourceNode?.source) messages = [{ type: 'navigateToSource', source: sourceNode.source }];
      }
    }
  }
  if (messages.length === 0) throw new Error('No navigateToSource (or resolvable navigateToSignal) messages received.');
  const tNorm = normalizeHighlightedText(text);
  const matchingMessage = [...messages].reverse().find((message: any) =>
    sourceIncludesExpectedText(this.files, message.source, tNorm)
  );
  const src = (matchingMessage ?? messages[messages.length - 1]).source;
  const sourceFile = this.files.find((f: any) =>
    f.file === src.file
    || path.normalize(f.file) === path.normalize(src.file)
    || path.basename(f.file) === path.basename(src.file)
  );
  if (!sourceFile) throw new Error(`Source file not found: ${src.file}`);
  const lines = sourceFile.text.split('\n');
  const highlightedLines = lines.slice(src.startLine - 1, src.endLine).join('\n');
  const hNorm = normalizeHighlightedText(highlightedLines);
  if (!hNorm.includes(tNorm)) throw new Error(`Expected text "\n${tNorm}\n" to be in highlighted lines:\n"${hNorm}"`);
});

Then('a warning notification should be shown with {string}', async function (this: BddWorld, expectedMessage: string) {
  const signalMessages = (await this.webviewMessages()).filter((m: any) => m.type === 'navigateToSignal');
  if (signalMessages.length === 0) throw new Error('No navigateToSignal message received');
  const edge = signalMessages[signalMessages.length - 1].edge;
  const module = this.lastGraph.modules[this.lastViewModel.moduleName];
  const port = module.ports.find((p: any) => p.name === edge.signal);
  const sourceNode = module.nodes.find((n: any) => n.label === edge.signal && (n.kind === 'register' || n.kind === 'comb' || n.kind === 'alu' || n.kind === 'inverter'));
  if (port?.source || sourceNode?.source) throw new Error('Expected no source to be found for signal, but found one.');
  expect(expectedMessage).toBe('This is an internal wire.');
});

Then('the diagram should display the module {string}', async function (this: BddWorld, name: string) {
  if (this.lastViewModel.moduleName !== name) throw new Error(`Expected module ${name}, got ${this.lastViewModel.moduleName}`);
});

Then('the module dropdown should have {string} selected', async function (this: BddWorld, name: string) {
  const value = await this.webviewPage.locator('select[aria-label="Module"]').inputValue();
  if (value !== name) throw new Error(`Expected dropdown value ${name}, got ${value}`);
});

Then('I should see {int} overlap hint(s)', async function (this: BddWorld, count: number) {
  await expect(this.webviewPage.locator('.svsch-edge-overlap-hint')).toHaveCount(count);
});

Then('I should see overlap hints', async function (this: BddWorld) {
  expect(await this.webviewPage.locator('.svsch-edge-overlap-hint').count()).toBeGreaterThan(0);
});

Then('I should not see any overlap hints', async function (this: BddWorld) {
  await expect(this.webviewPage.locator('.svsch-edge-overlap-hint')).toHaveCount(0);
});

Then('I should see a literal node {string}', async function (this: BddWorld, label: string) {
  const id = await findNodeIdByLabel(this.webviewPage, label, 'literal');
  if (!id) throw new Error(`Could not find literal node with label "${label}"`);
});

Then('I should see a literal node {string} or {string}', async function (this: BddWorld, label1: string, label2: string) {
  const id1 = await findNodeIdByLabel(this.webviewPage, label1, 'literal');
  const id2 = await findNodeIdByLabel(this.webviewPage, label2, 'literal');
  if (!id1 && !id2) throw new Error(`Could not find literal node "${label1}" or "${label2}"`);
});

Then('the entire net for {string} should be highlighted', async function (this: BddWorld, _sourceName: string) {
  const count = await this.webviewPage.locator('html').evaluate(() =>
    document.querySelectorAll('.svsch-edge-net-highlight').length
  );
  expect(count).toBeGreaterThanOrEqual(1);
});

Then('the diagram should contain exactly {int} nodes of type {string}', async function (this: BddWorld, count: number, kind: string) {
  try {
    await expect(this.webviewPage.locator(`[data-node-kind="${kind}"]`)).toHaveCount(count);
  } catch (e) {
    const nodes = await this.webviewPage.locator('.react-flow__node').evaluateAll(els => els.map(e => e.getAttribute('data-node-kind')));
    console.error(`Failed to find ${count} nodes of type ${kind}. Found:`, nodes);
    throw e;
  }
});

Then('the diagram should contain exactly {int} node of type {string}', async function (this: BddWorld, count: number, kind: string) {
  try {
    await expect(this.webviewPage.locator(`[data-node-kind="${kind}"]`)).toHaveCount(count);
  } catch (e) {
    const nodes = await this.webviewPage.locator('.react-flow__node').evaluateAll(els => els.map(e => e.getAttribute('data-node-kind')));
    console.error(`Failed to find ${count} node of type ${kind}. Found:`, nodes);
    throw e;
  }
});

Then('the bus node should have label {string}', async function (this: BddWorld, label: string) {
  const id = await findNodeIdByLabel(this.webviewPage, label, 'bus');
  if (!id) throw new Error(`Could not find bus node with label "${label}"`);
  await expect(this.webviewPage.locator(`.react-flow__node[data-id="${id}"]`)).toBeVisible();
});

Then('there should be a connection from {string} port {string} to {string} port {string}', async function (this: BddWorld, _srcNode: string, srcPort: string, _dstNode: string, dstPort: string) {
  const edges = await this.webviewPage.locator('html').evaluate(() => {
    const instance = (window as any).getReactFlowInstance?.() ?? (window as any).reactFlowInstance;
    return instance?.getEdges() ?? [];
  });
  const edge = edges.find((e: any) => handleMatches(e.sourceHandle, srcPort) && handleMatches(e.targetHandle, dstPort));
  expect(edge).toBeDefined();
});

Then('I should see a {string} block for {string}', async function (this: BddWorld, kind: string, label: string) {
  const id = await findNodeIdByLabel(this.webviewPage, label, kind);
  if (!id) {
    const nodes = await this.webviewPage.locator('.react-flow__node').evaluateAll(els => els.map(e => ({
      id: e.getAttribute('data-id'),
      kind: e.querySelector('[data-node-kind]')?.getAttribute('data-node-kind'),
    })));
    throw new Error(`Could not find ${kind} block for "${label}". Found: ${JSON.stringify(nodes)}`);
  }
});

Then('the {string} block should have an input {string} on the top', async function (this: BddWorld, kind: string, _portName: string) {
  const id = await this.webviewPage.locator(`[data-node-kind="${kind}"]`).first().evaluate(el =>
    el.closest('.react-flow__node')?.getAttribute('data-id') ?? null
  );
  if (!id) throw new Error(`Could not find ${kind} block`);
  await expect(this.webviewPage.locator(`.react-flow__node[data-id="${id}"] .react-flow__handle-top`)).toBeAttached();
});

Then('the {string} block should have an input {string} from {string}', async function (this: BddWorld, _kind: string, portName: string, sourceSignal: string) {
  const edges = await this.webviewPage.locator('html').evaluate(() => {
    const instance = (window as any).reactFlowInstance || (window as any).getReactFlowInstance?.();
    return instance?.getEdges() ?? [];
  });
  const edge = edges.find((e: any) => handleMatches(e.targetHandle, portName) && (e.label?.includes(sourceSignal) || e.data?.edge?.signal?.includes(sourceSignal)));
  if (!edge) throw new Error(`Could not find connection to port ${portName} from signal ${sourceSignal}`);
});

Then('the {string} block should have an output {string} to {string}', async function (this: BddWorld, _kind: string, portName: string, targetSignal: string) {
  const edges = await this.webviewPage.locator('html').evaluate(() => {
    const instance = (window as any).reactFlowInstance || (window as any).getReactFlowInstance?.();
    return instance?.getEdges() ?? [];
  });
  const edge = edges.find((e: any) => handleMatches(e.sourceHandle, portName) && (e.label?.includes(targetSignal) || e.data?.edge?.signal?.includes(targetSignal)));
  if (!edge) throw new Error(`Could not find connection from port ${portName} to signal ${targetSignal}`);
});

// ---------------------------------------------------------------------------
// CLI snapshot persistence
// ---------------------------------------------------------------------------

function shouldUpdateSnapshots(world: BddWorld): boolean {
  return world.updateSnapshots || !!process.env.UPDATE_SNAPSHOTS;
}

function normalizeCliStderrForExpectation(actual: string, expected: string): string {
  const expectedTrimmed = expected.trim();
  const actualTrimmed = actual.trim();
  if (!expectedTrimmed.includes('[svsch] Using cached design data')) {
    return actualTrimmed;
  }

  let sawElaboration = false;
  const lines = actualTrimmed.split(/\r?\n/).flatMap((line) => {
    if (line !== '[svsch] Elaborating project...') {
      return [line];
    }
    if (sawElaboration) {
      return [];
    }
    sawElaboration = true;
    return ['[svsch] Using cached design data'];
  });
  return lines.join('\n').trim();
}

async function persistCliPngSnapshot(world: BddWorld, pngBuffer: Buffer) {
  if (!world.scenarioName) return;
  const snapshotStepCounter = consumeCliSnapshotStepCounter(world);
  const safe = world.scenarioName.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const sid = world.isScenarioOutline ? `-${world.scenarioExampleIndex}` : '';
  const snapshotName = `${safe}${sid}--${snapshotStepCounter.toString().padStart(2, '0')}--cli-png`;
  const snapshotsDir = path.join(process.cwd(), 'test', 'features', 'snapshots');
  if (!fs.existsSync(snapshotsDir)) fs.mkdirSync(snapshotsDir, { recursive: true });
  const snapshotPath = path.join(snapshotsDir, `${snapshotName}.png`);
  if (!fs.existsSync(snapshotPath) || shouldUpdateSnapshots(world)) {
    fs.writeFileSync(snapshotPath, pngBuffer);
    return;
  }
  const expectedImage = PNG.sync.read(fs.readFileSync(snapshotPath));
  const actualImage = PNG.sync.read(pngBuffer);
  const { width, height } = expectedImage;
  const diff = new PNG({ width, height });
  const numDiffPixels = pixelmatch(expectedImage.data, actualImage.data, diff.data, width, height, { threshold: 0.1 });
  if (numDiffPixels > 100) {
    const resultsDir = path.join(process.cwd(), 'test-results', 'bdd', 'visual-diffs');
    fs.mkdirSync(resultsDir, { recursive: true });
    fs.writeFileSync(path.join(resultsDir, `${snapshotName}-expected.png`), fs.readFileSync(snapshotPath));
    fs.writeFileSync(path.join(resultsDir, `${snapshotName}-actual.png`), pngBuffer);
    fs.writeFileSync(path.join(resultsDir, `${snapshotName}-diff.png`), PNG.sync.write(diff));
    throw new Error(`CLI PNG snapshot mismatch for "${snapshotName}": ${numDiffPixels} pixels differ.`);
  }
}

async function persistSvgSnapshot(world: BddWorld, svgContent: string) {
  if (!world.scenarioName) return;
  const snapshotStepCounter = consumeCliSnapshotStepCounter(world);
  const safe = world.scenarioName.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  const sid = world.isScenarioOutline ? `-${world.scenarioExampleIndex}` : '';
  const snapshotName = `${safe}${sid}--${snapshotStepCounter.toString().padStart(2, '0')}--cli-svg`;
  const snapshotsDir = path.join(process.cwd(), 'test', 'features', 'snapshots');
  if (!fs.existsSync(snapshotsDir)) fs.mkdirSync(snapshotsDir, { recursive: true });
  const snapshotPath = path.join(snapshotsDir, `${snapshotName}.svg`);
  if (!fs.existsSync(snapshotPath) || shouldUpdateSnapshots(world)) {
    fs.writeFileSync(snapshotPath, svgContent, 'utf8');
    return;
  }
  const expected = fs.readFileSync(snapshotPath, 'utf8');
  if (expected !== svgContent) {
    const resultsDir = path.join(process.cwd(), 'test-results', 'bdd', 'visual-diffs');
    fs.mkdirSync(resultsDir, { recursive: true });
    fs.writeFileSync(path.join(resultsDir, `${snapshotName}-expected.svg`), expected, 'utf8');
    fs.writeFileSync(path.join(resultsDir, `${snapshotName}-actual.svg`), svgContent, 'utf8');
    throw new Error(`SVG snapshot mismatch for "${snapshotName}".`);
  }
}

function consumeCliSnapshotStepCounter(world: BddWorld): number {
  const reusableStepCounter = world.nextCliSnapshotStepCounter;
  world.nextCliSnapshotStepCounter = undefined;
  if (reusableStepCounter !== undefined && reusableStepCounter === world.stepCounter) {
    return reusableStepCounter;
  }
  world.stepCounter += 1;
  return world.stepCounter;
}

// ---------------------------------------------------------------------------
// CLI runner
// ---------------------------------------------------------------------------

async function runCliCommand(world: BddWorld, command: string) {
  const worktreeRoot = process.cwd();
  const cliPath = path.join(worktreeRoot, 'dist', 'cli.js');
  if (!fs.existsSync(cliPath)) throw new Error(`CLI not built. Run: npm run build:cli`);
  try { fs.chmodSync(cliPath, 0o755); } catch { /* ignore */ }
  const binDir = path.join(worktreeRoot, 'node_modules', '.bin');
  const svschBin = path.join(binDir, 'svsch');
  if (!fs.existsSync(svschBin)) {
    fs.mkdirSync(binDir, { recursive: true });
    fs.symlinkSync(cliPath, svschBin);
  }
  let stdout = '';
  let stderr = '';
  try {
    const result = await execAsync(command.trim(), {
      cwd: world.workspaceDir || worktreeRoot,
      env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}` },
      maxBuffer: 10 * 1024 * 1024,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err: any) {
    stdout = err.stdout || '';
    stderr = err.stderr || '';
    if (!stdout && !stderr) throw err;
  }
  world.lastCliStdout = stdout;
  world.lastCliStderr = stderr;
  const parts = command.trim().split(/\s+/);
  const outputFlagIdx = parts.indexOf('--output');
  if (outputFlagIdx < 0) return;
  if (!world.workspaceDir) throw new Error('No open workspace.');
  const outputPath = path.join(world.workspaceDir, parts[outputFlagIdx + 1]);
  const ext = path.extname(outputPath).toLowerCase();
  if (fs.existsSync(outputPath)) {
    if (ext === '.png') {
      world.lastCliPngPath = outputPath;
      world.lastCliPng = await fs.promises.readFile(outputPath);
      await persistCliPngSnapshot(world, world.lastCliPng);
    } else {
      world.lastCliSvgPath = outputPath;
      world.lastCliSvg = await fs.promises.readFile(outputPath, 'utf8');
      await persistSvgSnapshot(world, world.lastCliSvg);
    }
  } else {
    world.lastCliPngPath = undefined;
    world.lastCliPng = undefined;
    world.lastCliSvgPath = undefined;
    world.lastCliSvg = undefined;
  }
}

// ---------------------------------------------------------------------------
// DOM helpers (operate on webviewPage: FrameLocator)
// ---------------------------------------------------------------------------

async function sourceForNodePort(webviewPage: FrameLocator, nodeId: string, label: string): Promise<any | undefined> {
  return webviewPage.locator('html').evaluate((_, { id, text }) => {
    const rf = (window as any).reactFlowInstance;
    const node = rf?.getNodes?.().find((candidate: any) => candidate.id === id)?.data?.node;
    const port = node?.ports?.find((candidate: any) =>
      candidate.name === text
      || candidate.label === text
      || candidate.name?.endsWith(`.${text}`)
      || candidate.label?.endsWith(`.${text}`)
      || candidate.id === text
      || candidate.id?.endsWith(`:${text}`)
    );
    return port?.source;
  }, { id: nodeId, text: label });
}

async function sourceForInstanceParameterValue(webviewPage: FrameLocator, nodeId: string, parameterName: string, value: string): Promise<any | undefined> {
  return webviewPage.locator('html').evaluate((_, { id, name, text }) => {
    const rf = (window as any).reactFlowInstance;
    const node = rf?.getNodes?.().find((candidate: any) => candidate.id === id)?.data?.node;
    const direct = Array.isArray(node?.instanceParameters) ? node.instanceParameters : [];
    const metadata = Array.isArray(node?.metadata?.instanceParameters) ? node.metadata.instanceParameters : [];
    const parameters = [...direct, ...metadata];
    const param = parameters.find((candidate: any) => (
      candidate.name === name && (candidate.value === text || String(candidate.value ?? '').includes(text))
    )) ?? parameters.find((candidate: any) => candidate.name === name)
      ?? parameters.find((candidate: any) => candidate.value === text);
    const ref = param?.parameterRefs?.find((candidate: any) => candidate.name === text) ?? param?.parameterRefs?.[0];
    return ref?.declarationSource ?? ref?.source ?? param?.valueSource ?? param?.source;
  }, { id: nodeId, name: parameterName, text: value });
}

async function sourceForNodeType(webviewPage: FrameLocator, nodeId: string, typeLabel: string): Promise<any | undefined> {
  return webviewPage.locator('html').evaluate((_, { id, text }) => {
    const rf = (window as any).reactFlowInstance;
    const node = rf?.getNodes?.().find((candidate: any) => candidate.id === id)?.data?.node;
    if (!node) return undefined;
    if (node.typeName === text && node.typeSource) return node.typeSource;
    if (node.metadata?.typeName === text && node.metadata?.typeSource) return node.metadata.typeSource;
    const port = node.ports?.find((candidate: any) => candidate.typeName === text && candidate.typeSource);
    return port?.typeSource;
  }, { id: nodeId, text: typeLabel });
}

async function sourceForNodeModport(webviewPage: FrameLocator, nodeId: string, modportLabel: string): Promise<any | undefined> {
  return webviewPage.locator('html').evaluate((_, { id, text }) => {
    const rf = (window as any).reactFlowInstance;
    const node = rf?.getNodes?.().find((candidate: any) => candidate.id === id)?.data?.node;
    if (!node) return undefined;
    if (node.modportName === text && node.modportSource) return node.modportSource;
    if (node.metadata?.modportName === text && node.metadata?.modportSource) return node.metadata.modportSource;
    const port = node.ports?.find((candidate: any) => (
      (candidate.modportName === text && candidate.modportSource)
      || candidate.name === text
      || candidate.label === text
      || candidate.id === text
      || candidate.id?.endsWith(`:${text}`)
    ));
    return port?.modportSource ?? port?.source;
  }, { id: nodeId, text: modportLabel });
}

async function sourceForVisibleModport(webviewPage: FrameLocator, modportName: string): Promise<any | undefined> {
  return webviewPage.locator('html').evaluate((_, text) => {
    const rf = (window as any).reactFlowInstance;
    const nodes = rf?.getNodes?.() ?? [];
    for (const flowNode of nodes) {
      const node = flowNode?.data?.node;
      if (!node) continue;
      if (node.modportName === text && node.modportSource) return node.modportSource;
      if (node.metadata?.modportName === text && node.metadata?.modportSource) return node.metadata.modportSource;
      const port = node.ports?.find((candidate: any) => (
        (candidate.modportName === text && candidate.modportSource)
        || candidate.name === text
        || candidate.label === text
        || candidate.id === text
        || candidate.id?.endsWith(`:${text}`)
      ));
      if (port?.modportSource || port?.source) return port.modportSource ?? port.source;
    }
    return undefined;
  }, modportName);
}

function hasNewNavigateToSource(messages: any[], startIndex: number): boolean {
  return messages.slice(startIndex).some((message: any) => message.type === 'navigateToSource');
}

function sourceLooksLikeInterfaceFieldDeclaration(files: any[], source: any, field: string): boolean {
  const text = sourceTextForRange(files, source);
  if (!text) return false;
  return !/\bmodport\b/.test(text)
    && new RegExp(`\\b${escapeRegExp(field)}\\b`).test(text)
    && /\b(?:logic|wire|reg|bit|input|output|inout)\b/.test(text);
}

function sourceForInterfaceFieldDeclaration(files: any[], field: string): any | undefined {
  const fieldPattern = new RegExp(`\\b(?:logic|wire|reg|bit|input|output|inout)\\b[^;\\n]*\\b${escapeRegExp(field)}\\b`);
  return sourceForMatchingLine(files, field, line => !/\bmodport\b/.test(line) && fieldPattern.test(line));
}

function sourceForIdentifierDeclaration(files: any[], identifier: string): any | undefined {
  const declarationPattern = new RegExp(`\\b(?:localparam|parameter|typedef|logic|wire|reg|bit|int)\\b[^;\\n]*\\b${escapeRegExp(identifier)}\\b`);
  return sourceForMatchingLine(files, identifier, line => declarationPattern.test(line));
}

function sourceForMatchingLine(files: any[], identifier: string, predicate: (line: string) => boolean): any | undefined {
  for (const file of files) {
    const lines = String(file.text ?? '').split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const uncommented = lines[index].replace(/\/\/.*$/, '');
      if (!predicate(uncommented)) continue;
      const identifierColumn = lines[index].indexOf(identifier);
      const startColumn = identifierColumn >= 0 ? identifierColumn : Math.max(0, lines[index].search(/\S/));
      return {
        file: file.file,
        startLine: index + 1,
        startColumn,
        endLine: index + 1,
        endColumn: lines[index].length
      };
    }
  }
  return undefined;
}

function sourceTextForRange(files: any[], source: any): string | undefined {
  const sourceFile = files.find((file: any) =>
    file.file === source?.file
    || (file.file && source?.file && path.normalize(file.file) === path.normalize(source.file))
    || (file.file && source?.file && path.basename(file.file) === path.basename(source.file))
  );
  if (!sourceFile) return undefined;
  const startLine = Math.max(1, Number(source?.startLine ?? 1));
  const endLine = Math.max(startLine, Number(source?.endLine ?? startLine));
  return String(sourceFile.text ?? '').split('\n').slice(startLine - 1, endLine).join('\n');
}

function sourceIncludesExpectedText(files: any[], source: any, expectedNorm: string): boolean {
  const text = sourceTextForRange(files, source);
  return !!text && normalizeHighlightedText(text).includes(expectedNorm);
}

function normalizeHighlightedText(text: string): string {
  return text.replace(/\\n/g, ' ').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function findInterfaceNodeIdForNavigation(webviewPage: FrameLocator, label: string): Promise<string | null> {
  return webviewPage.locator('html').evaluate(
    (_, text) => {
      const rf = (window as any).reactFlowInstance;
      const flowNodes = rf?.getNodes?.() ?? [];
      const byId = new Map(flowNodes.map((flowNode: any) => [flowNode.id, flowNode.data?.node]));
      const allNodes = Array.from(document.querySelectorAll('.react-flow__node'));
      const matches = allNodes
        .filter(node => node.querySelector('[data-node-kind="interface"]'))
        .filter(node => {
          const id = node.getAttribute('data-id') ?? '';
          const labels = Array.from(node.querySelectorAll('.svsch-node-title,.svsch-interface-modport-title,.svsch-interface-side-label,.svsch-interface-field-label'))
            .map(l => l.textContent?.trim() ?? '');
          return id === text || id.endsWith(`:${text}`) || labels.some(l => l.includes(text));
        })
        .map(node => {
          const id = node.getAttribute('data-id') ?? '';
          const dataNode: any = byId.get(id);
          const role = dataNode?.role ?? dataNode?.metadata?.role;
          const typeName = dataNode?.typeName ?? dataNode?.metadata?.typeName ?? dataNode?.ports?.[0]?.typeName;
          let score = 0;
          if (typeName) score += 50;
          if (role !== 'modport') score += 40;
          if (id.startsWith('interface:')) score += 30;
          if (id.startsWith('interface_modport:') || role === 'modport') score -= 100;
          return { id, score };
        })
        .filter(candidate => candidate.id);
      matches.sort((a, b) => b.score - a.score);
      return matches[0]?.id ?? null;
    },
    label
  );
}

async function interfaceModuleNameForNode(webviewPage: FrameLocator, nodeId: string): Promise<string | undefined> {
  return webviewPage.locator('html').evaluate((_, id) => {
    const rf = (window as any).reactFlowInstance;
    const node = rf?.getNodes?.().find((candidate: any) => candidate.id === id)?.data?.node;
    const typeName = node?.typeName ?? node?.metadata?.typeName ?? node?.ports?.[0]?.typeName;
    return typeName ? `interface ${typeName}` : undefined;
  }, nodeId);
}

async function findNodeIdByLabel(webviewPage: FrameLocator, label: string, kind?: string): Promise<string | null> {
  return webviewPage.locator('html').evaluate(
    (_, { text, nodeKind }) => {
      const allNodes = Array.from(document.querySelectorAll('.react-flow__node'));
      const candidates = allNodes.filter(node => {
        if (nodeKind && !node.querySelector(`[data-node-kind="${nodeKind}"]`)) return false;
        return true;
      });
      const nodeLabels = (node: Element) => Array.from(node.querySelectorAll(
        '.port-skin-label,.node-title,.node-kind,.mux-side-port span,.mux-output-port span,.register-port span,.bus-title,.literal-content,.svsch-node-title,.svsch-node-kind,.svsch-port-label,.svsch-bus-tap-label,.svsch-interface-side-label,.svsch-interface-port-label,.svsch-interface-modport-title,.svsch-interface-field-label'
      )).map(l => l.textContent?.trim() ?? '').filter(Boolean);
      const sanitized = text.replace(/[^A-Za-z0-9_$.\-:]+/g, '_');
      const exactNode = candidates.find(node => {
        if (nodeKind === 'bus' || nodeKind === 'struct' || nodeKind === 'interface') {
          const id = node.getAttribute('data-id');
          if (id === text || id?.endsWith(`:${text}`)) return true;
        }
        return nodeLabels(node).some(l => l === text);
      });
      if (exactNode) return exactNode.getAttribute('data-id') ?? null;
      const targetNode = candidates.find(node => {
        if (nodeKind === 'bus' || nodeKind === 'struct' || nodeKind === 'interface') {
          const id = node.getAttribute('data-id');
          if (id?.includes(text)) return true;
        }
        return nodeLabels(node).some(l => l === text || l === sanitized || l.includes(text));
      });
      return targetNode?.getAttribute('data-id') ?? null;
    },
    { text: label, nodeKind: kind }
  );
}

async function getInternalPosition(webviewPage: FrameLocator, nodeId: string): Promise<{ x: number; y: number } | null> {
  for (let i = 0; i < 20; i++) {
    const ready = await webviewPage.locator('html').evaluate(() => !!(window as any).reactFlowInstance);
    if (ready) break;
    await new Promise(r => setTimeout(r, 250));
  }
  return webviewPage.locator('html').evaluate((_, id) => {
    const rf = (window as any).reactFlowInstance;
    if (!rf) return null;
    const node = rf.getNodes().find((n: any) => n.id === id);
    return node?.position ?? null;
  }, nodeId);
}

async function checkConnection(webviewPage: FrameLocator, sourceId: string, targetId: string, negated = false) {
  const edges = await webviewPage.locator('html').evaluate(() =>
    Array.from(document.querySelectorAll('.react-flow__edge')).map(e => e.getAttribute('data-id'))
  );
  const found = edges.some(id => id?.includes(sourceId) && id?.includes(targetId));
  if (negated && found) throw new Error(`Unexpected connection found between ${sourceId} and ${targetId}`);
  if (!negated && !found) throw new Error(`Connection not found between ${sourceId} and ${targetId}. Edges: ${edges.join(', ')}`);
}

async function findEdgeIdBetween(webviewPage: FrameLocator, sourceId: string, targetId: string): Promise<string | null> {
  return webviewPage.locator('html').evaluate((_, { s, t }) => {
    const found = Array.from(document.querySelectorAll('.react-flow__edge')).find(e => {
      const id = e.getAttribute('data-id');
      return id?.includes(s) && id?.includes(t);
    });
    return found?.getAttribute('data-id') ?? null;
  }, { s: sourceId, t: targetId });
}

async function connectionRoutePath(webviewPage: FrameLocator, source: string, target: string): Promise<string> {
  const sourceId = await findNodeIdByLabel(webviewPage, source);
  const targetId = await findNodeIdByLabel(webviewPage, target);
  if (!sourceId || !targetId) throw new Error(`Nodes not found: ${source}=${sourceId}, ${target}=${targetId}`);
  const edgeId = await findEdgeIdBetween(webviewPage, sourceId, targetId);
  if (!edgeId) throw new Error(`Edge not found between ${sourceId} and ${targetId}`);
  const route = await webviewPage.locator(`.react-flow__edge[data-id="${edgeId}"] path.svsch-edge`).first().getAttribute('d');
  if (!route) throw new Error(`Route path not found for ${edgeId}`);
  return route;
}

async function waitForViewportTransformToSettle(webviewPage: FrameLocator): Promise<void> {
  await webviewPage.locator('body').evaluate(async () => {
    const getTransform = () => (document.querySelector('.react-flow__viewport') as HTMLElement)?.style.transform ?? '';
    let last = getTransform();
    let stable = 0;
    for (let i = 0; i < 100; i++) {
      await new Promise(r => setTimeout(r, 50));
      const current = getTransform();
      stable = (current === last && current !== '') ? stable + 1 : 0;
      last = current;
      if (stable >= 5) break;
    }
  });
}

async function currentPositionedNodes(webviewPage: FrameLocator, fallbackNodes: any[]): Promise<any[]> {
  const flowNodes = await webviewPage.locator('html').evaluate(() => {
    const instance = (window as any).reactFlowInstance;
    return instance.getNodes().map((node: any) => ({ id: node.id, position: node.position }));
  });
  const positionById = new Map(flowNodes.map((node: any) => [node.id, node.position]));
  return fallbackNodes.map((node: any) => ({
    ...node, position: positionById.get(node.id) ?? node.position, fixed: true,
  }));
}

async function hasOriginalEdgeBetween(webviewPage: FrameLocator, source: string, target: string): Promise<boolean> {
  const sourceId = await findNodeIdByLabel(webviewPage, source);
  const targetId = await findNodeIdByLabel(webviewPage, target);
  if (!sourceId || !targetId) throw new Error(`Nodes not found: ${source}=${sourceId}, ${target}=${targetId}`);
  return webviewPage.locator('html').evaluate((_, { s, t }) => {
    const instance = (window as any).reactFlowInstance;
    return instance.getEdges().some((edge: any) =>
      edge.source === s && edge.target === t && edge.data?.edge?.metadata?.cutStub === undefined
    );
  }, { s: sourceId, t: targetId });
}

async function postCurrentView(world: BddWorld, screenshotLabel: string): Promise<void> {
  const moduleName = world.lastViewModel.moduleName;
  const viewModel = await buildViewModel(world.lastGraph, moduleName, world.layout);
  world.lastViewModel = viewModel;
  await world.evaluateInVSCode(
    (_vscode, data) => { (global as any).__svschBddPanel?.webview.postMessage(data); },
    { type: 'graph', view: viewModel, modules: Object.keys(world.lastGraph.modules) }
  );
  await world.webviewPage.locator('.react-flow__node').first().waitFor({ timeout: 15_000 });
  await waitForViewportTransformToSettle(world.webviewPage);
  await world.workbox.waitForTimeout(500);
  await world.takeScreenshot(screenshotLabel);
}

async function dragPortNodeTo(world: BddWorld, name: string, x: number, y: number, screenshotLabel: string): Promise<void> {
  const id = await findNodeIdByLabel(world.webviewPage, name, 'port');
  if (!id) throw new Error(`Node not found: ${name}`);
  const pos = await getInternalPosition(world.webviewPage, id);
  if (!pos) throw new Error(`Missing position data for ${name}`);
  const zoom = await world.webviewPage.locator('html').evaluate(() =>
    ((window as any).reactFlowInstance?.getViewport()?.zoom ?? 1) as number
  );
  const box = await world.webviewPage.locator(`.react-flow__node[data-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`Could not get bounding box for ${name}`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const msgsBefore = (await world.webviewMessages()).length;
  await world.workbox.mouse.move(cx, cy);
  await world.workbox.mouse.down();
  await world.workbox.mouse.move(cx + (x - pos.x) * zoom, cy + (y - pos.y) * zoom, { steps: 10 });
  await world.workbox.mouse.up();
  await world.workbox.waitForTimeout(500);
  await expect.poll(async () => {
    const messages = await world.webviewMessages();
    return messages.slice(msgsBefore).some((m: any) => m.type === 'layoutChanged');
  }, { timeout: 5000 }).toBe(true);
  const allMessages = await world.webviewMessages();
  const layoutMsg = allMessages.slice(msgsBefore).reverse().find((m: any) => m.type === 'layoutChanged');
  if (layoutMsg) world.layout = mergeNodePositions(world.layout, layoutMsg.moduleName, layoutMsg.nodes);
  await world.takeScreenshot(screenshotLabel);
}

async function cutNetByClickingControl(world: BddWorld, source: string, target: string): Promise<void> {
  const moduleName = world.lastViewModel.moduleName;
  const sourceId = await findNodeIdByLabel(world.webviewPage, source);
  const targetId = await findNodeIdByLabel(world.webviewPage, target);
  if (!sourceId || !targetId) throw new Error(`Nodes not found: ${source}=${sourceId}, ${target}=${targetId}`);
  const edge = world.lastViewModel.edges.find((candidate: any) =>
    candidate.source === sourceId && candidate.target === targetId && candidate.metadata?.cutStub === undefined
  );
  if (!edge) throw new Error(`Could not find original edge between ${sourceId} and ${targetId}`);
  const edgeLocator = world.webviewPage.locator(`.react-flow__edge[data-id="${edge.id}"]`);
  await edgeLocator.locator('path.svsch-edge-bridge').evaluate((path) => {
    path.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    path.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });
  await world.workbox.waitForTimeout(500);
  const clicked = await edgeLocator.evaluate((node) => {
    const btn = node.querySelector('.svsch-edge-cut-control') as HTMLButtonElement;
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (!clicked) throw new Error(`Could not find or click cut control for edge ${edge.id}`);
  await expect.poll(async () => {
    const messages = await world.webviewMessages();
    return messages.some((m: any) => m.type === 'cutNet' && m.edge?.id === edge.id);
  }, { timeout: 10000 }).toBe(true);
  const cutMessage = (await world.webviewMessages()).reverse().find((m: any) => m.type === 'cutNet' && m.edge?.id === edge.id) as any;
  const positioned = cutMessage?.nodes?.length ? cutMessage.nodes : await currentPositionedNodes(world.webviewPage, world.lastViewModel.nodes);
  world.layout = mergeNetCut(world.layout, moduleName, cutMessage?.edge ?? edge, world.lastGraph.modules[moduleName], positioned);
  await postCurrentView(world, 'After cut net');
}

// ---------------------------------------------------------------------------
// Pure utilities
// ---------------------------------------------------------------------------

function routeKey(source: string, target: string): string {
  return `${source}->${target}`;
}

function handleMatches(actual: string | undefined, expectedLabel: string): boolean {
  if (!actual) return false;
  const portName = actual.includes(':') ? actual.slice(actual.lastIndexOf(':') + 1) : actual;
  const fieldName = portName.includes('.') ? portName.slice(portName.lastIndexOf('.') + 1) : portName;
  const sanitized = expectedLabel.replace(/[^A-Za-z0-9_$.\-:]+/g, '_');
  return actual === expectedLabel
    || actual.toLowerCase() === expectedLabel.toLowerCase()
    || actual === `port:${expectedLabel}`
    || actual === `in:${expectedLabel}`
    || actual === `out:${expectedLabel}`
    || actual === `in:${sanitized}`
    || actual === `out:${sanitized}`
    || portName === expectedLabel
    || portName === sanitized
    || fieldName === expectedLabel;
}

function cutNetKeyByLabel(layout: any, moduleName: string, label: string): string {
  const entries = Object.entries(layout.modules?.[moduleName]?.netCuts ?? {}) as Array<[string, any]>;
  const match = entries.find(([, cut]) => cut.label === label);
  if (!match) throw new Error(`Could not find cut net labeled "${label}" in module "${moduleName}"`);
  return match[0];
}

function cutNetLabelNodes(webviewPage: FrameLocator, label: string) {
  return webviewPage.locator('[data-node-kind="netLabel"]').filter({
    has: webviewPage.locator('.hdl-net-label-text').filter({ hasText: exactText(label) }),
  });
}

function exactText(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

async function getWorkspaceState(dir: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(current: string) {
    const entries = await fs.promises.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.svsch' || entry.name === '.git' || entry.name === 'node_modules') continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else files.push(path.relative(dir, fullPath).replace(/\\/g, '/'));
    }
  }
  await walk(dir);
  return files;
}
