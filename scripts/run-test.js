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

// Compute per-worktree visual server port to prevent port collisions between worktrees
if (!process.env.SVSCH_VISUAL_PORT) {
  let hash = 0;
  for (let i = 0; i < WORKSPACE_ROOT.length; i++) {
    hash = (hash * 31 + WORKSPACE_ROOT.charCodeAt(i)) & 0x7fffffff;
  }
  process.env.SVSCH_VISUAL_PORT = String(5174 + (hash % 100));
}

// Check which components need build
function getOutdatedComponents() {
  const outdated = [];

  function isOutdated(targetFile, srcDir, excludes, filterRegex, configFiles) {
    if (!fs.existsSync(targetFile)) return true;
    const targetMtime = fs.statSync(targetFile).mtimeMs;
    for (const cfg of configFiles) {
      if (fs.existsSync(cfg) && fs.statSync(cfg).mtimeMs > targetMtime) return true;
    }
    const srcMtime = getLatestMtime(srcDir, excludes, filterRegex);
    return srcMtime > targetMtime;
  }

  // 1. Extension
  const extensionOut = path.join(WORKSPACE_ROOT, 'dist', 'extension.js');
  if (isOutdated(
    extensionOut,
    path.join(WORKSPACE_ROOT, 'src'),
    [
      path.join(WORKSPACE_ROOT, 'src', 'webview'),
      path.join(WORKSPACE_ROOT, 'src', 'cli'),
      path.join(WORKSPACE_ROOT, 'src', 'parser', 'backend_cpp'),
    ],
    /\.ts$/,
    [
      path.join(WORKSPACE_ROOT, 'package.json'),
      path.join(WORKSPACE_ROOT, 'tsconfig.json'),
      path.join(WORKSPACE_ROOT, 'tsconfig.extension.json')
    ]
  )) {
    outdated.push({ name: 'extension' });
  }

  // 2. Webview
  const webviewOut = path.join(WORKSPACE_ROOT, 'media', 'webview.js');
  if (isOutdated(
    webviewOut,
    path.join(WORKSPACE_ROOT, 'src', 'webview'),
    [],
    /\.(ts|tsx|js|jsx|css|html)$/,
    [
      path.join(WORKSPACE_ROOT, 'package.json'),
      path.join(WORKSPACE_ROOT, 'tsconfig.json'),
      path.join(WORKSPACE_ROOT, 'tsconfig.webview.json'),
      path.join(WORKSPACE_ROOT, 'vite.config.ts'),
      path.join(WORKSPACE_ROOT, 'index.html')
    ]
  )) {
    outdated.push({ name: 'webview' });
  }

  // 3. CLI
  const cliOut = path.join(WORKSPACE_ROOT, 'dist', 'cli.js');
  if (isOutdated(
    cliOut,
    path.join(WORKSPACE_ROOT, 'src', 'cli'),
    [],
    /\.ts$/,
    [
      path.join(WORKSPACE_ROOT, 'package.json'),
      path.join(WORKSPACE_ROOT, 'tsconfig.json'),
      path.join(WORKSPACE_ROOT, 'tsconfig.cli.json'),
      path.join(WORKSPACE_ROOT, 'vite.config.cli.ts')
    ]
  )) {
    outdated.push({ name: 'cli' });
  }

  // 4. Backend
  const backendOut = path.join(WORKSPACE_ROOT, 'dist', 'svsch_backend');
  if (isOutdated(
    backendOut,
    path.join(WORKSPACE_ROOT, 'src', 'parser', 'backend_cpp'),
    [path.join(WORKSPACE_ROOT, 'src', 'parser', 'backend_cpp', 'build')],
    /\.(cpp|h|hpp|txt)$/,
    [
      path.join(WORKSPACE_ROOT, 'src', 'parser', 'backend_cpp', 'CMakeLists.txt')
    ]
  )) {
    outdated.push({ name: 'backend' });
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
  } else if (suite === 'syntax') {
    console.log(`[SVSCH Test Runner] Running Playwright syntax-book tests...`);
    const cmd = ['playwright', 'test', '--config', 'test/syntax-book/playwright.config.ts', ...extraArgs];
    const res = spawnSync(cmd[0], cmd.slice(1), { cwd: WORKSPACE_ROOT, stdio: 'inherit', env: process.env });
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
