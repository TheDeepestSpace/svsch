import { describe, expect, it, vi } from 'vitest';
import {
  ElaborationService,
  type ElaborationRequest,
  type ElaborationServiceHost
} from '../../src/elaborationService';
import type { DesignGraph, DesignModule } from '../../src/ir/types';
import type { ParserOptions } from '../../src/parser/backend';

function graph(module: DesignModule, diagnostics: DesignGraph['diagnostics'] = []): DesignGraph {
  return {
    rootModules: [module.name],
    modules: { [module.name]: module },
    diagnostics,
    generatedAt: '2026-08-03T00:00:00.000Z'
  };
}

function designModule(name: string, file = `${name}.sv`): DesignModule {
  return { name, file, ports: [], nodes: [], edges: [] };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createHost(build: ElaborationServiceHost['build']) {
  let invalidate: ((live: boolean) => void) | undefined;
  const disposeWatcher = vi.fn();
  const cancelPending = vi.fn();
  const createParserOptions = vi.fn((request: ElaborationRequest): ParserOptions => ({
    workspaceRoot: '/workspace',
    projectFolder: '.',
    backend: 'uhdm',
    veriblePath: 'verible-verilog-syntax',
    surelogPath: 'surelog',
    backendPath: 'svsch_backend',
    moduleName: request.moduleName,
    listOnly: request.listOnly,
    includeExternalDiagnostics: !request.live
  }));
  const host: ElaborationServiceHost = {
    build,
    createParserOptions,
    withProgress: (task) => task(() => undefined),
    watch: (listener) => {
      invalidate = listener;
      return { cancelPending, dispose: disposeWatcher };
    }
  };
  return {
    host,
    createParserOptions,
    cancelPending,
    disposeWatcher,
    invalidate: (live = false) => invalidate?.(live)
  };
}

describe('ElaborationService', () => {
  it('shares an in-flight full build and caches its result', async () => {
    const pending = deferred<DesignGraph>();
    const build = vi.fn(() => pending.promise);
    const { host } = createHost(build);
    const service = new ElaborationService(host);

    const first = service.getGraph();
    const second = service.getGraph();
    expect(first).toBe(second);
    expect(build).toHaveBeenCalledTimes(1);

    const result = graph(designModule('top'));
    pending.resolve(result);
    await expect(first).resolves.toBe(result);
    await expect(second).resolves.toBe(result);
    await expect(service.getGraph()).resolves.toBe(result);
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('invalidates the cache once for all consumers and ignores a stale build', async () => {
    const staleBuild = deferred<DesignGraph>();
    const freshBuild = deferred<DesignGraph>();
    const build = vi.fn()
      .mockReturnValueOnce(staleBuild.promise)
      .mockReturnValueOnce(freshBuild.promise);
    const { host, invalidate, createParserOptions } = createHost(build);
    const service = new ElaborationService(host);
    const listener = vi.fn();
    service.onDidInvalidate(listener);

    const stalePromise = service.getGraph();
    invalidate(true);
    const freshPromise = service.getGraph(true);
    expect(listener).toHaveBeenCalledWith(true);
    expect(build).toHaveBeenCalledTimes(2);

    const stale = graph(designModule('stale'));
    const fresh = graph(designModule('fresh'));
    staleBuild.resolve(stale);
    freshBuild.resolve(fresh);
    await expect(stalePromise).resolves.toBe(stale);
    await expect(freshPromise).resolves.toBe(fresh);
    await expect(service.getGraph()).resolves.toBe(fresh);
    expect(createParserOptions).toHaveBeenLastCalledWith({ live: true });
  });

  it('shares and caches an on-demand module load', async () => {
    const placeholder = graph(designModule('top', ''));
    const loadedModule = designModule('top');
    loadedModule.nodes.push({
      id: 'instance:top:u_child',
      kind: 'instance',
      label: 'u_child',
      ports: []
    });
    const loaded = graph(loadedModule, [{ severity: 'warning', message: 'module diagnostic' }]);
    const moduleBuild = deferred<DesignGraph>();
    const build = vi.fn()
      .mockResolvedValueOnce(placeholder)
      .mockReturnValueOnce(moduleBuild.promise);
    const { host, createParserOptions } = createHost(build);
    const service = new ElaborationService(host);

    const first = service.getModule('top');
    const second = service.getModule('top');
    await vi.waitFor(() => expect(build).toHaveBeenCalledTimes(2));
    moduleBuild.resolve(loaded);

    const [firstGraph, secondGraph] = await Promise.all([first, second]);
    expect(firstGraph).toBe(secondGraph);
    expect(firstGraph.modules.top).toBe(loadedModule);
    expect(firstGraph.diagnostics).toEqual(loaded.diagnostics);
    await expect(service.getModule('top')).resolves.toBe(firstGraph);
    expect(build).toHaveBeenCalledTimes(2);
    expect(createParserOptions).toHaveBeenLastCalledWith({ moduleName: 'top' });
  });

  it('falls back to a list-only build when the backend exceeds its buffer', async () => {
    const result = graph(designModule('top', ''));
    const build = vi.fn()
      .mockRejectedValueOnce(new Error('stdout maxBuffer length exceeded'))
      .mockResolvedValueOnce(result);
    const { host } = createHost(build);
    const service = new ElaborationService(host);

    await expect(service.getGraph()).resolves.toBe(result);
    expect(build).toHaveBeenCalledTimes(2);
    expect(build.mock.calls[1][0]).toMatchObject({ listOnly: true });
  });

  it('cancels a pending watcher event before a manual refresh', async () => {
    const result = graph(designModule('top'));
    const build = vi.fn().mockResolvedValue(result);
    const { host, cancelPending } = createHost(build);
    const service = new ElaborationService(host);

    await service.refresh();
    expect(cancelPending).toHaveBeenCalledOnce();
    expect(build).toHaveBeenCalledOnce();
  });

  it('disposes its single shared watcher', () => {
    const { host, disposeWatcher } = createHost(vi.fn());
    const service = new ElaborationService(host);

    service.dispose();
    expect(disposeWatcher).toHaveBeenCalledOnce();
  });
});
