import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { extractDesignWithUhdm } from '../../src/parser/uhdmExtractor';

// Regression test for the race where two concurrent extractDesignWithUhdm calls for the
// same workspace (e.g. the initial `open()` rebuild racing a spurious watcher-triggered
// rebuild) each spawned their own Surelog process against the same cacheDir, corrupting
// each other's partial .uhdm output (Cap'n Proto "Premature EOF").
//
// Building the real Surelog/backend binaries isn't practical here, so this uses tiny fake
// executables in their place: a fake "surelog" that records when it starts, sleeps briefly
// (to open a window a real race would fall into), and writes the expected output file; and
// a fake backend that emits a minimal valid UHDM IR document. This still exercises the real
// locking/cache logic in uhdmExtractor.ts — only the two subprocesses are stubbed.
async function writeExecutable(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content);
  await fs.chmod(filePath, 0o755);
}

describe('extractDesignWithUhdm concurrency guard', () => {
  it('serializes concurrent calls for the same cacheDir so Surelog only runs once', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'svsch-race-'));
    const originalLogEnv = process.env.SVSCH_TEST_SURELOG_LOG;

    try {
      const srcFile = path.join(tmpDir, 'top.sv');
      await fs.writeFile(srcFile, 'module top(); endmodule\n');

      const logFile = path.join(tmpDir, 'surelog-invocations.log');
      await fs.writeFile(logFile, '');

      const fakeSurelog = path.join(tmpDir, 'fake-surelog.js');
      await writeExecutable(fakeSurelog, `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const outDir = args[args.indexOf('-o') + 1];
fs.appendFileSync(process.env.SVSCH_TEST_SURELOG_LOG, 'start ' + Date.now() + '\\n');
fs.mkdirSync(path.join(outDir, 'slpp_unit'), { recursive: true });
// Simulate elaboration time long enough that a second, un-serialized call would
// overlap with this one and race on the same output files.
const until = Date.now() + 300;
while (Date.now() < until) { /* busy wait */ }
fs.writeFileSync(path.join(outDir, 'slpp_unit', 'surelog.uhdm'), 'fake-uhdm');
fs.appendFileSync(process.env.SVSCH_TEST_SURELOG_LOG, 'end ' + Date.now() + '\\n');
`);

      const fakeBackend = path.join(tmpDir, 'fake-backend.js');
      await writeExecutable(fakeBackend, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ modules: [], rootModules: [] }));
`);

      process.env.SVSCH_TEST_SURELOG_LOG = logFile;

      const results = await Promise.all([
        extractDesignWithUhdm([srcFile], tmpDir, fakeSurelog, fakeBackend),
        extractDesignWithUhdm([srcFile], tmpDir, fakeSurelog, fakeBackend)
      ]);

      // No crash: both concurrent calls resolved successfully.
      expect(results).toHaveLength(2);
      expect(results[0]).toBeDefined();
      expect(results[1]).toBeDefined();

      const invocations = (await fs.readFile(logFile, 'utf-8'))
        .split('\n')
        .filter((line) => line.startsWith('start'));

      // The second call must reuse the first's Surelog run instead of spawning its own.
      expect(invocations).toHaveLength(1);
    } finally {
      if (originalLogEnv === undefined) {
        delete process.env.SVSCH_TEST_SURELOG_LOG;
      } else {
        process.env.SVSCH_TEST_SURELOG_LOG = originalLogEnv;
      }
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
