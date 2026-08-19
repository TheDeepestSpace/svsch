import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { findSnapshotBypass, loadSnapshotBypassEntries } from '../snapshotBypass';

describe('snapshot bypass allowlist', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'svsch-snapshot-bypass-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns no entries when the file is missing', () => {
    expect(loadSnapshotBypassEntries(path.join(tempDir, 'missing.yml'))).toEqual([]);
  });

  it('returns no entries when the list is empty', () => {
    const filePath = writeBypassFile(tempDir, 'bypass_threshold_restriction: []\n');
    expect(loadSnapshotBypassEntries(filePath)).toEqual([]);
  });

  it('parses a well-formed entry', () => {
    const filePath = writeBypassFile(
      tempDir,
      [
        'bypass_threshold_restriction:',
        '  - pr: 1234',
        '    date: 2026-08-11',
        '    path: test/visual/blah.png',
        '    diff_pixel_count: 42',
        '    reason: one liner reason for bypassing',
        '',
      ].join('\n'),
    );

    expect(loadSnapshotBypassEntries(filePath)).toEqual([
      {
        pr: 1234,
        date: '2026-08-11',
        path: 'test/visual/blah.png',
        diff_pixel_count: 42,
        reason: 'one liner reason for bypassing',
      },
    ]);
  });

  it('rejects an entry missing a required field', () => {
    const filePath = writeBypassFile(
      tempDir,
      [
        'bypass_threshold_restriction:',
        '  - pr: 1234',
        '    path: test/visual/blah.png',
        '    diff_pixel_count: 42',
        '    reason: missing the date field',
        '',
      ].join('\n'),
    );

    expect(() => loadSnapshotBypassEntries(filePath)).toThrow(/bypass_threshold_restriction\[0\]/);
  });

  it('matches only the exact pr, path, and diff pixel count an entry was written for', () => {
    const entries = [
      {
        pr: 1234,
        date: '2026-08-11',
        path: 'test/visual/blah.png',
        diff_pixel_count: 42,
        reason: 'one liner reason for bypassing',
      },
    ];

    expect(findSnapshotBypass(entries, 'test/visual/blah.png', 1234, 42)).toBe(entries[0]);
    expect(findSnapshotBypass(entries, 'test/visual/blah.png', 1234, 43)).toBeUndefined();
    expect(findSnapshotBypass(entries, 'test/visual/blah.png', 9999, 42)).toBeUndefined();
    expect(findSnapshotBypass(entries, 'test/visual/other.png', 1234, 42)).toBeUndefined();
  });
});

function writeBypassFile(tempDir: string, contents: string): string {
  const filePath = path.join(tempDir, 'snapshot-bypass.yml');
  fs.writeFileSync(filePath, contents);
  return filePath;
}
