import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveSignalSource } from './core';
import { logger } from './logger';
import type { DesignGraph, DiagramViewModel, PositionedGenerateRegion, PositionedNode, SourceRange, DiagramEdge } from './ir/types';
import { buildViewModel, mergeEdgeRoutePoints, mergeEdgeWaypoint, mergeNetCut, mergeNetCuts, mergeNodePositions, mergeRegionBounds, mergeRelayoutSelection, mergeRerouteEdges, mergeRerouteLayout, mergeRerouteSingleEdge, removeNetCut, renameCutNet, resetCutLabelPosition, revertCutNetLabel } from './layout/mergeLayout';
import { LayoutStore, type SavedLayout } from './storage/layoutStore';
import { renderSvg } from './cli/svgRenderer';
import { minifySvg } from './cli/svgMinify';
import { generateArmSpan } from './diagram/generateArmSpan';
import { ElaborationService, isListOnlyPlaceholder, type Disposable } from './elaborationService';

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'layoutChanged'; moduleName: string; nodes: PositionedNode[]; regions?: PositionedGenerateRegion[] }
  | { type: 'regionLayoutChanged'; moduleName: string; regions: PositionedGenerateRegion[] }
  | { type: 'edgeLayoutChanged'; moduleName: string; edgeId: string; waypoint: { x: number; y: number } }
  | { type: 'edgeRouteChanged'; moduleName: string; edgeId: string; routePoints: Array<{ x: number; y: number }> }
  | { type: 'edgeRoutesChanged'; moduleName: string; changes: Array<{ edgeId: string; routePoints: Array<{ x: number; y: number }> }>; nodes?: PositionedNode[] }
  | { type: 'openModule'; moduleName: string }
  | { type: 'resetLayout'; moduleName: string }
  | { type: 'rerouteLayout'; moduleName: string; nodes: PositionedNode[] }
  | { type: 'rerouteEdge'; moduleName: string; edgeId: string; nodes: PositionedNode[] }
  | { type: 'rerouteEdges'; moduleName: string; edgeIds: string[]; nodes: PositionedNode[] }
  | { type: 'cutNet'; moduleName: string; edge: DiagramEdge; nodes: PositionedNode[] }
  | { type: 'cutNets'; moduleName: string; edges: DiagramEdge[]; nodes: PositionedNode[] }
  | { type: 'relayoutSelection'; moduleName: string; nodeIds: string[]; nodes: PositionedNode[] }
  | { type: 'renameCutNet'; moduleName: string; netKey: string; label: string }
  | { type: 'revertCutNetLabel'; moduleName: string; netKey: string }
  | { type: 'tieNet'; moduleName: string; netKey: string }
  | { type: 'resetCutLabelPosition'; moduleName: string; nodeId: string }
  | { type: 'navigateToSource'; source: SourceRange }
  | { type: 'navigateToRegion'; region: { kind: string; isGenerateBlock?: boolean; source?: SourceRange; bodySource?: SourceRange } }
  | { type: 'navigateToSignal'; edge: DiagramEdge }
  | { type: 'exportSvg' };

export class DiagramPanel {
  private panel?: vscode.WebviewPanel;
  private readonly elaborationInvalidationDisposable: Disposable;
  private rebuildVersion = 0;
  private graph?: DesignGraph;
  private layout: SavedLayout = { version: 1, modules: {} };
  private currentModule?: string;
  private store?: LayoutStore;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly elaborationService: ElaborationService,
    private readonly onDispose: () => void
  ) {
    this.elaborationInvalidationDisposable = elaborationService.onDidInvalidate((live) => {
      if (this.panel && workspaceRootPath()) {
        void this.consumeGraph(elaborationService.getGraph(live));
      }
    });
  }

  private getStore(): LayoutStore | undefined {
    if (this.store) {
      return this.store;
    }
    const root = workspaceRootPath();
    if (!root) {
      return undefined;
    }
    this.store = new LayoutStore(root);
    return this.store;
  }

  /** Loads a module's layout into the in-memory cache if it isn't already there. */
  private async ensureModuleLayout(store: LayoutStore, moduleName: string): Promise<void> {
    if (this.layout.modules[moduleName]) {
      return;
    }
    const moduleLayout = await store.readModuleLayout(moduleName);
    this.layout = {
      version: 1,
      modules: { ...this.layout.modules, [moduleName]: moduleLayout }
    };
  }

  /** Persists only the given module's layout — every other module's file is untouched. */
  private async persistModuleLayout(store: LayoutStore, moduleName: string): Promise<void> {
    const moduleLayout = this.layout.modules[moduleName] ?? { nodes: {} };
    await store.writeModuleLayout(moduleName, moduleLayout);
  }

  async open(): Promise<void> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
    } else {
      this.panel = vscode.window.createWebviewPanel('svsch.diagram', 'SVSCH Diagram', vscode.ViewColumn.Beside, {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
      });
      this.panel.webview.html = this.html(this.panel.webview);
      this.panel.webview.onDidReceiveMessage((message: WebviewMessage) => this.handleMessage(message), undefined, this.context.subscriptions);
      this.panel.onDidDispose(() => this.dispose(), undefined, this.context.subscriptions);
    }

    if (!workspaceRootPath()) {
      vscode.window.showWarningMessage('SVSCH requires an open workspace folder.');
      return;
    }
    await this.consumeGraph(this.elaborationService.getGraph());
  }

  async rebuild(live = false): Promise<void> {
    if (!workspaceRootPath()) {
      vscode.window.showWarningMessage('SVSCH requires an open workspace folder.');
      return;
    }
    if (!this.panel) {
      return;
    }
    await this.elaborationService.refresh(live).catch(() => undefined);
  }

  private async consumeGraph(graphPromise: Promise<DesignGraph>): Promise<void> {
    const version = ++this.rebuildVersion;
    await this.postStatus('rebuilding');

    try {
      const graph = await graphPromise;
      if (version !== this.rebuildVersion) {
        return;
      }
      this.graph = graph;

      this.currentModule = this.currentModule && this.graph.modules[this.currentModule]
        ? this.currentModule
        : this.graph.rootModules[0] ?? Object.keys(this.graph.modules)[0] ?? '';

      const currentModule = this.currentModule ? this.graph.modules[this.currentModule] : undefined;
      if (this.currentModule && currentModule && isListOnlyPlaceholder(currentModule)) {
        await this.loadModule(this.currentModule, version);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Rebuild failed: ${message}`, error);
      if (version === this.rebuildVersion) {
        await this.postStatus('idle');
      }
      return;
    }

    if (version !== this.rebuildVersion) {
      return;
    }
    await this.postView();
    await this.postStatus('idle');
  }

  async loadModule(moduleName: string, version = this.rebuildVersion): Promise<void> {
    if (!this.graph) return;

    await this.postStatus('rebuilding');
    const graph = await this.elaborationService.getModule(moduleName);
    if (version !== this.rebuildVersion) {
      return;
    }
    this.graph = graph;
    await this.postStatus('idle');
  }

  async resetLayoutForCurrentModule(): Promise<void> {
    if (!this.currentModule) {
      return;
    }
    const store = this.getStore();
    if (!store) {
      return;
    }
    await store.resetModuleLayout(this.currentModule);
    const { [this.currentModule]: _removed, ...remainingModules } = this.layout.modules;
    this.layout = { version: 1, modules: remainingModules };
    await this.postView();
  }

  dispose(): void {
    this.elaborationInvalidationDisposable.dispose();
    this.panel = undefined;
    this.onDispose();
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    if (message.type === 'ready') {
      await this.postView();
      return;
    }
    if (message.type === 'openModule') {
      if (this.graph?.modules[message.moduleName]) {
        this.currentModule = message.moduleName;
        const module = this.graph.modules[message.moduleName];
        if (isListOnlyPlaceholder(module)) {
          await this.loadModule(message.moduleName);
        }
        await this.postView();
      }
      return;
    }
    if (message.type === 'resetLayout') {
      this.currentModule = message.moduleName;
      await this.resetLayoutForCurrentModule();
      return;
    }
    if (message.type === 'rerouteLayout') {
      this.currentModule = message.moduleName;
      await this.rerouteCurrentModule(message.moduleName, message.nodes);
      return;
    }
    if (message.type === 'rerouteEdge') {
      this.currentModule = message.moduleName;
      await this.rerouteSingleEdge(message.moduleName, message.edgeId, message.nodes);
      return;
    }
    if (message.type === 'rerouteEdges') {
      this.currentModule = message.moduleName;
      await this.rerouteSelectedEdges(message.moduleName, message.edgeIds, message.nodes);
      return;
    }
    if (message.type === 'relayoutSelection') {
      this.currentModule = message.moduleName;
      await this.relayoutSelection(message.moduleName, message.nodeIds, message.nodes);
      return;
    }
    if (message.type === 'layoutChanged') {
      await this.saveLayout(message.moduleName, message.nodes, message.regions);
      return;
    }
    if (message.type === 'regionLayoutChanged') {
      await this.saveRegionLayout(message.moduleName, message.regions);
      return;
    }
    if (message.type === 'edgeLayoutChanged') {
      await this.saveEdgeLayout(message.moduleName, message.edgeId, message.waypoint);
      return;
    }
    if (message.type === 'edgeRouteChanged') {
      await this.saveEdgeRoute(message.moduleName, message.edgeId, message.routePoints);
      return;
    }
    if (message.type === 'edgeRoutesChanged') {
      await this.saveEdgeRoutes(message.moduleName, message.changes, message.nodes);
      return;
    }
    if (message.type === 'cutNet') {
      await this.saveNetCut(message.moduleName, message.edge, message.nodes);
      return;
    }
    if (message.type === 'cutNets') {
      await this.saveNetCuts(message.moduleName, message.edges, message.nodes);
      return;
    }
    if (message.type === 'renameCutNet') {
      await this.renameNetCut(message.moduleName, message.netKey, message.label);
      return;
    }
    if (message.type === 'revertCutNetLabel') {
      await this.revertNetCutLabel(message.moduleName, message.netKey);
      return;
    }
    if (message.type === 'tieNet') {
      await this.tieNet(message.moduleName, message.netKey);
      return;
    }
    if (message.type === 'resetCutLabelPosition') {
      await this.resetCutLabelPosition(message.moduleName, message.nodeId);
      return;
    }
    if (message.type === 'navigateToSource') {
      await this.navigateToSource(message.source);
      return;
    }
    if (message.type === 'navigateToRegion') {
      await this.navigateToRegion(message.region);
      return;
    }
    if (message.type === 'navigateToSignal') {
      await this.navigateToSignal(message.edge);
      return;
    }
    if (message.type === 'exportSvg') {
      await this.exportSvg();
      return;
    }
  }

  private async exportSvg(): Promise<void> {
    try {
      if (!this.graph || this.currentModule === undefined) {
        return;
      }
      const store = this.getStore();
      if (store) {
        await this.ensureModuleLayout(store, this.currentModule);
      }

      let reactFlowCss = '';
      try {
        const paths = [
          path.join(this.context.extensionUri.fsPath, 'node_modules', '@xyflow', 'react', 'dist', 'style.css'),
          path.join(this.context.extensionUri.fsPath, '..', 'node_modules', '@xyflow', 'react', 'dist', 'style.css'),
          path.join(this.context.extensionUri.fsPath, '..', '..', 'node_modules', '@xyflow', 'react', 'dist', 'style.css')
        ];
        for (const p of paths) {
          if (fs.existsSync(p)) {
            reactFlowCss = fs.readFileSync(p, 'utf8');
            break;
          }
        }
      } catch (err) {
        logger.log(`Warning: Could not load React Flow CSS for export: ${err}`);
      }

      let extensionCss = '';
      try {
        const p = path.join(this.context.extensionUri.fsPath, 'media', 'webview.css');
        if (fs.existsSync(p)) {
          extensionCss = fs.readFileSync(p, 'utf8');
        }
      } catch (err) {
        logger.log(`Warning: Could not load extension CSS for export: ${err}`);
      }

      const viewModel = await buildViewModel(this.graph, this.currentModule, this.layout);
      let svg = renderSvg(viewModel, {
        theme: vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light ? 'light' : 'dark',
        reactFlowCss,
        extensionCss
      });
      if (vscode.workspace.getConfiguration('svsch').get<boolean>('minifySvg', true)) {
        svg = await minifySvg(svg);
      }

      const defaultUri = vscode.Uri.file(path.join(workspaceRootPath() ?? '.', `${this.currentModule.replace(/[^a-z0-9]/gi, '_')}.svg`));
      
      // In tests, we bypass the dialog to avoid hanging
      if (process.env.SVSCH_TEST) {
        fs.writeFileSync(defaultUri.fsPath, svg);
        return;
      }

      const uri = await vscode.window.showSaveDialog({
        defaultUri,
        filters: { 'SVG': ['svg'] },
        title: 'Export Diagram as SVG'
      });

      if (uri) {
        fs.writeFileSync(uri.fsPath, svg);
        vscode.window.showInformationMessage(`Diagram exported to ${path.basename(uri.fsPath)}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.log(`Error exporting SVG: ${msg}`);
      vscode.window.showErrorMessage(`Failed to export SVG: ${msg}`);
    }
  }

  private async navigateToSource(source: SourceRange): Promise<void> {
    const opened = await this.openSourceDocument(source);
    if (!opened) {
      return;
    }
    const { document } = opened;
    const startLine = Math.max(0, (source.startLine || 1) - 1);
    const endLine = Math.max(0, (source.endLine || source.startLine || 1) - 1);
    const range = new vscode.Range(
      startLine,
      source.startColumn ?? 0,
      endLine,
      source.endColumn ?? document.lineAt(endLine).text.length
    );
    await this.revealDocumentRange(document, range);
  }

  private async openSourceDocument(source: SourceRange): Promise<{ document: vscode.TextDocument } | undefined> {
    const workspaceRoot = workspaceRootPath();
    if (!workspaceRoot || !source.file) {
      return undefined;
    }
    const uri = vscode.Uri.file(vscode.Uri.joinPath(vscode.Uri.file(workspaceRoot), source.file).fsPath);
    const document = await vscode.workspace.openTextDocument(uri);
    return { document };
  }

  private async revealDocumentRange(document: vscode.TextDocument, range: vscode.Range): Promise<void> {
    // Find if the document is already open in any tab group
    const tab = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .find((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === document.uri.toString());

    await vscode.window.showTextDocument(document, {
      viewColumn: tab?.group.viewColumn ?? vscode.ViewColumn.Active,
      selection: range
    });
  }

  // Double-click on a generate region. The wrapper block's source already spans the
  // whole generate statement; an arm's UHDM ranges only give its expression and a
  // point inside its body, so the arm's begin..end block is recovered from the
  // document text to highlight the full "expression + body".
  private async navigateToRegion(region: { kind: string; isGenerateBlock?: boolean; source?: SourceRange; bodySource?: SourceRange }): Promise<void> {
    const source = region.source ?? region.bodySource;
    if (!source?.file) {
      return;
    }
    if (region.isGenerateBlock || !region.bodySource) {
      await this.navigateToSource(source);
      return;
    }
    const opened = await this.openSourceDocument(source);
    if (!opened) {
      return;
    }
    const { document } = opened;
    const range = generateArmHighlightRange(document, region.kind, source, region.bodySource);
    if (!range) {
      await this.navigateToSource(source);
      return;
    }
    await this.revealDocumentRange(document, range);
  }

  private async navigateToSignal(edge: DiagramEdge): Promise<void> {
    if (!this.currentModule || !this.graph) {
      return;
    }

    const source = resolveSignalSource(this.graph, this.currentModule, edge);
    if (source) {
      await this.navigateToSource(source);
      return;
    }

    vscode.window.showWarningMessage('This is an internal wire.');
  }

  private async saveLayout(moduleName: string, nodes: PositionedNode[], regions?: PositionedGenerateRegion[]): Promise<void> {
    const store = this.getStore();
    if (!store) {
      return;
    }
    await this.ensureModuleLayout(store, moduleName);
    this.layout = mergeNodePositions(this.layout, moduleName, nodes);
    if (regions) {
      this.layout = mergeRegionBounds(this.layout, moduleName, regions);
    }
    await this.persistModuleLayout(store, moduleName);
  }

  private async saveRegionLayout(moduleName: string, regions: PositionedGenerateRegion[]): Promise<void> {
    const store = this.getStore();
    if (!store) {
      return;
    }
    await this.ensureModuleLayout(store, moduleName);
    this.layout = mergeRegionBounds(this.layout, moduleName, regions);
    await this.persistModuleLayout(store, moduleName);
  }

  private async rerouteCurrentModule(moduleName: string, nodes: PositionedNode[]): Promise<void> {
    const store = this.getStore();
    if (!store) {
      return;
    }
    await this.ensureModuleLayout(store, moduleName);
    this.layout = mergeRerouteLayout(this.layout, moduleName, nodes);
    await this.persistModuleLayout(store, moduleName);
    await this.postView();
  }

  private async rerouteSingleEdge(moduleName: string, edgeId: string, nodes: PositionedNode[]): Promise<void> {
    const store = this.getStore();
    if (!store) {
      return;
    }
    await this.ensureModuleLayout(store, moduleName);
    this.layout = mergeRerouteSingleEdge(this.layout, moduleName, edgeId, nodes);
    await this.persistModuleLayout(store, moduleName);
    await this.postView();
  }

  private async rerouteSelectedEdges(moduleName: string, edgeIds: string[], nodes: PositionedNode[]): Promise<void> {
    const store = this.getStore();
    if (!store) {
      return;
    }
    await this.ensureModuleLayout(store, moduleName);
    this.layout = mergeRerouteEdges(this.layout, moduleName, edgeIds, nodes);
    await this.persistModuleLayout(store, moduleName);
    await this.postView();
  }

  private async relayoutSelection(moduleName: string, nodeIds: string[], nodes: PositionedNode[]): Promise<void> {
    const store = this.getStore();
    const designModule = this.graph?.modules[moduleName];
    if (!store || !designModule || !this.graph) {
      return;
    }
    await this.ensureModuleLayout(store, moduleName);
    this.currentModule = moduleName;

    const selected = new Set(nodeIds);
    const originalCentroid = centroidOfPositions(nodes.filter((node) => selected.has(node.id)));

    this.layout = mergeRelayoutSelection(this.layout, moduleName, nodeIds, nodes, designModule);

    if (originalCentroid) {
      // ELK's layered algorithm doesn't reliably keep a released group near where
      // it started — if the group is only wired to other released nodes (not to
      // anything still fixed), ELK treats it as its own connected component and
      // packs components independently, which can drop the whole group far from
      // the original selection. Run the layout once to see where ELK placed it,
      // then rigidly translate the group so its centroid lands back on the
      // original selection's centroid, and commit that as the new fixed
      // position — the same as if the user had dragged it there by hand.
      const relaidView = await buildViewModel(this.graph, moduleName, this.layout);
      const relaidCentroid = centroidOfPositions(relaidView.nodes.filter((node) => selected.has(node.id)));
      if (relaidCentroid) {
        const dx = originalCentroid.x - relaidCentroid.x;
        const dy = originalCentroid.y - relaidCentroid.y;
        const anchoredNodes = relaidView.nodes
          .filter((node) => selected.has(node.id))
          .map((node) => ({
            ...node,
            position: { x: node.position.x + dx, y: node.position.y + dy },
            fixed: true
          }));
        this.layout = mergeNodePositions(this.layout, moduleName, anchoredNodes);
      }
    }

    await this.persistModuleLayout(store, moduleName);
    await this.postView();
  }

  private async saveEdgeLayout(moduleName: string, edgeId: string, waypoint: { x: number; y: number }): Promise<void> {
    const store = this.getStore();
    if (!store) {
      return;
    }
    await this.ensureModuleLayout(store, moduleName);
    this.layout = mergeEdgeWaypoint(this.layout, moduleName, edgeId, waypoint);
    await this.persistModuleLayout(store, moduleName);
  }

  private async saveEdgeRoute(moduleName: string, edgeId: string, routePoints: Array<{ x: number; y: number }>): Promise<void> {
    const store = this.getStore();
    if (!store) {
      return;
    }
    await this.ensureModuleLayout(store, moduleName);
    this.layout = mergeEdgeRoutePoints(this.layout, moduleName, edgeId, routePoints);
    await this.persistModuleLayout(store, moduleName);
    await this.postView(); // Send updated view back to webview immediately
  }

  private async saveEdgeRoutes(
    moduleName: string,
    changes: Array<{ edgeId: string; routePoints: Array<{ x: number; y: number }> }>,
    nodes?: PositionedNode[]
  ): Promise<void> {
    const store = this.getStore();
    if (!store) {
      return;
    }
    await this.ensureModuleLayout(store, moduleName);
    let layout = nodes ? mergeNodePositions(this.layout, moduleName, nodes) : this.layout;
    for (const change of changes) {
      layout = mergeEdgeRoutePoints(layout, moduleName, change.edgeId, change.routePoints);
    }
    this.layout = layout;
    await this.persistModuleLayout(store, moduleName);
    await this.postView();
  }

  private async saveNetCut(moduleName: string, edge: DiagramEdge, nodes: PositionedNode[]): Promise<void> {
    const store = this.getStore();
    const designModule = this.graph?.modules[moduleName];
    if (!store || !designModule) {
      return;
    }
    await this.ensureModuleLayout(store, moduleName);
    this.currentModule = moduleName;
    this.layout = mergeNetCut(this.layout, moduleName, edge, designModule, nodes);
    await this.persistModuleLayout(store, moduleName);
    await this.postView();
  }

  private async saveNetCuts(moduleName: string, edges: DiagramEdge[], nodes: PositionedNode[]): Promise<void> {
    const store = this.getStore();
    const designModule = this.graph?.modules[moduleName];
    if (!store || !designModule) {
      return;
    }
    await this.ensureModuleLayout(store, moduleName);
    this.currentModule = moduleName;
    this.layout = mergeNetCuts(this.layout, moduleName, edges, designModule, nodes);
    await this.persistModuleLayout(store, moduleName);
    await this.postView();
  }

  private async renameNetCut(moduleName: string, netKey: string, label: string): Promise<void> {
    const store = this.getStore();
    if (!store) {
      return;
    }
    await this.ensureModuleLayout(store, moduleName);
    this.currentModule = moduleName;
    this.layout = renameCutNet(this.layout, moduleName, netKey, label);
    await this.persistModuleLayout(store, moduleName);
    await this.postView();
  }

  private async revertNetCutLabel(moduleName: string, netKey: string): Promise<void> {
    const store = this.getStore();
    if (!store) {
      return;
    }
    await this.ensureModuleLayout(store, moduleName);
    this.currentModule = moduleName;
    this.layout = revertCutNetLabel(this.layout, moduleName, netKey);
    await this.persistModuleLayout(store, moduleName);
    await this.postView();
  }

  private async tieNet(moduleName: string, netKey: string): Promise<void> {
    const store = this.getStore();
    if (!store) {
      return;
    }
    await this.ensureModuleLayout(store, moduleName);
    this.currentModule = moduleName;
    this.layout = removeNetCut(this.layout, moduleName, netKey);
    await this.persistModuleLayout(store, moduleName);
    await this.postView();
  }

  private async resetCutLabelPosition(moduleName: string, nodeId: string): Promise<void> {
    const store = this.getStore();
    if (!store) {
      return;
    }
    await this.ensureModuleLayout(store, moduleName);
    this.currentModule = moduleName;
    this.layout = resetCutLabelPosition(this.layout, moduleName, nodeId);
    await this.persistModuleLayout(store, moduleName);
    await this.postView();
  }

  private async postView(): Promise<void> {
    if (!this.panel || !this.graph || this.currentModule === undefined) {
      return;
    }
    const store = this.getStore();
    if (store) {
      await this.ensureModuleLayout(store, this.currentModule);
    }
    const view: DiagramViewModel = await buildViewModel(this.graph, this.currentModule, this.layout);
    await this.panel.webview.postMessage({
      type: 'graph',
      view,
      modules: Object.keys(this.graph.modules)
    });
  }

  private async postStatus(status: 'idle' | 'rebuilding'): Promise<void> {
    await this.panel?.webview.postMessage({
      type: 'status',
      status
    });
  }

  private html(webview: vscode.Webview): string {
    const scriptUri = this.webviewMediaUri(webview, 'webview.js');
    const styleUri = this.webviewMediaUri(webview, 'webview.css');
    logger.log(`Webview URIs: script=${scriptUri.toString()}, style=${styleUri.toString()}`);
    const nonce = String(Date.now());
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src ${webview.cspSource} https:; font-src ${webview.cspSource}; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${webview.cspSource};">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>SVSCH Diagram</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private webviewMediaUri(webview: vscode.Webview, fileName: string): vscode.Uri {
    const mediaUri = vscode.Uri.joinPath(this.context.extensionUri, 'media', fileName);
    let version = 'dev';
    try {
      version = String(Math.round(fs.statSync(mediaUri.fsPath).mtimeMs)) + '-' + String(Date.now());
    } catch {
      // Keep serving the stable URI if the asset is missing; the webview will
      // surface the load failure and the caller can rebuild media.
    }
    return webview.asWebviewUri(mediaUri).with({ query: `v=${version}` });
  }
}

function workspaceRootPath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function centroidOfPositions(nodes: Array<{ position: { x: number; y: number } }>): { x: number; y: number } | undefined {
  if (nodes.length === 0) {
    return undefined;
  }
  const sum = nodes.reduce((acc, node) => ({ x: acc.x + node.position.x, y: acc.y + node.position.y }), { x: 0, y: 0 });
  return { x: sum.x / nodes.length, y: sum.y / nodes.length };
}

function generateArmHighlightRange(
  document: vscode.TextDocument,
  kind: string,
  source: SourceRange,
  bodySource: SourceRange
): vscode.Range | undefined {
  const span = generateArmSpan(document.getText(), kind, source, bodySource);
  if (!span) return undefined;
  return new vscode.Range(document.positionAt(span.start), document.positionAt(span.end));
}
