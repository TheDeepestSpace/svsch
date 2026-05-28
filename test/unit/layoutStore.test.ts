import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { LayoutStore, SavedLayout } from '../../src/storage/layoutStore';

describe('LayoutStore Concurrency Fixed', () => {
  let tmpDir: string;
  let store: LayoutStore;
  let memoryLayout: SavedLayout;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'svsch-test-'));
    store = new LayoutStore(tmpDir);
    memoryLayout = { version: 1, modules: {} };
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('verifies that in-memory state avoids race conditions', async () => {
    // Initial state
    await store.write(memoryLayout);
    await store.flush();

    const simulateSave = async (moduleName: string, x: number) => {
      // Use in-memory state as source of truth, just like DiagramPanel now does
      memoryLayout = {
        ...memoryLayout,
        modules: {
          ...memoryLayout.modules,
          [moduleName]: {
            nodes: {
              'node1': { x, y: 0 }
            }
          }
        }
      };
      await store.write(memoryLayout);
    };

    // Trigger two saves for DIFFERENT modules concurrently
    await Promise.all([
      simulateSave('moduleA', 10),
      simulateSave('moduleB', 20)
    ]);

    // Ensure it's written to disk
    await store.flush();

    const onDisk = await store.read();
    
    console.log('Final modules on disk:', Object.keys(onDisk.modules));
    
    // BOTH should be there now
    expect(onDisk.modules['moduleA']).toBeDefined();
    expect(onDisk.modules['moduleB']).toBeDefined();
    expect(onDisk.modules['moduleA'].nodes['node1'].x).toBe(10);
    expect(onDisk.modules['moduleB'].nodes['node1'].x).toBe(20);
  });
});
