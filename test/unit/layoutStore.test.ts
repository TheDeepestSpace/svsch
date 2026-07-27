import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { LayoutStore } from '../../src/storage/layoutStore';

describe('LayoutStore', () => {
  let tmpDir: string;
  let store: LayoutStore;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'svsch-test-'));
    store = new LayoutStore(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns an empty layout for a module that was never saved', async () => {
    const layout = await store.readModuleLayout('never_saved');
    expect(layout).toEqual({ nodes: {} });
  });

  it('persists each module to its own file under .svsch/layouts/', async () => {
    await store.writeModuleLayout('moduleA', { nodes: { node1: { x: 10, y: 0 } } });
    await store.flush();

    const moduleAPath = path.join(tmpDir, '.svsch', 'layouts', 'moduleA.json');
    const raw = await fs.readFile(moduleAPath, 'utf8');
    expect(JSON.parse(raw)).toEqual({ nodes: { node1: { x: 10, y: 0 } } });

    // Only the written module's file exists — no monolithic layout.json.
    const entries = await fs.readdir(path.join(tmpDir, '.svsch', 'layouts'));
    expect(entries).toEqual(['moduleA.json']);
    await expect(fs.access(path.join(tmpDir, '.svsch', 'layout.json'))).rejects.toThrow();
  });

  it('writes concurrent updates to different modules without clobbering each other', async () => {
    await Promise.all([
      store.writeModuleLayout('moduleA', { nodes: { node1: { x: 10, y: 0 } } }),
      store.writeModuleLayout('moduleB', { nodes: { node1: { x: 20, y: 0 } } })
    ]);
    await store.flush();

    const moduleA = await store.readModuleLayout('moduleA');
    const moduleB = await store.readModuleLayout('moduleB');
    expect(moduleA.nodes.node1.x).toBe(10);
    expect(moduleB.nodes.node1.x).toBe(20);
  });

  it('debounces rapid writes to the same module into a single file write', async () => {
    await store.writeModuleLayout('moduleA', { nodes: { node1: { x: 1, y: 0 } } });
    await store.writeModuleLayout('moduleA', { nodes: { node1: { x: 2, y: 0 } } });
    await store.writeModuleLayout('moduleA', { nodes: { node1: { x: 3, y: 0 } } });
    await store.flush();

    const layout = await store.readModuleLayout('moduleA');
    expect(layout.nodes.node1.x).toBe(3);
  });

  it('sanitizes module names containing illegal filesystem characters', async () => {
    const moduleName = 'pkg::sub/module a';
    await store.writeModuleLayout(moduleName, { nodes: { node1: { x: 5, y: 5 } } });
    await store.flush();

    const files = await fs.readdir(path.join(tmpDir, '.svsch', 'layouts'));
    expect(files).toEqual([`${encodeURIComponent(moduleName)}.json`]);

    const roundTripped = await store.readModuleLayout(moduleName);
    expect(roundTripped.nodes.node1).toEqual({ x: 5, y: 5 });
  });

  it('deletes only the target module file when reset', async () => {
    await store.writeModuleLayout('moduleA', { nodes: { node1: { x: 1, y: 1 } } });
    await store.writeModuleLayout('moduleB', { nodes: { node1: { x: 2, y: 2 } } });
    await store.flush();

    await store.resetModuleLayout('moduleA');

    expect(await store.readModuleLayout('moduleA')).toEqual({ nodes: {} });
    expect(await store.readModuleLayout('moduleB')).toEqual({ nodes: { node1: { x: 2, y: 2 } } });
  });

  it('resetModuleLayout on a module with no saved file is a no-op', async () => {
    await expect(store.resetModuleLayout('never_saved')).resolves.toBeUndefined();
  });
});
