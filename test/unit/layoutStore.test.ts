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
      store.writeModuleLayout('moduleB', { nodes: { node1: { x: 20, y: 0 } } }),
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

  describe('expanded instance layout ("Expand" — issue #232)', () => {
    it('returns undefined for an instance that was never expanded', async () => {
      expect(await store.readExpandedInstanceLayout('top', 'u0')).toBeUndefined();
    });

    // eslint-disable-next-line max-len
    it("persists and reads back a per-instance snapshot separately from the child module's own standalone layout", async () => {
      await store.writeExpandedInstanceLayout('top', 'u0', {
        childModuleName: 'adder',
        nodes: { reg1: { x: 100, y: 200, fixed: true } },
        bounds: { x: 0, y: 0, width: 240, height: 120 },
        fixed: true,
        instanceOrigin: { x: 10, y: 20 },
      });

      const snapshot = await store.readExpandedInstanceLayout('top', 'u0');
      expect(snapshot).toEqual({
        childModuleName: 'adder',
        nodes: { reg1: { x: 100, y: 200, fixed: true } },
        bounds: { x: 0, y: 0, width: 240, height: 120 },
        fixed: true,
        instanceOrigin: { x: 10, y: 20 },
      });

      // Never touches the child module's own per-module layout file.
      expect(await store.readModuleLayout('adder')).toEqual({ nodes: {} });
    });

    // eslint-disable-next-line max-len
    it('scopes snapshots per instance, not per child module — two instances of the same module get independent snapshots', async () => {
      await store.writeExpandedInstanceLayout('top', 'u0', {
        childModuleName: 'adder',
        nodes: { r: { x: 1, y: 1 } },
      });
      await store.writeExpandedInstanceLayout('top', 'u1', {
        childModuleName: 'adder',
        nodes: { r: { x: 2, y: 2 } },
      });

      expect((await store.readExpandedInstanceLayout('top', 'u0'))?.nodes.r.x).toBe(1);
      expect((await store.readExpandedInstanceLayout('top', 'u1'))?.nodes.r.x).toBe(2);
    });

    it('resets only the targeted instance snapshot', async () => {
      await store.writeExpandedInstanceLayout('top', 'u0', { childModuleName: 'adder', nodes: {} });
      await store.writeExpandedInstanceLayout('top', 'u1', { childModuleName: 'adder', nodes: {} });

      await store.resetExpandedInstanceLayout('top', 'u0');

      expect(await store.readExpandedInstanceLayout('top', 'u0')).toBeUndefined();
      expect(await store.readExpandedInstanceLayout('top', 'u1')).toBeDefined();
    });

    it('resetExpandedInstanceLayout on an instance with no saved snapshot is a no-op', async () => {
      await expect(
        store.resetExpandedInstanceLayout('top', 'never_expanded'),
      ).resolves.toBeUndefined();
    });
  });
});
