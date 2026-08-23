import fs from 'node:fs';
import path from 'node:path';
import { upsertReviewComment } from './upsert-pr-review-comment.mjs';

// Joins every *.md file produced by a stats-generating CI job (coverage,
// diagram-generation benchmark, ...) into one PR review comment, so each job
// only needs to know how to render its own section rather than how to
// upsert a PR comment — see generate-coverage-stats.mjs and
// generate-benchmark-stats.mjs. Files are joined in sorted filename order
// for a stable section layout regardless of artifact download order.
const [, , statsDir] = process.argv;
if (!statsDir) {
  throw new Error('Usage: node scripts/upsert-pr-stats-comment.mjs <stats-dir>');
}

const {
  GITHUB_API_URL = 'https://api.github.com',
  GITHUB_REPOSITORY,
  GITHUB_SHA,
  GITHUB_TOKEN,
  PR_NUMBER,
} = process.env;
if (!GITHUB_REPOSITORY || !GITHUB_SHA || !GITHUB_TOKEN || !PR_NUMBER) {
  throw new Error('GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_TOKEN, and PR_NUMBER must be set');
}

const files = fs
  .readdirSync(statsDir)
  .filter((name) => name.endsWith('.md'))
  .sort();
if (files.length === 0) {
  throw new Error(`No *.md stats files found in ${statsDir}`);
}

const sections = files.map((name) => fs.readFileSync(path.join(statsDir, name), 'utf8').trim());

const startTag = '<!-- github-pr-stats-comment(start): pr-stats -->';
const endTag = '<!-- github-pr-stats-comment(end): pr-stats -->';
const body = [startTag, `# PR stats — ${GITHUB_SHA.slice(0, 7)}`, ...sections, endTag].join('\n\n');

const [owner, repo] = GITHUB_REPOSITORY.split('/');
const result = await upsertReviewComment({
  apiUrl: GITHUB_API_URL,
  owner,
  repo,
  prNumber: PR_NUMBER,
  token: GITHUB_TOKEN,
  startTag,
  body,
});
console.log(`${result === 'updated' ? 'Updated' : 'Created'} combined PR stats comment.`);
