import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildDesignGraph } from '../../src/parser/backend';

// Building the real Surelog/backend binaries isn't practical here, so these tests use tiny
// fake executables in their place: a fake "surelog" that records its argv and writes the
// expected output file, and a fake backend that emits a minimal valid UHDM IR document. This
// still exercises the real svsch.fileList wiring in backend.ts/uhdmExtractor.ts (filelist
// parsing, fingerprinting, and the -f flag) — only the two subprocesses are stubbed.
async function writeExecutable(filePath: string, content: string): Promise<void> {
  await fs.writeFile(filePath, content);
  await fs.chmod(filePath, 0o755);
}

async function writeFakeSurelog(filePath: string, argvLogFile: string): Promise<void> {
  await writeExecutable(
    filePath,
    `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(argvLogFile)}, JSON.stringify({ args, cwd: process.cwd() }) + '\\n');
const outDir = args[args.indexOf('-o') + 1];
fs.mkdirSync(path.join(outDir, 'slpp_unit'), { recursive: true });
fs.writeFileSync(path.join(outDir, 'slpp_unit', 'surelog.uhdm'), 'fake-uhdm');
`,
  );
}

async function writeFakeBackend(filePath: string): Promise<void> {
  await writeExecutable(
    filePath,
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ modules: [], rootModules: [] }));
`,
  );
}

describe('svsch.fileList', () => {
  it('reports a diagnostic and skips Surelog when the filelist does not exist', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'svsch-filelist-'));
    try {
      const argvLog = path.join(tmpDir, 'argv.log');
      const fakeSurelog = path.join(tmpDir, 'fake-surelog.js');
      const fakeBackend = path.join(tmpDir, 'fake-backend.js');
      await writeFakeSurelog(fakeSurelog, argvLog);
      await writeFakeBackend(fakeBackend);

      const graph = await buildDesignGraph({
        workspaceRoot: tmpDir,
        projectFolder: '.',
        backend: 'uhdm',
        veriblePath: 'verible-verilog-syntax',
        surelogPath: fakeSurelog,
        backendPath: fakeBackend,
        fileList: 'missing.f',
      });

      expect(graph.diagnostics).toHaveLength(1);
      expect(graph.diagnostics[0].severity).toBe('error');
      expect(graph.diagnostics[0].message).toContain('missing.f');
      await expect(fs.access(argvLog)).rejects.toThrow();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('warns when the filelist resolves to no source files', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'svsch-filelist-'));
    try {
      const fileListPath = path.join(tmpDir, 'project.f');
      await fs.writeFile(fileListPath, '# just a comment\n\n-I../include\n+define+FOO\n');

      const graph = await buildDesignGraph({
        workspaceRoot: tmpDir,
        projectFolder: '.',
        backend: 'uhdm',
        veriblePath: 'verible-verilog-syntax',
        surelogPath: 'unused',
        backendPath: 'unused',
        fileList: 'project.f',
      });

      expect(graph.diagnostics).toHaveLength(1);
      expect(graph.diagnostics[0].severity).toBe('warning');
      expect(graph.diagnostics[0].message).toContain('project.f');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('invokes Surelog with -f <path> instead of a positional file list', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'svsch-filelist-'));
    try {
      const srcDir = path.join(tmpDir, 'src');
      await fs.mkdir(srcDir, { recursive: true });
      const topFile = path.join(srcDir, 'top.sv');
      await fs.writeFile(topFile, 'module top(); endmodule\n');

      const fileListPath = path.join(tmpDir, 'project.f');
      await fs.writeFile(fileListPath, 'src/top.sv\n');

      const argvLog = path.join(tmpDir, 'argv.log');
      const fakeSurelog = path.join(tmpDir, 'fake-surelog.js');
      const fakeBackend = path.join(tmpDir, 'fake-backend.js');
      await writeFakeSurelog(fakeSurelog, argvLog);
      await writeFakeBackend(fakeBackend);

      const graph = await buildDesignGraph({
        workspaceRoot: tmpDir,
        projectFolder: '.',
        backend: 'uhdm',
        veriblePath: 'verible-verilog-syntax',
        surelogPath: fakeSurelog,
        backendPath: fakeBackend,
        fileList: 'project.f',
      });

      expect(graph.diagnostics).toHaveLength(0);
      const { args: invocation, cwd } = JSON.parse((await fs.readFile(argvLog, 'utf-8')).trim());
      expect(invocation).toContain('-f');
      expect(invocation[invocation.indexOf('-f') + 1]).toBe(fileListPath);
      expect(invocation).not.toContain(topFile);
      // Surelog resolves relative paths inside a `-f` filelist against its own process cwd, not
      // against the filelist's location, so it must be spawned from the filelist's directory.
      expect(cwd).toBe(path.dirname(fileListPath));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('spawns Surelog from the filelist directory even when workspace root differs', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'svsch-filelist-'));
    try {
      const projectDir = path.join(tmpDir, 'project');
      await fs.mkdir(projectDir, { recursive: true });
      await fs.writeFile(path.join(projectDir, 'top.sv'), 'module top(); endmodule\n');

      const fileListPath = path.join(projectDir, 'project.f');
      // Relative to the filelist's own directory, not to workspaceRoot or process.cwd().
      await fs.writeFile(fileListPath, 'top.sv\n');

      const argvLog = path.join(tmpDir, 'argv.log');
      const fakeSurelog = path.join(tmpDir, 'fake-surelog.js');
      const fakeBackend = path.join(tmpDir, 'fake-backend.js');
      await writeFakeSurelog(fakeSurelog, argvLog);
      await writeFakeBackend(fakeBackend);

      const graph = await buildDesignGraph({
        workspaceRoot: tmpDir,
        projectFolder: '.',
        backend: 'uhdm',
        veriblePath: 'verible-verilog-syntax',
        surelogPath: fakeSurelog,
        backendPath: fakeBackend,
        fileList: 'project/project.f',
      });

      expect(graph.diagnostics).toHaveLength(0);
      const { cwd } = JSON.parse((await fs.readFile(argvLog, 'utf-8')).trim());
      expect(cwd).toBe(projectDir);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('additively passes includePaths/defines alongside -f', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'svsch-filelist-'));
    try {
      const topFile = path.join(tmpDir, 'top.sv');
      await fs.writeFile(topFile, 'module top(); endmodule\n');

      const fileListPath = path.join(tmpDir, 'project.f');
      await fs.writeFile(fileListPath, 'top.sv\n');

      const argvLog = path.join(tmpDir, 'argv.log');
      const fakeSurelog = path.join(tmpDir, 'fake-surelog.js');
      const fakeBackend = path.join(tmpDir, 'fake-backend.js');
      await writeFakeSurelog(fakeSurelog, argvLog);
      await writeFakeBackend(fakeBackend);

      await buildDesignGraph({
        workspaceRoot: tmpDir,
        projectFolder: '.',
        backend: 'uhdm',
        veriblePath: 'verible-verilog-syntax',
        surelogPath: fakeSurelog,
        backendPath: fakeBackend,
        fileList: 'project.f',
        includePaths: ['include'],
        defines: { FOO: '1' },
      });

      const { args: invocation } = JSON.parse((await fs.readFile(argvLog, 'utf-8')).trim());
      expect(invocation.some((a: string) => a.startsWith('-I') && a.endsWith('include'))).toBe(
        true,
      );
      expect(invocation).toContain('+define+FOO=1');
      expect(invocation).toContain('-f');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('re-runs Surelog when a listed source changes without touching the .f file', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'svsch-filelist-'));
    try {
      const topFile = path.join(tmpDir, 'top.sv');
      await fs.writeFile(topFile, 'module top(); endmodule\n');

      const fileListPath = path.join(tmpDir, 'project.f');
      await fs.writeFile(fileListPath, 'top.sv\n');

      const argvLog = path.join(tmpDir, 'argv.log');
      const fakeSurelog = path.join(tmpDir, 'fake-surelog.js');
      const fakeBackend = path.join(tmpDir, 'fake-backend.js');
      await writeFakeSurelog(fakeSurelog, argvLog);
      await writeFakeBackend(fakeBackend);

      const buildOnce = () =>
        buildDesignGraph({
          workspaceRoot: tmpDir,
          projectFolder: '.',
          backend: 'uhdm',
          veriblePath: 'verible-verilog-syntax',
          surelogPath: fakeSurelog,
          backendPath: fakeBackend,
          fileList: 'project.f',
        });

      await buildOnce();
      const invocationsAfterFirst = (await fs.readFile(argvLog, 'utf-8')).trim().split('\n').length;
      expect(invocationsAfterFirst).toBe(1);

      // Cache hit: same fingerprint, filelist and listed source both untouched.
      await buildOnce();
      const invocationsAfterCacheHit = (await fs.readFile(argvLog, 'utf-8'))
        .trim()
        .split('\n').length;
      expect(invocationsAfterCacheHit).toBe(1);

      // Bump the listed source's mtime without touching project.f itself.
      await new Promise((resolve) => setTimeout(resolve, 10));
      await fs.writeFile(topFile, 'module top(); endmodule\n\n');

      await buildOnce();
      const invocationsAfterSourceEdit = (await fs.readFile(argvLog, 'utf-8'))
        .trim()
        .split('\n').length;
      expect(invocationsAfterSourceEdit).toBe(2);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
