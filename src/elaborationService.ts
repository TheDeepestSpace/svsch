import type { DesignGraph, DesignModule } from './ir/types';
import type { ParserOptions } from './parser/backend';
import { logger } from './logger';

export interface Disposable {
  dispose(): void;
}

export interface InvalidationWatcher extends Disposable {
  cancelPending(): void;
}

export interface ElaborationRequest {
  live?: boolean;
  moduleName?: string;
  listOnly?: boolean;
}

export interface ElaborationServiceHost {
  build(options: ParserOptions): Promise<DesignGraph>;
  createParserOptions(request: ElaborationRequest): ParserOptions;
  withProgress<T>(task: (onProgress: NonNullable<ParserOptions['onProgress']>) => Promise<T>): Promise<T>;
  watch(onDidInvalidate: (live: boolean) => void): InvalidationWatcher;
}

/**
 * Owns elaboration for the extension process. All diagram panels consume this
 * service so a project graph, an in-flight build, and the HDL watcher are shared.
 */
export class ElaborationService implements Disposable {
  private readonly invalidationListeners = new Set<(live: boolean) => void>();
  private readonly watcher: InvalidationWatcher;
  private graph?: DesignGraph;
  private graphPromise?: Promise<DesignGraph>;
  private readonly modulePromises = new Map<string, Promise<DesignGraph>>();
  private generation = 0;

  constructor(private readonly host: ElaborationServiceHost) {
    this.watcher = host.watch((live) => this.invalidate(live));
  }

  onDidInvalidate(listener: (live: boolean) => void): Disposable {
    this.invalidationListeners.add(listener);
    return {
      dispose: () => this.invalidationListeners.delete(listener)
    };
  }

  /** Returns the cached graph, sharing an in-flight build when necessary. */
  getGraph(live = false): Promise<DesignGraph> {
    if (this.graph) {
      return Promise.resolve(this.graph);
    }
    if (this.graphPromise) {
      return this.graphPromise;
    }

    const generation = this.generation;
    const buildPromise = this.buildFullGraph(live);
    const promise: Promise<DesignGraph> = buildPromise.then((graph) => {
      if (generation === this.generation) {
        this.graph = graph;
      }
      return graph;
    }).finally(() => {
      if (this.graphPromise === promise) {
        this.graphPromise = undefined;
      }
    });
    this.graphPromise = promise;
    return promise;
  }

  /** Invalidates the current result and starts one shared replacement build. */
  refresh(live = false): Promise<DesignGraph> {
    this.watcher.cancelPending();
    this.invalidate(live);
    return this.getGraph(live);
  }

  /**
   * Loads a list-only placeholder once and merges it into the shared graph.
   * Concurrent panels asking for the same module share the backend invocation.
   */
  async getModule(moduleName: string): Promise<DesignGraph> {
    const graph = await this.getGraph();
    const module = graph.modules[moduleName];
    if (!module || !isListOnlyPlaceholder(module)) {
      return graph;
    }

    const existing = this.modulePromises.get(moduleName);
    if (existing) {
      return existing;
    }

    const generation = this.generation;
    const promise: Promise<DesignGraph> = this.host.build(this.host.createParserOptions({ moduleName })).then((moduleGraph) => {
      if (generation !== this.generation) {
        return this.getGraph();
      }

      const currentGraph = this.graph ?? graph;
      const loadedModule = moduleGraph.modules[moduleName];
      if (!loadedModule) {
        return currentGraph;
      }

      const mergedGraph: DesignGraph = {
        ...currentGraph,
        modules: { ...currentGraph.modules, [moduleName]: loadedModule },
        diagnostics: [...currentGraph.diagnostics, ...moduleGraph.diagnostics]
      };
      this.graph = mergedGraph;
      return mergedGraph;
    }).finally(() => {
      if (this.modulePromises.get(moduleName) === promise) {
        this.modulePromises.delete(moduleName);
      }
    });

    this.modulePromises.set(moduleName, promise);
    return promise;
  }

  invalidate(live = false): void {
    this.generation += 1;
    this.graph = undefined;
    this.graphPromise = undefined;
    this.modulePromises.clear();
    for (const listener of this.invalidationListeners) {
      listener(live);
    }
  }

  dispose(): void {
    this.generation += 1;
    this.watcher.dispose();
    this.invalidationListeners.clear();
    this.graph = undefined;
    this.graphPromise = undefined;
    this.modulePromises.clear();
  }

  private async buildFullGraph(live: boolean): Promise<DesignGraph> {
    const commonOptions = this.host.createParserOptions({ live });
    return this.host.withProgress(async (onProgress) => {
      try {
        return await this.host.build({ ...commonOptions, onProgress });
      } catch (error) {
        if (error instanceof Error && error.message.includes('maxBuffer length exceeded')) {
          logger.warn('Full design too large for buffer, falling back to on-demand module loading.');
          return this.host.build({ ...commonOptions, listOnly: true, onProgress });
        }
        throw error;
      }
    });
  }
}

export function isListOnlyPlaceholder(module: DesignModule): boolean {
  return !module.file && !module.nodes.some((node) => node.kind !== 'port');
}
