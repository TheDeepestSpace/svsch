// Classifies BDD scenarios as new/modified/unchanged by diffing the
// `.feature` files present at a base checkout against a head checkout.
// Deliberately standalone (no import from generate-bdd-video-gallery.mjs) so
// it stays unit-testable in isolation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCENARIO_RE = /^\s*Scenario(?: Outline)?:\s*(.*)$/;
const TAG_LINE_RE = /^\s*(@\S+)(\s+@\S+)*\s*$/;
const FEATURE_RE = /^\s*Feature:\s*(.*)$/;

function findFeatureFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const pending = [root];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      else if (entry.isFile() && entryPath.endsWith('.feature')) files.push(entryPath);
    }
  }
  return files;
}

// Scenario keys are `${feature}\0${scenario title}` — the same shape the
// gallery generator uses to match videos to their metadata.
export function scenarioKey(feature, scenario) {
  return `${feature}\0${scenario}`;
}

// Splits a single .feature file's contents into scenario blocks. A block
// starts at a `Scenario:`/`Scenario Outline:` line, extended backwards to
// include any tag lines directly attached above it (standard Gherkin tag
// placement), and runs through to the line before the next scenario's block
// (i.e. before that scenario's own attached tags, if any) or EOF.
export function parseFeatureScenarios(content) {
  const lines = content.split(/\r\n|\n/);
  const featureLine = lines.find((line) => FEATURE_RE.test(line));
  const feature = featureLine ? featureLine.match(FEATURE_RE)[1].trim() : 'BDD scenario';

  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(SCENARIO_RE);
    if (!match) continue;
    let blockStart = i;
    let j = i - 1;
    while (j >= 0 && TAG_LINE_RE.test(lines[j])) {
      blockStart = j;
      j--;
    }
    starts.push({ blockStart, title: match[1].trim() });
  }

  return starts.map(({ blockStart, title }, index) => {
    const blockEnd = index + 1 < starts.length ? starts[index + 1].blockStart : lines.length;
    return { feature, scenario: title, block: lines.slice(blockStart, blockEnd).join('\n').trim() };
  });
}

// Collects every scenario block under a features directory into a
// key -> block-text map.
export function collectScenarioBlocks(featuresDir) {
  const blocks = new Map();
  for (const file of findFeatureFiles(featuresDir)) {
    const content = fs.readFileSync(file, 'utf8');
    for (const { feature, scenario, block } of parseFeatureScenarios(content)) {
      blocks.set(scenarioKey(feature, scenario), block);
    }
  }
  return blocks;
}

// Diffs two key -> block-text maps and classifies every key present at
// either side: head-only is `new`, changed-on-both-sides is `modified`,
// present-on-both-unchanged is `unchanged`, base-only is `removed`.
export function diffScenarioBlocks(baseBlocks, headBlocks) {
  const status = new Map();
  for (const [key, headBlock] of headBlocks) {
    if (!baseBlocks.has(key)) status.set(key, 'new');
    else if (baseBlocks.get(key) !== headBlock) status.set(key, 'modified');
    else status.set(key, 'unchanged');
  }
  for (const key of baseBlocks.keys()) {
    if (!headBlocks.has(key)) status.set(key, 'removed');
  }
  return status;
}

// Convenience wrapper: reads `.feature` files under both directories and
// returns the classification map for every scenario present at head or base.
export function diffBddScenarios(baseFeaturesDir, headFeaturesDir) {
  return diffScenarioBlocks(
    collectScenarioBlocks(baseFeaturesDir),
    collectScenarioBlocks(headFeaturesDir),
  );
}

// Recovers the feature/scenario pair encoded by scenarioKey(), for consumers
// (like the gallery generator) that need to display a scenario they only
// have the key for — e.g. a `removed` scenario, which has no head-side data.
export function splitScenarioKey(key) {
  const [feature, scenario] = key.split('\0');
  return { feature, scenario };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const [outputFile, baseFeaturesDir, headFeaturesDir] = process.argv.slice(2);
  if (!outputFile || !baseFeaturesDir || !headFeaturesDir) {
    console.error(
      'Usage: node scripts/diff-bdd-scenarios.mjs <output-file> <base-features-dir> <head-features-dir>',
    );
    process.exitCode = 2;
  } else {
    const status = diffBddScenarios(baseFeaturesDir, headFeaturesDir);
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, `${JSON.stringify(Object.fromEntries(status), null, 2)}\n`);
    const counts = { new: 0, modified: 0, unchanged: 0, removed: 0 };
    for (const value of status.values()) counts[value]++;
    console.log(
      `Diffed ${status.size} scenarios: ${counts.new} new, ${counts.modified} modified, ${counts.unchanged} unchanged, ${counts.removed} removed`,
    );
  }
}
