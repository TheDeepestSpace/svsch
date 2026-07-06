import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildDesignGraph } from './parser/backend';
import { logger } from './logger';
import type { DesignGraph, DiagramViewModel, PositionedGenerateRegion, PositionedNode, SourceRange, DiagramEdge } from './ir/types';
import { buildViewModel, mergeEdgeRoutePoints, mergeEdgeWaypoint, mergeNetCut, mergeNodePositions, mergeRegionBounds, mergeRerouteLayout, mergeRerouteSingleEdge, removeNetCut, renameCutNet } from './layout/mergeLayout';
import { LayoutStore, type SavedLayout } from './storage/layoutStore';
import { renderSvg } from './cli/svgRenderer';
import { generateArmSpan } from './diagram/generateArmSpan';

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
  | { type: 'cutNet'; moduleName: string; edge: DiagramEdge; nodes: PositionedNode[] }
  | { type: 'renameCutNet'; moduleName: string; netKey: string; label: string }
  | { type: 'tieNet'; moduleName: string; netKey: string }
  | { type: 'navigateToSource'; source: SourceRange }
  | { type: 'navigateToRegion'; region: { kind: string; isGenerateBlock?: boolean; source?: SourceRange; bodySource?: SourceRange } }
  | { type: 'navigateToSignal'; edge: DiagramEdge }
  | { type: 'exportSvg' };

export class DiagramPanel {
  private panel?: vscode.WebviewPanel;
  private watcher?: vscode.FileSystemWatcher;
  private documentChangeDisposable?: vscode.Disposable;
  private rebuildTimer?: NodeJS.Timeout;
  private rebuildVersion = 0;
  private graph?: DesignGraph;
  private layout?: SavedLayout;
  private currentModule?: string;
  private lastSurelogPath?: string;
  private lastBackendPath?: string;
  private store?: LayoutStore;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onDispose: () => void
  ) { }

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

    this.ensureWatcher();
    
    // Initialize layout from store
    const store = this.getStore();
    if (store) {
        this.layout = await store.read();
    }

    await this.rebuild();
  }

  async rebuild(live = false): Promise<void> {
    const version = ++this.rebuildVersion;
    const workspaceRoot = workspaceRootPath();
    if (!workspaceRoot) {
      vscode.window.showWarningMessage('SVSCH requires an open workspace folder.');
      return;
    }
    await this.postStatus('rebuilding');

    const config = vscode.workspace.getConfiguration('svsch');
    const projectFolder = config.get<string>('projectFolder') || '.';
    const veriblePath = config.get<string>('veriblePath') || 'verible-verilog-syntax';
    const includePaths = config.get<string[]>('includePaths') || [];
    const defines = config.get<Record<string, string>>('defines') || {};
    // Prefer a user-configured surelog path, otherwise prefer a packaged copy inside the
    // extension at `dist/surelog/bin/surelog` if present, otherwise fall back to `surelog`.
    const configSurelog = config.get<string>('surelogPath');
    const packagedSurelog = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'surelog', 'bin', 'surelog').fsPath;

    logger.log(`Checking for packaged surelog at: ${packagedSurelog}`);
    const existsPackaged = fs.existsSync(packagedSurelog);
    logger.log(`Packaged surelog exists check: ${existsPackaged}`);

    let surelogPath = 'surelog';
    if (configSurelog && configSurelog !== 'surelog') {
      surelogPath = configSurelog;
      logger.log(`Using user-configured surelogPath: ${surelogPath}`);
    } else if (existsPackaged) {
      if (process.platform === 'linux' && process.arch !== 'x64') {
        logger.warn(`Packaged surelog is x64, but system is ${process.arch}. Falling back to system 'surelog'.`);
      } else {
        surelogPath = packagedSurelog;
        logger.log(`Using packaged surelog (absolute): ${surelogPath}`);
      }
    }
 else {
      // Search up from workspaceRoot to find the project root (where dist/ is likely to be)
      let currentDir = workspaceRoot;
      let found = false;
      while (currentDir !== path.dirname(currentDir)) {
        const candidate = path.join(currentDir, 'dist', 'surelog', 'bin', 'surelog');
        if (fs.existsSync(candidate)) {
          surelogPath = candidate;
          logger.log(`Found packaged surelog at project root: ${surelogPath}`);
          found = true;
          break;
        }
        currentDir = path.dirname(currentDir);
      }

      if (!found) {
        logger.log(`Falling back to system 'surelog' (not found in extension dist or project dist)`);
      }
    }

    // Resolve backend binary path
    const packagedBackend = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'svsch_backend').fsPath;
    let backendPath = packagedBackend;

    logger.log(`Checking for backend at: ${backendPath}`);
    if (!fs.existsSync(backendPath)) {
      logger.log(`Backend not found at extensionUri, searching in project root...`);
      let currentDir = workspaceRoot;
      let found = false;
      while (currentDir !== path.dirname(currentDir)) {
        const candidate = path.join(currentDir, 'dist', 'svsch_backend');
        if (fs.existsSync(candidate)) {
          backendPath = candidate;
          logger.log(`Found backend at project root: ${backendPath}`);
          found = true;
          break;
        }
        currentDir = path.dirname(currentDir);
      }
      if (!found) {
        logger.error(`Backend binary NOT FOUND! Tried ${packagedBackend} and project roots.`);
      }
    } else {
      logger.log(`Using backend (absolute): ${backendPath}`);
    }

    this.lastSurelogPath = surelogPath;
    this.lastBackendPath = backendPath;

    const store = this.getStore();
    if (store) {
      this.layout = await store.read();
    }

    const commonOptions = {
      workspaceRoot,
      projectFolder,
      backend: 'uhdm' as const,
      veriblePath,
      surelogPath,
      backendPath,
      includePaths,
      defines,
      overlays: live ? openHdlDocumentOverlays(workspaceRoot, projectFolder) : undefined,
      includeExternalDiagnostics: !live
    };

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: 'SVSCH',
      cancellable: false,
    }, async (progress) => {
      const onProgress = (message: string, increment: number) => {
        logger.log(`Progress: ${message} (${increment}%)`);
        progress.report({ message, increment });
      };

      try {
        this.graph = await buildDesignGraph({ ...commonOptions, onProgress });
      } catch (e: any) {
        if (e.message.includes('maxBuffer length exceeded')) {
          logger.warn('Full design too large for buffer, falling back to on-demand module loading.');
          this.graph = await buildDesignGraph({ ...commonOptions, listOnly: true, onProgress });
        } else {
          logger.error(`Rebuild failed: ${e.message}`);
          if (e.stack) {
            logger.error(e.stack);
          }
          throw e;
        }
      }
    });

    if (version !== this.rebuildVersion || !this.graph) {
      return;
    }

    this.currentModule = this.currentModule && this.graph.modules[this.currentModule]
      ? this.currentModule
      : this.graph.rootModules[0] ?? Object.keys(this.graph.modules)[0] ?? '';

    if (this.currentModule && (!this.graph.modules[this.currentModule] || !this.graph.modules[this.currentModule].nodes || this.graph.modules[this.currentModule].nodes.length <= (this.graph.modules[this.currentModule].ports.length || 0))) {
        // If the module has only port nodes (which are synthesized by transformToDesignGraph for empty modules)
        // or no nodes at all, it might be a list-only placeholder.
        // Actually, even a real empty module will have port nodes.
        // A better check: did we use list-only?
        if (this.graph.modules[this.currentModule] && !this.graph.modules[this.currentModule].file && !this.graph.modules[this.currentModule].nodes?.some(n => n.kind !== 'port')) {
            await this.loadModule(this.currentModule);
        }
    }

    await this.postView();
    await this.postStatus('idle');
  }

  async loadModule(moduleName: string): Promise<void> {
    if (!this.graph) return;
    const workspaceRoot = workspaceRootPath();
    if (!workspaceRoot) return;

    await this.postStatus('rebuilding');
    const config = vscode.workspace.getConfiguration('svsch');
    const projectFolder = config.get<string>('projectFolder') || '.';
    const veriblePath = config.get<string>('veriblePath') || 'verible-verilog-syntax';
    const includePaths = config.get<string[]>('includePaths') || [];
    const defines = config.get<Record<string, string>>('defines') || {};
    
    const surelogPath = this.lastSurelogPath || config.get<string>('surelogPath') || 'surelog';
    const backendPath = this.lastBackendPath || vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'svsch_backend').fsPath;

    const moduleGraph = await buildDesignGraph({
        workspaceRoot,
        projectFolder,
        backend: 'uhdm',
        veriblePath,
        surelogPath,
        backendPath,
        includePaths,
        defines,
        moduleName: moduleName,
        includeExternalDiagnostics: false
    });

    if (moduleGraph.modules[moduleName]) {
        this.graph.modules[moduleName] = moduleGraph.modules[moduleName];
        // Merge diagnostics
        this.graph.diagnostics.push(...moduleGraph.diagnostics);
    }
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
    const layout = this.layout ?? await store.read();
    delete layout.modules[this.currentModule];
    await store.write(layout);
    this.layout = layout;
    await this.postView();
  }

  dispose(): void {
    this.watcher?.dispose();
    this.documentChangeDisposable?.dispose();
    this.watcher = undefined;
    this.documentChangeDisposable = undefined;
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
        if (!module.file && !module.nodes?.some(n => n.kind !== 'port')) {
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
    if (message.type === 'renameCutNet') {
      await this.renameNetCut(message.moduleName, message.netKey, message.label);
      return;
    }
    if (message.type === 'tieNet') {
      await this.tieNet(message.moduleName, message.netKey);
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
      if (!this.graph || this.currentModule === undefined || !this.layout) {
        return;
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
      const svg = renderSvg(viewModel, {
        theme: vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Light ? 'light' : 'dark',
        reactFlowCss,
        extensionCss
      });

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
    if (!this.currentModule || !this.graph || !edge.signal) {
      return;
    }

    if (edge.sourceRange) {
      await this.navigateToSource(edge.sourceRange);
      return;
    }

    const module = this.graph.modules[this.currentModule];
    if (!module) return;

    // Try to find the signal declaration in ports, or register/computational nodes with a matching name.
    // However, if the user requested a signal that is declared as an internal wire not shown as a node with source, we could fall back to a search or just show warning.
    // For now, if the port exists we have its source.
    const port = module.ports.find((p) => p.name === edge.signal);
    if (port?.source) {
      await this.navigateToSource(port.source);
      return;
    }

    // Try finding an internal node representing this signal.
    const sourceNode = module.nodes.find((n) => n.label === edge.signal && (n.kind === 'register' || n.kind === 'comb' || n.kind === 'alu' || n.kind === 'inverter'));
    if (sourceNode?.source) {
      await this.navigateToSource(sourceNode.source);
      return;
    }

    vscode.window.showWarningMessage('This is an internal wire.');
  }

  private async saveLayout(moduleName: string, nodes: PositionedNode[], regions?: PositionedGenerateRegion[]): Promise<void> {
    const store = this.getStore();
    if (!store) {
      return;
    }
    if (!this.layout) {
      this.layout = await store.read();
    }
    this.layout = mergeNodePositions(this.layout, moduleName, nodes);
    if (regions) {
      this.layout = mergeRegionBounds(this.layout, moduleName, regions);
    }
    await store.write(this.layout);
  }

  private async saveRegionLayout(moduleName: string, regions: PositionedGenerateRegion[]): Promise<void> {
    const store = this.getStore();
    if (!store) {
      return;
    }
    if (!this.layout) {
      this.layout = await store.read();
    }
    this.layout = mergeRegionBounds(this.layout, moduleName, regions);
    await store.write(this.layout);
  }

  private async rerouteCurrentModule(moduleName: string, nodes: PositionedNode[]): Promise<void> {
    const workspaceRoot = workspaceRootPath();
    if (!workspaceRoot) {
      return;
    }
    const store = new LayoutStore(workspaceRoot);
    const base = await store.read();
    this.layout = mergeRerouteLayout(base, moduleName, nodes);
    await store.write(this.layout);
    await this.postView();
  }

  private async rerouteSingleEdge(moduleName: string, edgeId: string, nodes: PositionedNode[]): Promise<void> {
    const workspaceRoot = workspaceRootPath();
    if (!workspaceRoot) {
      return;
    }
    const store = new LayoutStore(workspaceRoot);
    const base = await store.read();
    this.layout = mergeRerouteSingleEdge(base, moduleName, edgeId, nodes);
    await store.write(this.layout);
    await this.postView();
  }

  private async saveEdgeLayout(moduleName: string, edgeId: string, waypoint: { x: number; y: number }): Promise<void> {
    const store = this.getStore();
    if (!store) {
      return;
    }
    if (!this.layout) {
      this.layout = await store.read();
    }
    this.layout = mergeEdgeWaypoint(this.layout, moduleName, edgeId, waypoint);
    await store.write(this.layout);
  }

  private async saveEdgeRoute(moduleName: string, edgeId: string, routePoints: Array<{ x: number; y: number }>): Promise<void> {
    const store = this.getStore();
    if (!store) {
      return;
    }
    if (!this.layout) {
      this.layout = await store.read();
    }
    this.layout = mergeEdgeRoutePoints(this.layout, moduleName, edgeId, routePoints);
    await store.write(this.layout);
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
    if (!this.layout) {
      this.layout = await store.read();
    }
    let layout = nodes ? mergeNodePositions(this.layout, moduleName, nodes) : this.layout;
    for (const change of changes) {
      layout = mergeEdgeRoutePoints(layout, moduleName, change.edgeId, change.routePoints);
    }
    this.layout = layout;
    await store.write(this.layout);
    await this.postView();
  }

  private async saveNetCut(moduleName: string, edge: DiagramEdge, nodes: PositionedNode[]): Promise<void> {
    const store = this.getStore();
    const designModule = this.graph?.modules[moduleName];
    if (!store || !designModule) {
      return;
    }
    if (!this.layout) {
      this.layout = await store.read();
    }
    this.currentModule = moduleName;
    this.layout = mergeNetCut(this.layout, moduleName, edge, designModule, nodes);
    await store.write(this.layout);
    await this.postView();
  }

  private async renameNetCut(moduleName: string, netKey: string, label: string): Promise<void> {
    const store = this.getStore();
    if (!store) {
      return;
    }
    if (!this.layout) {
      this.layout = await store.read();
    }
    this.currentModule = moduleName;
    this.layout = renameCutNet(this.layout, moduleName, netKey, label);
    await store.write(this.layout);
    await this.postView();
  }

  private async tieNet(moduleName: string, netKey: string): Promise<void> {
    const store = this.getStore();
    if (!store) {
      return;
    }
    if (!this.layout) {
      this.layout = await store.read();
    }
    this.currentModule = moduleName;
    this.layout = removeNetCut(this.layout, moduleName, netKey);
    await store.write(this.layout);
    await this.postView();
  }

  private async postView(): Promise<void> {
    if (!this.panel || !this.graph || !this.layout || this.currentModule === undefined) {
      return;
    }
    const view: DiagramViewModel = await buildViewModel(this.graph, this.currentModule, this.layout);
    await this.panel.webview.postMessage({
      type: 'graph',
      view,
      modules: Object.keys(this.graph.modules)
    });
  }

  private ensureWatcher(): void {
    if (this.watcher) {
      return;
    }
    const pattern = new vscode.RelativePattern(workspaceRootPath() ?? '.', '**/*.{sv,v,svh,vh}');
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const schedule = (live = false) => {
      if (this.rebuildTimer) {
        clearTimeout(this.rebuildTimer);
      }
      this.rebuildTimer = setTimeout(() => {
        void this.rebuild(live);
      }, live ? 350 : 250);
    };
    this.watcher.onDidCreate(() => schedule(false));
    this.watcher.onDidChange(() => schedule(false));
    this.watcher.onDidDelete(() => schedule(false));
    this.documentChangeDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
      if (isHdlUri(event.document.uri)) {
        schedule(true);
      }
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

function isHdlUri(uri: vscode.Uri): boolean {
  return /\.(sv|v|svh|vh)$/i.test(uri.fsPath);
}

function openHdlDocumentOverlays(workspaceRoot: string, projectFolder: string): Array<{ file: string; text: string }> {
  const projectRoot = vscode.Uri.file(`${workspaceRoot}/${projectFolder || '.'}`).fsPath;
  return vscode.workspace.textDocuments
    .filter((document) => isHdlUri(document.uri) && document.uri.fsPath.startsWith(projectRoot))
    .map((document) => ({
      file: vscode.workspace.asRelativePath(document.uri, false),
      text: document.getText()
    }));
}
