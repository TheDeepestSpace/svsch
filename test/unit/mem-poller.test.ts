import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  listDescendantPids,
  readPpid,
  resolveIntervalMs,
  sampleTreeRssBytes,
} from '../../scripts/mem-poller.mjs';

describe('resolveIntervalMs', () => {
  it('defaults to 250ms when unset', () => {
    expect(resolveIntervalMs(undefined)).toBe(250);
  });

  it('clamps below the 100ms floor', () => {
    expect(resolveIntervalMs('10')).toBe(100);
  });

  it('clamps above the 500ms ceiling', () => {
    expect(resolveIntervalMs('5000')).toBe(500);
  });

  it('falls back to the default for a non-numeric value', () => {
    expect(resolveIntervalMs('not-a-number')).toBe(250);
  });

  it('passes a value already inside the band through unchanged', () => {
    expect(resolveIntervalMs('300')).toBe(300);
  });
});

describe('readPpid', () => {
  it('returns null for a pid with no matching /proc entry', () => {
    expect(readPpid(999_999_999)).toBeNull();
  });

  it('returns a numeric ppid for a live process', () => {
    expect(readPpid(process.pid)).toEqual(expect.any(Number));
  });
});

describe('listDescendantPids', () => {
  it('includes the root pid even when it has no matching /proc entry', () => {
    expect(listDescendantPids(999_999_999)).toEqual([999_999_999]);
  });

  it('walks a real process tree, finding grandchildren too', async () => {
    // node -> child node -> grandchild node, so listDescendantPids has to
    // actually walk two levels rather than just reading direct children.
    const child = spawn('node', [
      '-e',
      'require("child_process").spawn("node", ["-e", "setTimeout(()=>{},1e4)"]);' +
        'setTimeout(()=>{},1e4);',
    ]);
    try {
      await new Promise((resolve) => child.once('spawn', resolve));
      // Give the grandchild a moment to actually appear under /proc.
      await new Promise((resolve) => setTimeout(resolve, 400));

      const descendants = listDescendantPids(child.pid);
      expect(descendants).toContain(child.pid);
      expect(descendants.length).toBeGreaterThanOrEqual(2);
    } finally {
      child.kill('SIGKILL');
    }
  });
});

describe('sampleTreeRssBytes', () => {
  it('sums RSS across a real process tree to something positive', async () => {
    const rss = await sampleTreeRssBytes(process.pid);
    expect(rss).toBeGreaterThan(0);
  });

  it('resolves to 0 rather than rejecting for a nonexistent pid', async () => {
    await expect(sampleTreeRssBytes(999_999_999)).resolves.toBe(0);
  });
});
