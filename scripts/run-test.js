const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const readline = require('readline');

const LOCK_FILE = '/tmp/svsch-global-test.lock';
const STATUS_FILE = '/tmp/svsch-global-test-status.json';

const WORKSPACE_ROOT = path.resolve(__dirname, '..');

// Helper to get latest mtime recursively
function getLatestMtime(dir, excludePaths = [], filterRegex = null) {
  let latest = 0;
  function traverse(current) {
    if (!fs.existsSync(current)) return;
    let stats;
    try {
      stats = fs.statSync(current);
    } catch (e) {
      return; // Ignore permission/missing file issues
    }
    if (stats.isDirectory()) {
      if (excludePaths.some(p => current === p || current.startsWith(p + path.sep))) {
        return;
      }
      let files;
      try {
        files = fs.readdirSync(current);
      } catch (e) {
        return;
      }
      for (const file of files) {
        traverse(path.join(current, file));
      }
    } else {
      if (!filterRegex || filterRegex.test(current)) {
        if (stats.mtimeMs > latest) {
          latest = stats.mtimeMs;
        }
      }
    }
  }
  traverse(dir);
  return latest;
}

// Check which components need build
function getOutdatedComponents() {
  const outdated = [];

  // 1. Extension
  const extensionSrcDir = path.join(WORKSPACE_ROOT, 'src');
  const extensionExcludes = [
    path.join(WORKSPACE_ROOT, 'src', 'webview'),
    path.join(WORKSPACE_ROOT, 'src', 'cli'),
    path.join(WORKSPACE_ROOT, 'src', 'parser', 'backend_cpp'),
  ];
  const extensionOut = path.join(WORKSPACE_ROOT, 'dist', 'extension.js');
  const extensionSrcMtime = getLatestMtime(extensionSrcDir, extensionExcludes, /\.ts$/);
  const extensionOutMtime = fs.existsSync(extensionOut) ? fs.statSync(extensionOut).mtimeMs : 0;
  if (extensionSrcMtime > extensionOutMtime || extensionOutMtime === 0) {
    outdated.push({ name: 'extension', mtimeSrc: extensionSrcMtime, mtimeOut: extensionOutMtime });
  }

  // 2. Webview
  const webviewSrcDir = path.join(WORKSPACE_ROOT, 'src', 'webview');
  const webviewOut = path.join(WORKSPACE_ROOT, 'media', 'webview.js');
  const webviewSrcMtime = getLatestMtime(webviewSrcDir, [], /\.(ts|tsx|js|jsx|css|html)$/);
  const webviewOutMtime = fs.existsSync(webviewOut) ? fs.statSync(webviewOut).mtimeMs : 0;
  if (webviewSrcMtime > webviewOutMtime || webviewOutMtime === 0) {
    outdated.push({ name: 'webview', mtimeSrc: webviewSrcMtime, mtimeOut: webviewOutMtime });
  }

  // 3. CLI
  const cliSrcDir = path.join(WORKSPACE_ROOT, 'src', 'cli');
  const cliOut = path.join(WORKSPACE_ROOT, 'dist', 'cli.js');
  const cliSrcMtime = getLatestMtime(cliSrcDir, [], /\.ts$/);
  const cliOutMtime = fs.existsSync(cliOut) ? fs.statSync(cliOut).mtimeMs : 0;
  if (cliSrcMtime > cliOutMtime || cliOutMtime === 0) {
    outdated.push({ name: 'cli', mtimeSrc: cliSrcMtime, mtimeOut: cliOutMtime });
  }

  // 4. Backend
  const backendSrcDir = path.join(WORKSPACE_ROOT, 'src', 'parser', 'backend_cpp');
  const backendExcludes = [
    path.join(WORKSPACE_ROOT, 'src', 'parser', 'backend_cpp', 'build')
  ];
  const backendOut = path.join(WORKSPACE_ROOT, 'dist', 'svsch_backend');
  const backendSrcMtime = getLatestMtime(backendSrcDir, backendExcludes, /\.(cpp|h|hpp|txt)$/);
  const backendOutMtime = fs.existsSync(backendOut) ? fs.statSync(backendOut).mtimeMs : 0;
  if (backendSrcMtime > backendOutMtime || backendOutMtime === 0) {
    outdated.push({ name: 'backend', mtimeSrc: backendSrcMtime, mtimeOut: backendOutMtime });
  }

  return outdated;
}

// Build helper
function buildComponent(name) {
  console.log(`[SVSCH Test Runner] Building outdated component: ${name}...`);
  if (name === 'backend') {
    execSync('npm run compile:backend', { cwd: WORKSPACE_ROOT, stdio: 'inherit' });
  } else if (name === 'webview') {
    execSync('npm run build:webview', { cwd: WORKSPACE_ROOT, stdio: 'inherit' });
  } else if (name === 'extension') {
    execSync('npm run build:extension', { cwd: WORKSPACE_ROOT, stdio: 'inherit' });
  } else if (name === 'cli') {
    execSync('npm run build:cli', { cwd: WORKSPACE_ROOT, stdio: 'inherit' });
  }
}

// Draw progress bar helper
function getProgressBar(completed, total) {
  if (!total) return '';
  const percentage = Math.round((completed / total) * 100);
  const width = 20;
  const filledWidth = Math.min(width, Math.round((completed / total) * width));
  const emptyWidth = Math.max(0, width - filledWidth);
  const bar = '█'.repeat(filledWidth) + '░'.repeat(emptyWidth);
  return `Progress: [${bar}] ${percentage}% (${completed}/${total} tests completed)`;
}

// Stale lock checking
function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true; // Still running
  } catch (err) {
    return err.code === 'EPERM'; // Running but owned by different user
  }
}

// Acquire lock
function acquireLock(suiteName) {
  let waiting = false;
  let printLines = 0;
  const displayCommand = suiteName.startsWith('test:') ? suiteName : `test:${suiteName}`;

  while (true) {
    try {
      const fd = fs.openSync(LOCK_FILE, 'wx');
      const lockData = {
        pid: process.pid,
        worktree: WORKSPACE_ROOT,
        command: displayCommand,
        timestamp: Date.now()
      };
      fs.writeSync(fd, JSON.stringify(lockData, null, 2));
      fs.closeSync(fd);

      if (waiting) {
        readline.moveCursor(process.stdout, 0, -printLines);
        readline.clearScreenDown(process.stdout);
      }
      console.log(`[SVSCH Test Runner] Lock acquired successfully.`);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') {
        throw err;
      }
      
      let lockData;
      try {
        lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      } catch (readErr) {
        try {
          fs.unlinkSync(LOCK_FILE);
        } catch (uErr) {}
        continue;
      }

      if (!isPidAlive(lockData.pid)) {
        console.log(`[SVSCH Test Runner] Found stale lock from dead PID ${lockData.pid}. Breaking lock...`);
        try {
          fs.unlinkSync(LOCK_FILE);
        } catch (uErr) {}
        continue;
      }

      if (!waiting) {
        console.log(`[SVSCH Test Runner] Waiting for active lock...`);
        waiting = true;
      }

      let progressStr = '';
      if (fs.existsSync(STATUS_FILE)) {
        try {
          const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
          if (status.total && status.pid === lockData.pid) {
            progressStr = '\n' + getProgressBar(status.completed, status.total);
          }
        } catch (statusErr) {}
      }

      if (printLines > 0) {
        readline.moveCursor(process.stdout, 0, -printLines);
        readline.clearScreenDown(process.stdout);
      }

      const waitingMsg = `[SVSCH Test Runner] Waiting for Worktree '${lockData.worktree}' running '${lockData.command}' (PID ${lockData.pid})...`;
      process.stdout.write(waitingMsg + progressStr + '\n');
      printLines = 1 + (progressStr ? 1 : 0);

      try {
        execSync('sleep 1', { stdio: 'ignore' });
      } catch (sleepErr) {}
    }
  }
}

// Release lock
function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      if (lockData.pid === process.pid) {
        fs.unlinkSync(LOCK_FILE);
      }
    }
  } catch (err) {}
  try {
    if (fs.existsSync(STATUS_FILE)) {
      const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
      if (status.pid === process.pid) {
        fs.unlinkSync(STATUS_FILE);
      }
    }
  } catch (err) {}
}

// Register exit handlers
process.on('exit', releaseLock);
process.on('SIGINT', () => {
  releaseLock();
  process.exit(130);
});
process.on('SIGTERM', () => {
  releaseLock();
  process.exit(143);
});
process.on('uncaughtException', (err) => {
  console.error('[SVSCH Test Runner] Uncaught Exception:', err);
  releaseLock();
  process.exit(1);
});

const args = process.argv.slice(2);
const suite = args[0];
const extraArgs = args.slice(1);

if (!suite) {
  console.error('Usage: node scripts/run-test.js <suite> [extra-args]');
  process.exit(1);
}

console.log(`[SVSCH Test Runner] Checking if rebuild is needed...`);
const outdated = getOutdatedComponents();
if (outdated.length > 0) {
  console.log(`[SVSCH Test Runner] Outdated components: ${outdated.map(o => o.name).join(', ')}`);
} else {
  console.log(`[SVSCH Test Runner] All components up to date.`);
}

acquireLock(suite);

// Perform builds inside lock
for (const comp of outdated) {
  buildComponent(comp.name);
}

// Ensure surelog is installed
if (!fs.existsSync(path.join(WORKSPACE_ROOT, 'dist', 'surelog'))) {
  console.log(`[SVSCH Test Runner] dist/surelog not found. Installing...`);
  execSync('SURELOG_AUTO_INSTALL=1 npm run install-surelog', { cwd: WORKSPACE_ROOT, stdio: 'inherit' });
}

process.env.SVSCH_TEST_STATUS_FILE = STATUS_FILE;
process.env.SVSCH_RUNNER_PID = process.pid;

try {
  fs.writeFileSync(STATUS_FILE, JSON.stringify({
    total: 0,
    completed: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    pid: process.pid,
    timestamp: Date.now()
  }, null, 2));
} catch (e) {}

let exitCode = 0;

try {
  if (suite === 'bdd') {
    console.log(`[SVSCH Test Runner] Running bddgen...`);
    execSync('npx bddgen --config test/bdd/playwright.config.ts', { cwd: WORKSPACE_ROOT, stdio: 'inherit' });
    console.log(`[SVSCH Test Runner] Running Playwright BDD tests...`);
    const cmd = ['env', '-u', 'ELECTRON_RUN_AS_NODE', 'xvfb-run', '--auto-servernum', 'playwright', 'test', '--config', 'test/bdd/playwright.config.ts', ...extraArgs];
    const res = spawnSync(cmd[0], cmd.slice(1), { cwd: WORKSPACE_ROOT, stdio: 'inherit' });
    exitCode = res.status !== null ? res.status : 1;
  } else if (suite === 'visual') {
    console.log(`[SVSCH Test Runner] Running Playwright visual tests...`);
    const cmd = ['playwright', 'test', ...extraArgs];
    const res = spawnSync(cmd[0], cmd.slice(1), { cwd: WORKSPACE_ROOT, stdio: 'inherit' });
    exitCode = res.status !== null ? res.status : 1;
  } else if (suite === 'system:single') {
    console.log(`[SVSCH Test Runner] Running Playwright system tests (single)...`);
    const cmd = ['env', '-u', 'ELECTRON_RUN_AS_NODE', 'xvfb-run', '--auto-servernum', 'playwright', 'test', '--config', 'test/system/playwright.config.ts', ...extraArgs];
    const res = spawnSync(cmd[0], cmd.slice(1), { cwd: WORKSPACE_ROOT, stdio: 'inherit' });
    exitCode = res.status !== null ? res.status : 1;
  } else if (suite === 'system') {
    const versionsFile = path.join(WORKSPACE_ROOT, 'vscode-versions.json');
    const versions = JSON.parse(fs.readFileSync(versionsFile, 'utf8'));
    console.log(`[SVSCH Test Runner] Running Playwright system tests across VS Code versions: ${versions.join(', ')}...`);
    for (const v of versions) {
      console.log(`\n--- Testing VSCode ${v} ---`);
      const cmd = ['env', '-u', 'ELECTRON_RUN_AS_NODE', 'xvfb-run', '--auto-servernum', 'playwright', 'test', '--config', 'test/system/playwright.config.ts', ...extraArgs];
      const res = spawnSync(cmd[0], cmd.slice(1), {
        cwd: WORKSPACE_ROOT,
        stdio: 'inherit',
        env: { ...process.env, VSCODE_VERSION: v }
      });
      if (res.status !== 0) {
        exitCode = res.status !== null ? res.status : 1;
        break;
      }
    }
  } else if (suite === 'backend') {
    console.log(`[SVSCH Test Runner] Running C++ backend tests...`);
    const surelogBin = path.join(WORKSPACE_ROOT, 'dist', 'surelog', 'bin');
    const envPath = `${process.env.PATH}${path.delimiter}${surelogBin}`;
    const buildDir = path.join(WORKSPACE_ROOT, 'src', 'parser', 'backend_cpp', 'build');
    fs.mkdirSync(buildDir, { recursive: true });
    
    console.log(`[SVSCH Test Runner] Configuring CMake...`);
    execSync('cmake .. -G Ninja', { cwd: buildDir, stdio: 'inherit', env: { ...process.env, PATH: envPath } });
    
    console.log(`[SVSCH Test Runner] Building svsch_test...`);
    execSync('cmake --build . --target svsch_test', { cwd: buildDir, stdio: 'inherit', env: { ...process.env, PATH: envPath } });
    
    console.log(`[SVSCH Test Runner] Executing svsch_test...`);
    const res = spawnSync('./svsch_test', extraArgs, { cwd: buildDir, stdio: 'inherit', env: { ...process.env, PATH: envPath } });
    exitCode = res.status !== null ? res.status : 1;
  } else if (suite === 'unit') {
    console.log(`[SVSCH Test Runner] Running Vitest unit tests...`);
    const cmd = ['npx', 'vitest', 'run', ...extraArgs];
    const res = spawnSync(cmd[0], cmd.slice(1), { cwd: WORKSPACE_ROOT, stdio: 'inherit' });
    exitCode = res.status !== null ? res.status : 1;
  } else {
    console.error(`[SVSCH Test Runner] Unknown suite: ${suite}`);
    exitCode = 1;
  }
} catch (e) {
  console.error('[SVSCH Test Runner] Error during execution:', e);
  exitCode = 1;
}

process.exit(exitCode);
