import fs from 'node:fs';
import path from 'node:path';

// The system suite's CI matrix uploads one benchmark-system-<vscode_version>
// artifact per job (each holding a single-entry benchmark.json); this merges
// them into one file so the PR chart can show one bar per version.
const benchmarksDir = process.argv[2] ?? 'benchmarks';
const outputFile = path.join(benchmarksDir, 'benchmark-system', 'benchmark.json');

const versionDirs = fs.readdirSync(benchmarksDir).filter((name) => name.startsWith('benchmark-system-'));
const entries = versionDirs.flatMap((name) =>
  JSON.parse(fs.readFileSync(path.join(benchmarksDir, name, 'benchmark.json'), 'utf8'))
);

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, JSON.stringify(entries, null, 2) + '\n', 'utf8');
console.log(`Merged ${entries.length} system benchmark entries from ${versionDirs.length} version(s) into ${outputFile}`);
