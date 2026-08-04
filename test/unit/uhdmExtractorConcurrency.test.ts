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

  // Regression test: the lock used to be released as soon as Surelog finished, before the
  // backend had read the shared .uhdm file. A second caller with a *different* fingerprint
  // (so it can't cache-hit) would then be free to start a new Surelog run against the same
  // cacheDir and overwrite/truncate the file while the first caller's backend was still
  // reading it. The fake backend below reads the file twice with a delay in between and
  // fails if the content changed out from under it, which is what a still-running Surelog
  // overwrite would look like.
  it('keeps the shared .uhdm file stable while the backend reads it, even with a queued caller of a different fingerprint', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'svsch-race-backend-'));

    try {
      const srcFileA = path.join(tmpDir, 'a.sv');
      const srcFileB = path.join(tmpDir, 'b.sv');
      await fs.writeFile(srcFileA, 'module a(); endmodule\n');
      await fs.writeFile(srcFileB, 'module b(); endmodule\n');

      const fakeSurelog = path.join(tmpDir, 'fake-surelog.js');
      await writeExecutable(fakeSurelog, `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const outDir = args[args.indexOf('-o') + 1];
const srcFile = args[args.length - 1];
fs.mkdirSync(path.join(outDir, 'slpp_unit'), { recursive: true });
fs.writeFileSync(path.join(outDir, 'slpp_unit', 'surelog.uhdm'), 'uhdm-for-' + path.basename(srcFile));
`);

      const fakeBackend = path.join(tmpDir, 'fake-backend.js');
      await writeExecutable(fakeBackend, `#!/usr/bin/env node
const fs = require('fs');
const uhdmFile = process.argv[2];
const first = fs.readFileSync(uhdmFile, 'utf-8');
// Simulate a slow backend parse, giving a queued caller with a different
// fingerprint a window to (incorrectly) start overwriting the shared file
// if it were not still held by the lock.
const until = Date.now() + 300;
while (Date.now() < until) { /* busy wait */ }
const second = fs.readFileSync(uhdmFile, 'utf-8');
if (first !== second) {
  process.stderr.write('RACE DETECTED: uhdm file changed during backend read\\n');
  process.exit(1);
}
process.stdout.write(JSON.stringify({ modules: [], rootModules: [] }));
`);

      // Different files (and thus different fingerprints) so the second call can't cache-hit
      // and must queue behind the first's full cache-check + Surelog + backend section.
      await expect(Promise.all([
        extractDesignWithUhdm([srcFileA], tmpDir, fakeSurelog, fakeBackend),
        extractDesignWithUhdm([srcFileB], tmpDir, fakeSurelog, fakeBackend)
      ])).resolves.toHaveLength(2);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
