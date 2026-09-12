import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  findOrphanedSnapshots,
  type OrphanReport,
  type UnresolvedNote,
} from '../test/playwrightSnapshotOrphans';
import { findOrphanedBddSnapshots, type BddOrphan } from '../test/bddSnapshotOrphans';

const root = path.resolve(__dirname, '..');

function usage(): never {
  throw new Error('Usage: find-orphaned-snapshots <visual|system|bdd|all>');
}

const [target = 'all'] = process.argv.slice(2);
if (!['visual', 'system', 'bdd', 'all'].includes(target)) usage();

function reportUnresolved(store: string, notes: UnresolvedNote[]): void {
  for (const note of notes) {
    const relFile = path.relative(root, note.file);
    console.log(`::warning file=${relFile},line=${note.line}::[${store}] ${note.reason}`);
  }
}

function reportOrphans(store: string, files: string[], reasonFor: (file: string) => string): void {
  for (const file of files) {
    const relFile = path.relative(root, file);
    console.error(`::error file=${relFile}::[${store}] Orphaned baseline: ${reasonFor(file)}`);
  }
}

let totalOrphans = 0;

function auditVisual(): void {
  const report: OrphanReport = findOrphanedSnapshots(
    path.join(root, 'test/visual'),
    path.join(root, 'test/visual/__screenshots__'),
    /\.visual\.spec\.ts$/,
    { projectName: 'chromium' },
  );
  reportUnresolved('visual', report.unresolved);
  reportOrphans(
    'visual',
    report.orphans,
    () => 'no live toHaveScreenshot/expectGraphAndScreenshot call produces this file',
  );
  totalOrphans += report.orphans.length;
  console.log(
    `[visual] checked, ${report.orphans.length} orphan(s), ${report.unresolved.length} unresolved call site(s).`,
  );
}

function auditSystem(): void {
  const versions: string[] = JSON.parse(
    fs.readFileSync(path.join(root, 'vscode-versions.json'), 'utf8'),
  );
  let orphanCount = 0;
  let unresolvedCount = 0;
  for (const version of versions) {
    const report = findOrphanedSnapshots(
      path.join(root, 'test/system'),
      path.join(root, 'test/system/__screenshots__', version),
      /\.spec\.ts$/,
      { projectName: '' },
    );
    reportUnresolved(`system/${version}`, report.unresolved);
    reportOrphans(
      'system',
      report.orphans,
      () => 'no live toHaveScreenshot call produces this file',
    );
    orphanCount += report.orphans.length;
    unresolvedCount += report.unresolved.length;
  }
  totalOrphans += orphanCount;
  console.log(
    `[system] checked ${versions.length} VS Code version(s), ${orphanCount} orphan(s), ${unresolvedCount} unresolved call site(s).`,
  );
}

function auditBdd(): void {
  const orphans: BddOrphan[] = findOrphanedBddSnapshots(
    path.join(root, 'test/features'),
    path.join(root, 'test/features/snapshots'),
  );
  for (const orphan of orphans) {
    const relFile = path.relative(root, orphan.file);
    console.error(`::error file=${relFile}::[bdd] Orphaned baseline: ${orphan.reason}`);
  }
  totalOrphans += orphans.length;
  console.log(`[bdd] checked, ${orphans.length} orphan(s).`);
}

if (target === 'visual' || target === 'all') auditVisual();
if (target === 'system' || target === 'all') auditSystem();
if (target === 'bdd' || target === 'all') auditBdd();

if (totalOrphans > 0) {
  console.error(
    `\nFound ${totalOrphans} orphaned screenshot baseline(s). Remove them with 'git rm', or update the call site if this is a false positive.`,
  );
  process.exit(1);
}
console.log('\nNo orphaned screenshot baselines found.');
