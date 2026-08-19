const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const versionsFile = path.join(WORKSPACE_ROOT, 'vscode-versions.json');
const versions = JSON.parse(fs.readFileSync(versionsFile, 'utf8'));
const extraArgs = process.argv.slice(2);

console.log(
  `[SVSCH System Test Orchestrator] Testing across VS Code versions: ${versions.join(', ')}...`,
);
let exitCode = 0;

for (const v of versions) {
  console.log(`\n--- Testing VSCode ${v} ---`);
  const cmd = [
    'env',
    '-u',
    'ELECTRON_RUN_AS_NODE',
    'xvfb-run',
    '--auto-servernum',
    'playwright',
    'test',
    '--config',
    'test/system/playwright.config.ts',
    ...extraArgs,
  ];
  const res = spawnSync(cmd[0], cmd.slice(1), {
    cwd: WORKSPACE_ROOT,
    stdio: 'inherit',
    env: { ...process.env, VSCODE_VERSION: v },
  });
  if (res.status !== 0) {
    exitCode = res.status !== null ? res.status : 1;
    break;
  }
}

process.exit(exitCode);
