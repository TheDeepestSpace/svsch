// Combines per-VS-Code-version system test results (one playwright-report.json
// + one set of recorded videos each, from the vscode_version matrix in
// test_system) into a single report + video set that
// generate-bdd-video-gallery.mjs can read as if it were one run.
//
// Unlike BDD's shards (disjoint scenarios merged via `playwright merge-reports`),
// every matrix leg here reruns the *same* 5 tests under a different VS Code
// version, so plain merging would collide both video filenames and gallery
// rows. This labels each version's specs under a synthetic `VS Code <version>`
// suite (picked up as the gallery's "feature" column) and namespaces video
// filenames by version before combining.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findFiles } from './generate-bdd-video-gallery.mjs';

function collectVideoAttachments(suite, found) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      for (const result of test.results ?? []) {
        for (const attachment of result.attachments ?? []) {
          if (attachment.contentType === 'video/webm') found.push(attachment);
        }
      }
    }
  }
  for (const child of suite.suites ?? []) collectVideoAttachments(child, found);
}

function labelSpecsWithVersion(suite, version) {
  const specs = suite.specs ?? [];
  const children = (suite.suites ?? []).map((child) => labelSpecsWithVersion(child, version));
  if (!specs.length) return { ...suite, suites: children };
  return {
    ...suite,
    specs: [],
    suites: [{ title: `VS Code ${version}`, suites: [], specs }, ...children],
  };
}

function attachmentSourceName(attachment) {
  return attachment.name?.startsWith('video:')
    ? attachment.name.slice('video:'.length)
    : path.basename(attachment.path);
}

export function mergeSystemVideoReports(outputDir, versionDirs) {
  fs.rmSync(outputDir, { recursive: true, force: true });
  const videosDir = path.join(outputDir, 'videos');
  fs.mkdirSync(videosDir, { recursive: true });

  const mergedSuites = [];
  for (const { version, dir } of versionDirs) {
    const reportPath = path.join(dir, 'playwright-report.json');
    if (!fs.existsSync(reportPath)) {
      console.warn(`No playwright-report.json under ${dir}, skipping VS Code ${version}`);
      continue;
    }
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));

    const attachments = [];
    for (const suite of report.suites ?? []) collectVideoAttachments(suite, attachments);
    const videosByBasename = new Map(
      findFiles(dir, (file) => file.endsWith('.webm')).map((file) => [path.basename(file), file]),
    );
    for (const attachment of attachments) {
      const originalName = attachmentSourceName(attachment);
      const source = videosByBasename.get(originalName);
      if (!source) {
        console.warn(`Video ${originalName} referenced by VS Code ${version} report but not found`);
        continue;
      }
      const newName = `${version}__${originalName}`;
      fs.copyFileSync(source, path.join(videosDir, newName));
      attachment.name = `video:${newName}`;
    }

    for (const suite of report.suites ?? [])
      mergedSuites.push(labelSpecsWithVersion(suite, version));
  }

  if (!mergedSuites.length) throw new Error('No system video reports found to merge');
  fs.writeFileSync(
    path.join(outputDir, 'playwright-report.json'),
    JSON.stringify({ suites: mergedSuites }),
  );
}

function parseVersionDirArg(arg) {
  const separatorIndex = arg.indexOf('=');
  if (separatorIndex < 1) {
    throw new Error(`Invalid argument "${arg}", expected <version>=<results-dir>`);
  }
  return { version: arg.slice(0, separatorIndex), dir: arg.slice(separatorIndex + 1) };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const [outputDir, ...rest] = process.argv.slice(2);
  if (!outputDir || !rest.length) {
    console.error(
      'Usage: node scripts/merge-system-video-reports.mjs <output-dir> <version>=<results-dir>...',
    );
    process.exitCode = 2;
  } else {
    mergeSystemVideoReports(outputDir, rest.map(parseVersionDirArg));
    console.log(
      `Merged system video reports for ${rest.length} VS Code version(s) into ${outputDir}`,
    );
  }
}
