import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const [benchmarkName, benchmarkFile] = process.argv.slice(2);
const { GITHUB_API_URL = 'https://api.github.com', GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_TOKEN, PR_NUMBER } =
  process.env;

if (!benchmarkName || !benchmarkFile) {
  throw new Error('Usage: node scripts/comment-benchmark-fallback.mjs <benchmark-name> <benchmark-file>');
}

const baselineScript = (() => {
  try {
    return execFileSync('git', ['show', 'gh-pages^:dev/bench/data.js'], { encoding: 'utf8' });
  } catch {
    return undefined;
  }
})();

if (baselineScript) {
  const scriptPrefix = 'window.BENCHMARK_DATA = ';
  const baseline = JSON.parse(baselineScript.slice(scriptPrefix.length));
  if (baseline.entries?.[benchmarkName]?.length > 0) {
    console.log(`A published baseline exists for ${benchmarkName}; github-action-benchmark posted the comparison.`);
    process.exit(0);
  }
}

if (!GITHUB_REPOSITORY || !GITHUB_SHA || !GITHUB_TOKEN || !PR_NUMBER) {
  throw new Error('GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_TOKEN, and PR_NUMBER must be set');
}

const results = JSON.parse(fs.readFileSync(benchmarkFile, 'utf8'));
if (!Array.isArray(results) || results.length === 0) {
  throw new Error(`No benchmark results found in ${benchmarkFile}`);
}

const commentId = `${benchmarkName} Summary`;
const startTag = `<!-- github-benchmark-action-comment(start): ${commentId} -->`;
const endTag = `<!-- github-benchmark-action-comment(end): ${commentId} -->`;
const escapeCell = (value) => String(value).replaceAll('|', '\\|').replaceAll('`', '\\`');
const rows = results.map(
  ({ name, value, unit }) => `| \`${escapeCell(name)}\` | \`${escapeCell(value)}\` ${escapeCell(unit)} |`,
);
const body = [
  startTag,
  `# ${benchmarkName}`,
  '',
  'No published default-branch benchmark is available yet. Current result:',
  '',
  `| Benchmark suite | Current: ${GITHUB_SHA.slice(0, 7)} |`,
  '|-|-|',
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

const reviews = await request('GET', `/repos/${owner}/${repo}/pulls/${PR_NUMBER}/reviews?per_page=100`);
const existing = reviews.find((review) => review.body?.startsWith(startTag));
if (existing) {
  await request('PUT', `/repos/${owner}/${repo}/pulls/${PR_NUMBER}/reviews/${existing.id}`, { body });
  console.log(`Updated current benchmark comment for ${benchmarkName}.`);
} else {
  await request('POST', `/repos/${owner}/${repo}/pulls/${PR_NUMBER}/reviews`, { event: 'COMMENT', body });
  console.log(`Created current benchmark comment for ${benchmarkName}.`);
}
