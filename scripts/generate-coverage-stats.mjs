import fs from 'node:fs';

// Renders vitest's coverage-summary.json (see vitest.config.ts's
// coverage.reporter) as a markdown table for report_pr_stats to fold into
// the combined PR stats comment — see generate-benchmark-stats.mjs for the
// sibling job this pattern was pulled out of.
const [, , summaryPathArg, outputPathArg] = process.argv;
const summaryPath = summaryPathArg ?? 'coverage/coverage-summary.json';
const outputPath = outputPathArg ?? 'coverage-stats.md';

function formatMetric(metric) {
  if (!metric || metric.pct === 'Unknown') return 'N/A';
  return `${metric.pct.toFixed(2)}% (${metric.covered}/${metric.total})`;
}

let body;
try {
  const { total } = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const table = [
    '| Metric | Coverage |',
    '| --- | --- |',
    `| Statements | ${formatMetric(total.statements)} |`,
    `| Branches | ${formatMetric(total.branches)} |`,
    `| Functions | ${formatMetric(total.functions)} |`,
    `| Lines | ${formatMetric(total.lines)} |`,
  ].join('\n');
  body = ['## Unit test coverage', table].join('\n\n');
} catch (err) {
  // Coverage summary can be missing if the unit test run crashed before
  // vitest finished writing reports (reportOnFailure only covers assertion
  // failures, not a hard crash) — note that in the stats comment instead of
  // failing this job, since coverage reporting isn't itself under test.
  console.error(`Failed to read coverage summary from ${summaryPath}:`, err);
  body = ['## Unit test coverage', '_Coverage summary unavailable for this run._'].join('\n\n');
}

fs.writeFileSync(outputPath, `${body}\n`, 'utf8');
console.log(`Wrote coverage stats to ${outputPath}`);
