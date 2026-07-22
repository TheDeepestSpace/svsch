import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import readline from 'readline';

const LOCK_FILE = '/tmp/svsch-global-test.lock';
const STATUS_FILE = '/tmp/svsch-global-test-status.json';
const WORKSPACE_ROOT = path.resolve(__dirname, '..');

function getLatestMtime(dir: string, excludePaths: string[] = [], filterRegex: RegExp | null = null): number {
  let latest = 0;
  function traverse(current: string) {
    if (!fs.existsSync(current)) return;
    let stats: fs.Stats;
    try {
      stats = fs.statSync(current);
    } catch (e) {
      return;
    }
    if (stats.isDirectory()) {
      if (excludePaths.some(p => current === p || current.startsWith(p + path.sep))) {
        return;
      }
      let files: string[];
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

function isOutdated(targetFile: string, srcDir: string, excludes: string[], filterRegex: RegExp, configFiles: string[]): boolean {
  if (!fs.existsSync(targetFile)) return true;
  const targetMtime = fs.statSync(targetFile).mtimeMs;
  for (const cfg of configFiles) {
    if (fs.existsSync(cfg) && fs.statSync(cfg).mtimeMs > targetMtime) return true;
  }
  const srcMtime = getLatestMtime(srcDir, excludes, filterRegex);
  return srcMtime > targetMtime;
}

function getOutdatedComponents(): string[] {
  const outdated: string[] = [];

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
    outdated.push('extension');
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
    outdated.push('webview');
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
    outdated.push('cli');
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
    outdated.push('backend');
  }

  return outdated;
}

function buildComponent(name: string) {
  console.log(`[SVSCH Playwright Lock] Building outdated component: ${name}...`);
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

function getProgressBar(completed: number, total: number): string {
  if (!total) return '';
  const percentage = Math.round((completed / total) * 100);
  const width = 20;
  const filledWidth = Math.min(width, Math.round((completed / total) * width));
  const emptyWidth = Math.max(0, width - filledWidth);
  const bar = '█'.repeat(filledWidth) + '░'.repeat(emptyWidth);
  return `Progress: [${bar}] ${percentage}% (${completed}/${total} tests completed)`;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err.code === 'EPERM';
  }
}

let cleanHandlersRegistered = false;

function registerCleanExitHandlers() {
  if (cleanHandlersRegistered) return;
  cleanHandlersRegistered = true;
  process.on('exit', releasePlaywrightLock);
  process.on('SIGINT', () => {
    releasePlaywrightLock();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    releasePlaywrightLock();
    process.exit(143);
  });
}

export function acquirePlaywrightLock(suiteName: string) {
  // Compute visual server port deterministically per worktree if not set
  if (!process.env.SVSCH_VISUAL_PORT) {
    let hash = 0;
    for (let i = 0; i < WORKSPACE_ROOT.length; i++) {
      hash = (hash * 31 + WORKSPACE_ROOT.charCodeAt(i)) & 0x7fffffff;
    }
    process.env.SVSCH_VISUAL_PORT = String(5174 + (hash % 100));
  }

  let waiting = false;
  let printLines = 0;

  console.log(`[SVSCH Playwright Lock] Requesting machine-wide lock for '${suiteName}'...`);

  while (true) {
    try {
      const fd = fs.openSync(LOCK_FILE, 'wx');
      const lockData = {
        pid: process.pid,
        worktree: WORKSPACE_ROOT,
        command: suiteName,
        timestamp: Date.now()
      };
      fs.writeSync(fd, JSON.stringify(lockData, null, 2));
      fs.closeSync(fd);

      if (waiting) {
        readline.moveCursor(process.stdout, 0, -printLines);
        readline.clearScreenDown(process.stdout);
      }
      console.log(`[SVSCH Playwright Lock] Lock acquired successfully by PID ${process.pid} (${WORKSPACE_ROOT}).`);
      break;
    } catch (err: any) {
      if (err.code !== 'EEXIST') {
        throw err;
      }

      let lockData: any;
      try {
        lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      } catch (readErr) {
        try { fs.unlinkSync(LOCK_FILE); } catch (uErr) {}
        continue;
      }

      if (!isPidAlive(lockData.pid)) {
        console.log(`[SVSCH Playwright Lock] Found stale lock from dead PID ${lockData.pid}. Breaking lock...`);
        try { fs.unlinkSync(LOCK_FILE); } catch (uErr) {}
        continue;
      }

      if (!waiting) {
        console.log(`[SVSCH Playwright Lock] Waiting for active lock...`);
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

      const waitingMsg = `[SVSCH Playwright Lock] Waiting for Worktree '${lockData.worktree}' running '${lockData.command}' (PID ${lockData.pid})...`;
      process.stdout.write(waitingMsg + progressStr + '\n');
      printLines = 1 + (progressStr ? 1 : 0);

      try {
        execSync('sleep 1', { stdio: 'ignore' });
      } catch (sleepErr) {}
    }
  }

  process.env.SVSCH_TEST_STATUS_FILE = STATUS_FILE;
  process.env.SVSCH_RUNNER_PID = String(process.pid);

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

  const outdated = getOutdatedComponents();
  if (outdated.length > 0) {
    console.log(`[SVSCH Playwright Lock] Outdated components: ${outdated.join(', ')}`);
    for (const comp of outdated) {
      buildComponent(comp);
    }
  } else {
    console.log(`[SVSCH Playwright Lock] All components up to date.`);
  }

  if (!fs.existsSync(path.join(WORKSPACE_ROOT, 'dist', 'surelog'))) {
    console.log(`[SVSCH Playwright Lock] dist/surelog not found. Installing...`);
    execSync('SURELOG_AUTO_INSTALL=1 npm run install-surelog', { cwd: WORKSPACE_ROOT, stdio: 'inherit' });
  }

  registerCleanExitHandlers();
}

export function releasePlaywrightLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const lockData = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
      if (lockData.pid === process.pid) {
        fs.unlinkSync(LOCK_FILE);
        console.log(`[SVSCH Playwright Lock] Lock released cleanly by PID ${process.pid}.`);
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
