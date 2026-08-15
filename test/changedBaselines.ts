import { baselineThresholdFor } from './snapshotPolicy';

export interface ChangedBaseline {
  oldPath: string;
  newPath: string;
}

// Reported when multiple added/deleted baselines share a basename, so a
// same-basename rename can't be paired up unambiguously (see below).
export interface AmbiguousBaselineRename {
  basename: string;
  deletedPaths: string[];
  addedPaths: string[];
}

export interface ParsedChangedBaselines {
  pairs: ChangedBaseline[];
  ambiguous: AmbiguousBaselineRename[];
}

function basename(filePath: string): string {
  return filePath.slice(filePath.lastIndexOf('/') + 1);
}

function isBaselinePath(filePath: string): boolean {
  return baselineThresholdFor(filePath) !== undefined;
}

function pushToMap(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

// Parses the NUL-delimited output of `git diff --name-status -z -M <a> <b>`
// into old/new baseline path pairs, including renames. Non-baseline paths
// (e.g. README.md) are ignored.
//
// Git can split a rename into separate add/delete records instead of a
// single R record when the file's content changed too much for its
// similarity heuristic to link them — this is common for PNGs, where a
// single pixel edit can rewrite the whole compressed byte stream. Add/delete
// records that share a basename are re-paired here so those renamed
// baselines are still compared between commits instead of silently skipping
// the gate. When more than one added or deleted path shares a basename, the
// correct pairing can't be inferred from the name alone, so the group is
// reported as ambiguous instead of being paired by array index.
export function parseChangedBaselines(nameStatusOutput: string): ParsedChangedBaselines {
  const records = nameStatusOutput.split('\0').filter(Boolean);
  const pairs: ChangedBaseline[] = [];
  const ambiguous: AmbiguousBaselineRename[] = [];
  const addedByBasename = new Map<string, string[]>();
  const deletedByBasename = new Map<string, string[]>();

  let i = 0;
  while (i < records.length) {
    const status = records[i];
    if (status.startsWith('R') || status.startsWith('C')) {
      if (isBaselinePath(records[i + 2])) {
        pairs.push({ oldPath: records[i + 1], newPath: records[i + 2] });
      }
      i += 3;
    } else if (status === 'M' || status === 'T') {
      if (isBaselinePath(records[i + 1])) {
        pairs.push({ oldPath: records[i + 1], newPath: records[i + 1] });
      }
      i += 2;
    } else if (status === 'A') {
      if (isBaselinePath(records[i + 1])) {
        pushToMap(addedByBasename, basename(records[i + 1]), records[i + 1]);
      }
      i += 2;
    } else if (status === 'D') {
      if (isBaselinePath(records[i + 1])) {
        pushToMap(deletedByBasename, basename(records[i + 1]), records[i + 1]);
      }
      i += 2;
    } else {
      i += 2;
    }
  }

  for (const [name, addedPaths] of addedByBasename) {
    const deletedPaths = deletedByBasename.get(name) ?? [];
    if (deletedPaths.length === 0) continue;
    if (addedPaths.length === 1 && deletedPaths.length === 1) {
      pairs.push({ oldPath: deletedPaths[0], newPath: addedPaths[0] });
    } else {
      ambiguous.push({ basename: name, deletedPaths, addedPaths });
    }
  }

  return { pairs, ambiguous };
}
