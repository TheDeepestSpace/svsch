// Concatenates per-shard github-action-benchmark "customSmallerIsBetter" JSON
// files (see test/benchmarkUtils.ts) into a single combined file. Each CI
// shard runs a disjoint subset of tests, so entry names never collide across
// inputs — no de-duping or averaging needed, just concatenate and sort.
import fs from 'node:fs';
import path from 'node:path';

const [outputFile, ...inputFiles] = process.argv.slice(2);
if (!outputFile || inputFiles.length === 0) {
  throw new Error(
    'Usage: node scripts/merge-benchmark-json.mjs <output-file> <input-file> [<input-file> ...]',
  );
}

const merged = inputFiles
  .flatMap((file) => JSON.parse(fs.readFileSync(file, 'utf8')))
  .sort((a, b) => a.name.localeCompare(b.name));

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, JSON.stringify(merged, null, 2) + '\n', 'utf8');
