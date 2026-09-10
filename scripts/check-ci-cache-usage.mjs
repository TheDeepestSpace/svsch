// The shared node_modules cache (see restore_npm_step in ci.yml) must have
// exactly one writer: `setup`, whose "Install dependencies" step is gated on
// `cache-hit != 'true'`. Every other job only ever reads that cache and never
// runs `npm ci`, so if it used the read+write `actions/cache` action instead
// of the read-only `actions/cache/restore`, a stale restore-keys prefix-match
// hit in that job would get re-saved under the *current* exact key — a false
// cache-hit that then makes `setup` (and everyone else) skip `npm ci` on the
// next run, silently running against stale dependencies (#255).
import fs from 'node:fs';
import { load } from 'js-yaml';

const WORKFLOW_PATH = '.github/workflows/ci.yml';
const WRITER_JOB = 'setup';
const NODE_MODULES_CACHE_PATH = 'node_modules';

const doc = load(fs.readFileSync(WORKFLOW_PATH, 'utf8'));

const violations = [];
for (const [jobName, job] of Object.entries(doc.jobs)) {
  for (const step of job.steps ?? []) {
    const uses = step.uses ?? '';
    if (!uses.startsWith('actions/cache')) continue;
    if (step.with?.path !== NODE_MODULES_CACHE_PATH) continue;

    const isReadOnly = uses.startsWith('actions/cache/restore@');
    const shouldBeReadOnly = jobName !== WRITER_JOB;
    if (shouldBeReadOnly && !isReadOnly) {
      violations.push(
        `job "${jobName}" caches node_modules via "${uses.split('@')[0]}" — only "${WRITER_JOB}" ` +
          `may use the read+write actions/cache action; every other job must use actions/cache/restore`,
      );
    } else if (!shouldBeReadOnly && isReadOnly) {
      violations.push(
        `job "${WRITER_JOB}" caches node_modules via a read-only actions/cache/restore step — ` +
          `it must use the read+write actions/cache action, since it's the sole writer of this cache key`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error(`${WORKFLOW_PATH}: node_modules cache usage violations:\n`);
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log(`${WORKFLOW_PATH}: node_modules cache usage OK (sole writer: "${WRITER_JOB}").`);
