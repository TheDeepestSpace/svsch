import path from 'node:path';
import { releasePlaywrightLock } from './playwrightGlobalLock';
import { finalizeNamedBenchmarkSamples } from './benchmarkUtils';

const root = path.resolve(__dirname, '..');

// One entry per recordNamedBenchmarkSample() log this shared teardown might
// need to collapse into its benchmark.json — paths are duplicated (not
// imported) from where each suite records samples (test/visual/helper.ts) so
// this file doesn't pull in that suite's heavier runtime deps. Suites the
// current run didn't exercise simply have no samples log on disk and are
// skipped.
const BENCHMARK_SAMPLE_LOGS = [
  {
    samplesLogFile: path.join(
      root,
      'test-results/visual/artifacts/diagram-elaboration-samples.log',
    ),
    benchmarkFile: path.join(root, 'test-results/visual/artifacts/benchmark-elaboration.json'),
  },
  {
    samplesLogFile: path.join(root, 'test-results/visual/artifacts/diagram-render-samples.log'),
    benchmarkFile: path.join(root, 'test-results/visual/artifacts/benchmark-rendering.json'),
  },
];

export default async function globalTeardown() {
  try {
    for (const { samplesLogFile, benchmarkFile } of BENCHMARK_SAMPLE_LOGS) {
      finalizeNamedBenchmarkSamples(samplesLogFile, benchmarkFile);
    }
  } finally {
    releasePlaywrightLock();
  }
}
