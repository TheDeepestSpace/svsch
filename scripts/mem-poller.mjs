// Samples RSS (bytes) of a whole process tree at a fixed interval while a
// wrapped command runs, then dumps the {t, rss} timeseries as JSON once it
// exits — the CI-side half of #400's memory profiling: one of these wraps
// each visual/BDD shard and each system vscode_version leg's test run, so a
// spike (not just a leak) shows up in the recorded data even though the
// process itself never crashes.
//
// Walks the full /proc tree rooted at the wrapped command's own pid rather
// than just polling that one pid — Electron/Chromium (VS Code, its extension
// host, and every renderer/GPU process it spawns) fan out into many
// processes per run, so summing only the top pid would silently undercount
// from the moment the first child appears.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pidusage from 'pidusage';

const DEFAULT_INTERVAL_MS = 250;
const MIN_INTERVAL_MS = 100;
const MAX_INTERVAL_MS = 500;

// Clamped to the 100-500ms band #400 calls for, regardless of what
// MEM_POLL_INTERVAL_MS is set to — a misconfigured env var should degrade to
// the nearest valid rate rather than either busy-looping or sampling so
// coarsely a spike falls between samples.
export function resolveIntervalMs(envValue = process.env.MEM_POLL_INTERVAL_MS) {
  const parsed = Number(envValue);
  if (!Number.isFinite(parsed)) return DEFAULT_INTERVAL_MS;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, parsed));
}

function listProcPids() {
  try {
    return fs
      .readdirSync('/proc')
      .filter((name) => /^\d+$/.test(name))
      .map(Number);
  } catch {
    // /proc unavailable (non-Linux) — callers just see an empty tree.
    return [];
  }
}

// /proc/<pid>/stat's 2nd field is the ppid, but the 1st (comm, in
// parentheses) can itself contain spaces or parens — split on the *last* ')'
// rather than naively splitting the whole line on spaces, same fix
// pidusage's own procfile.js applies for the same reason.
export function readPpid(pid) {
  try {
    const raw = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const afterComm = raw.slice(raw.lastIndexOf(')') + 2);
    const ppid = Number(afterComm.split(' ')[1]);
    return Number.isFinite(ppid) ? ppid : null;
  } catch {
    // Gone by the time we read it, or unreadable (different uid) — either
    // way it's not a descendant we can report on.
    return null;
  }
}

// Every pid descended from rootPid (itself included), as of this call —
// walked fresh each sample rather than cached, since the tree's shape
// changes throughout a run as browser/renderer processes come and go.
export function listDescendantPids(rootPid) {
  const childrenByPpid = new Map();
  for (const pid of listProcPids()) {
    const ppid = readPpid(pid);
    if (ppid === null) continue;
    if (!childrenByPpid.has(ppid)) childrenByPpid.set(ppid, []);
    childrenByPpid.get(ppid).push(pid);
  }
  const descendants = [];
  const stack = [rootPid];
  while (stack.length > 0) {
    const pid = stack.pop();
    descendants.push(pid);
    stack.push(...(childrenByPpid.get(pid) ?? []));
  }
  return descendants;
}

// Sums RSS (bytes) across every currently-live pid in the tree. pidusage's
// batch form tolerates individual dead pids (a process that exited between
// listDescendantPids and this call) by just omitting them from the result
// rather than failing the whole sample — the outer catch only guards the
// single-pid case, where pidusage doesn't have a second entry to fall back
// on and rejects instead.
export async function sampleTreeRssBytes(rootPid) {
  const pids = listDescendantPids(rootPid);
  if (pids.length === 0) return 0;
  const statsByPid = await pidusage(pids).catch(() => ({}));
  return Object.values(statsByPid).reduce((sum, stat) => sum + (stat?.memory ?? 0), 0);
}

// Recursive setTimeout rather than setInterval — pidusage's own docs warn a
// slow sample (procfs read + parse across a wide tree) can overlap the next
// tick under setInterval; scheduling the next sample only after the current
// one resolves rules that out.
function startPolling(rootPid, intervalMs, onSample) {
  let stopped = false;
  let timer = null;
  const tick = () => {
    timer = setTimeout(async () => {
      try {
        onSample(await sampleTreeRssBytes(rootPid));
      } catch {
        // A failed sample is one fewer data point, not a reason to bring
        // down the test run it's riding alongside.
      }
      if (!stopped) tick();
    }, intervalMs);
  };
  tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

// Spawns `command`, polls its process tree's RSS until it exits, writes the
// {t, rss} timeseries to outputFile, and returns the child's own exit code
// (so the CI step's pass/fail still reflects the wrapped test run, not the
// poller).
export async function runWithMemoryProfile({ outputFile, command, args, intervalMs }) {
  const startedAtMs = Date.now();
  const samples = [];
  const child = spawn(command, args, { stdio: 'inherit' });

  const stopPolling = startPolling(child.pid, intervalMs, (rss) => {
    samples.push({ t: Date.now() - startedAtMs, rss });
  });

  const forwardSignal = (signal) => {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  };
  process.on('SIGINT', forwardSignal);
  process.on('SIGTERM', forwardSignal);

  const exitCode = await new Promise((resolve) => {
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    child.on('error', () => resolve(1));
  });

  stopPolling();
  process.off('SIGINT', forwardSignal);
  process.off('SIGTERM', forwardSignal);

  fs.mkdirSync(path.dirname(outputFile) || '.', { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify(samples), 'utf8');
  console.log(`Wrote ${samples.length} RSS sample(s) to ${outputFile}`);

  return exitCode;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const [outputFile, sep, command, ...args] = process.argv.slice(2);
  if (!outputFile || sep !== '--' || !command) {
    console.error('Usage: node scripts/mem-poller.mjs <output-file> -- <command> [args...]');
    process.exitCode = 2;
  } else {
    process.exitCode = await runWithMemoryProfile({
      outputFile,
      command,
      args,
      intervalMs: resolveIntervalMs(),
    });
  }
}
