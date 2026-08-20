import * as fs from 'node:fs';
import * as path from 'node:path';
import { load } from 'js-yaml';

export interface SnapshotBypassEntry {
  pr: number;
  date: string;
  path: string;
  diff_pixel_count: number;
  reason: string;
}

interface SnapshotBypassFile {
  bypass_threshold_restriction?: unknown;
}

export const DEFAULT_SNAPSHOT_BYPASS_FILE = path.join(__dirname, 'snapshot-bypass.yml');

export function loadSnapshotBypassEntries(
  filePath: string = DEFAULT_SNAPSHOT_BYPASS_FILE,
): SnapshotBypassEntry[] {
  if (!fs.existsSync(filePath)) return [];
  const parsed = load(fs.readFileSync(filePath, 'utf8')) as SnapshotBypassFile | undefined;
  const entries = parsed?.bypass_threshold_restriction;
  if (!entries) return [];
  if (!Array.isArray(entries)) {
    throw new Error(`${filePath}: "bypass_threshold_restriction" must be a list.`);
  }
  return entries.map((entry, index) => validateEntry(entry, index, filePath));
}

function validateEntry(entry: unknown, index: number, filePath: string): SnapshotBypassEntry {
  const candidate = entry as Partial<SnapshotBypassEntry> | null;
  if (
    !candidate ||
    typeof candidate.pr !== 'number' ||
    typeof candidate.date !== 'string' ||
    typeof candidate.path !== 'string' ||
    typeof candidate.diff_pixel_count !== 'number' ||
    typeof candidate.reason !== 'string'
  ) {
    throw new Error(
      `${filePath}: bypass_threshold_restriction[${index}] must set pr (number), date (string), ` +
        'path (string), diff_pixel_count (number), and reason (string).',
    );
  }
  return candidate as SnapshotBypassEntry;
}

// An entry only bypasses the gate for the exact PR, file, and diff pixel
// count it was written for — it cannot be reused for a different or larger
// change to the same file.
export function findSnapshotBypass(
  entries: SnapshotBypassEntry[],
  filePath: string,
  prNumber: number,
  diffPixelCount: number,
): SnapshotBypassEntry | undefined {
  const normalizedFilePath = filePath.replaceAll('\\', '/');
  return entries.find(
    (entry) =>
      entry.path.replaceAll('\\', '/') === normalizedFilePath &&
      entry.pr === prNumber &&
      entry.diff_pixel_count === diffPixelCount,
  );
}
