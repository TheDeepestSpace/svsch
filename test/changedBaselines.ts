export interface ChangedBaseline {
  oldPath: string;
  newPath: string;
}

function basename(filePath: string): string {
  return filePath.slice(filePath.lastIndexOf('/') + 1);
}

function pushToMap(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

// Parses the NUL-delimited output of `git diff --name-status -z -M <a> <b>`
// into old/new path pairs, including renames.
//
// Git can split a rename into separate add/delete records instead of a
// single R record when the file's content changed too much for its
// similarity heuristic to link them — this is common for PNGs, where a
// single pixel edit can rewrite the whole compressed byte stream. Add/delete
// records that share a basename are re-paired here so those renamed
// baselines are still compared between commits instead of silently skipping
// the gate.
export function parseChangedBaselines(nameStatusOutput: string): ChangedBaseline[] {
  const records = nameStatusOutput.split('\0').filter(Boolean);
  const pairs: ChangedBaseline[] = [];
  const addedByBasename = new Map<string, string[]>();
  const deletedByBasename = new Map<string, string[]>();

  let i = 0;
  while (i < records.length) {
    const status = records[i];
    if (status.startsWith('R') || status.startsWith('C')) {
      pairs.push({ oldPath: records[i + 1], newPath: records[i + 2] });
      i += 3;
    } else if (status === 'M') {
      pairs.push({ oldPath: records[i + 1], newPath: records[i + 1] });
      i += 2;
    } else if (status === 'A') {
      pushToMap(addedByBasename, basename(records[i + 1]), records[i + 1]);
      i += 2;
    } else if (status === 'D') {
      pushToMap(deletedByBasename, basename(records[i + 1]), records[i + 1]);
      i += 2;
    } else {
      i += 2;
    }
  }

  for (const [name, addedPaths] of addedByBasename) {
    const deletedPaths = deletedByBasename.get(name) ?? [];
    const pairCount = Math.min(addedPaths.length, deletedPaths.length);
    for (let j = 0; j < pairCount; j += 1) {
      pairs.push({ oldPath: deletedPaths[j], newPath: addedPaths[j] });
    }
  }

  return pairs;
}
