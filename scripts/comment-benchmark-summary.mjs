import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

// One review comment covering every diagram-generation benchmark suite, instead
// of a separate comment per suite. Args are "<benchmark-name>=<benchmark-file>"
// pairs, one per suite (system/bdd/visual).
const suites = process.argv.slice(2).map((arg) => {
  const [name, file] = arg.split('=');
  if (!name || !file) {
    throw new Error(`Invalid suite argument "${arg}", expected <benchmark-name>=<benchmark-file>`);
  }
  return { name, file };
});

const { GITHUB_API_URL = 'https://api.github.com', GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_TOKEN, PR_NUMBER } =
  process.env;

if (suites.length === 0) {
  throw new Error('Usage: node scripts/comment-benchmark-summary.mjs <name>=<file> [<name>=<file> ...]');
}
if (!GITHUB_REPOSITORY || !GITHUB_SHA || !GITHUB_TOKEN || !PR_NUMBER) {
  throw new Error('GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_TOKEN, and PR_NUMBER must be set');
}

const baseline = (() => {
  try {
    const script = execFileSync('git', ['show', 'origin/gh-pages:dev/bench/data.js'], { encoding: 'utf8' });
    return JSON.parse(script.slice('window.BENCHMARK_DATA = '.length));
  } catch {
    return undefined;
  }
})();

const formatChange = (current, previous) => {
  if (!Number.isFinite(previous) || previous === 0) return '';
  const pct = ((current - previous) / previous) * 100;
  const sign = pct > 0 ? '+' : '';
  return ` (${sign}${pct.toFixed(1)}%)`;
};

const escapeCell = (value) => String(value).replaceAll('|', '\\|').replaceAll('`', '\\`');

const rows = suites.map(({ name, file }) => {
  const [{ value, unit }] = JSON.parse(fs.readFileSync(file, 'utf8'));
  const previousEntry = baseline?.entries?.[name]?.at(-1)?.benches?.find((bench) => bench.name === name);
  const previous = previousEntry
    ? `\`${escapeCell(previousEntry.value)}\` ${escapeCell(previousEntry.unit)}`
    : '_no baseline yet_';
  const change = previousEntry ? formatChange(value, previousEntry.value) : '';
  return `| \`${escapeCell(name)}\` | ${previous} | \`${escapeCell(value)}\` ${escapeCell(unit)}${change} |`;
});

const commentId = 'diagram-generation-benchmark Summary';
const startTag = `<!-- github-benchmark-action-comment(start): ${commentId} -->`;
const endTag = `<!-- github-benchmark-action-comment(end): ${commentId} -->`;
const body = [
  startTag,
  '# diagram-generation-benchmark',
  '',
  `| Benchmark suite | Baseline (master) | Current: ${GITHUB_SHA.slice(0, 7)} |`,
  '|-|-|-|',
  ...rows,
  '',
  endTag,
].join('\n');

const [owner, repo] = GITHUB_REPOSITORY.split('/');
const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  'Content-Type': 'application/json',
  'X-GitHub-Api-Version': '2022-11-28',
};
const request = async (method, path, requestBody) => {
  const response = await fetch(`${GITHUB_API_URL}${path}`, {
    method,
    headers,
    body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
  });
  if (!response.ok) {
    throw new Error(`${method} ${path} failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
};

const reviews = [];
for (let page = 1; ; page++) {
  const batch = await request('GET', `/repos/${owner}/${repo}/pulls/${PR_NUMBER}/reviews?per_page=100&page=${page}`);
  reviews.push(...batch);
  if (batch.length < 100) break;
}
const existing = reviews.find((review) => review.body?.startsWith(startTag));
if (existing) {
  await request('PUT', `/repos/${owner}/${repo}/pulls/${PR_NUMBER}/reviews/${existing.id}`, { body });
  console.log('Updated combined benchmark comment.');
} else {
  await request('POST', `/repos/${owner}/${repo}/pulls/${PR_NUMBER}/reviews`, { event: 'COMMENT', body });
  console.log('Created combined benchmark comment.');
}
