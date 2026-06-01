import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import type { DiagramViewModel } from '../ir/types';
import { buildViewModel } from '../layout/mergeLayout';
import { buildDesignGraph, type ParserOptions } from '../parser/backend';
import type { SavedLayout } from '../storage/layoutStore';

export interface RenderDiagramOptions {
  layoutFile?: string;
  topModule?: string;
  noLayout?: boolean;
  workspaceRoot?: string;
  projectFolder?: string;
  surelogPath?: string;
  backendPath?: string;
  includePaths?: string[];
  defines?: Record<string, string>;
  onProgress?: ParserOptions['onProgress'];
}

const EMPTY_LAYOUT: SavedLayout = { version: 1, modules: {} };

export async function renderDiagram(
  svFile: string,
  opts: RenderDiagramOptions = {}
): Promise<DiagramViewModel> {
  const svFilePath = path.resolve(svFile);
  await assertReadableFile(svFilePath);

  const { workspaceRoot, projectFolder } = resolveProjectScope(svFilePath, opts);
  const graph = await buildDesignGraph({
    workspaceRoot,
    projectFolder,
    backend: 'uhdm',
    veriblePath: 'verible-verilog-syntax',
    surelogPath: resolveSurelogPath(opts.surelogPath),
    backendPath: resolveBackendPath(opts.backendPath),
    includePaths: opts.includePaths,
    defines: opts.defines,
    includeExternalDiagnostics: true,
    onProgress: opts.onProgress
  });

  const moduleName = opts.topModule
    ?? graph.rootModules[0]
    ?? Object.keys(graph.modules)[0]
    ?? path.basename(svFilePath, path.extname(svFilePath));
  const layout = opts.noLayout ? EMPTY_LAYOUT : await readLayoutForFile(svFilePath, workspaceRoot, opts.layoutFile);

  return buildViewModel(graph, moduleName, layout);
}

function resolveProjectScope(
  svFilePath: string,
  opts: RenderDiagramOptions
): { workspaceRoot: string; projectFolder: string } {
  if (opts.workspaceRoot || opts.projectFolder) {
    const workspaceRoot = path.resolve(opts.workspaceRoot ?? process.cwd());
    return {
      workspaceRoot,
      projectFolder: opts.projectFolder ?? relativeProjectFolder(workspaceRoot, path.dirname(svFilePath))
    };
  }

  const cwd = process.cwd();
  const projectFolder = relativeProjectFolder(cwd, path.dirname(svFilePath));
  if (projectFolder.startsWith('..') || path.isAbsolute(projectFolder)) {
    return { workspaceRoot: path.dirname(svFilePath), projectFolder: '.' };
  }
  return { workspaceRoot: cwd, projectFolder };
}

function relativeProjectFolder(workspaceRoot: string, projectDir: string): string {
  const relative = path.relative(workspaceRoot, projectDir);
  return relative.length > 0 ? relative : '.';
}

async function assertReadableFile(filePath: string): Promise<void> {
  const stat = await fs.stat(filePath).catch((error) => {
    throw new Error(`Unable to read ${filePath}: ${(error as Error).message}`);
  });
  if (!stat.isFile()) {
    throw new Error(`Expected a SystemVerilog file, got ${filePath}`);
  }
}

async function readLayoutForFile(
  svFilePath: string,
  workspaceRoot: string,
  explicitLayoutFile?: string
): Promise<SavedLayout> {
  if (explicitLayoutFile) {
    return readLayout(path.resolve(explicitLayoutFile));
  }

  const ext = path.extname(svFilePath);
  const stem = ext ? svFilePath.slice(0, -ext.length) : svFilePath;
  const candidates = uniquePaths([
    `${stem}.svsch-layout.json`,
    `${svFilePath}.svsch-layout.json`,
    path.join(workspaceRoot, '.svsch', 'layout.json'),
    path.join(process.cwd(), '.svsch', 'layout.json')
  ]);

  for (const candidate of candidates) {
    if (fsSync.existsSync(candidate)) {
      return readLayout(candidate);
    }
  }

  return EMPTY_LAYOUT;
}

async function readLayout(layoutFile: string): Promise<SavedLayout> {
  try {
    const raw = await fs.readFile(layoutFile, 'utf8');
    const parsed = JSON.parse(raw) as Partial<SavedLayout>;
    return {
      version: 1,
      modules: parsed.modules ?? {}
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return EMPTY_LAYOUT;
    }
    throw new Error(`Unable to read layout ${layoutFile}: ${(error as Error).message}`);
  }
}

function resolveBackendPath(explicitPath?: string): string {
  if (explicitPath) {
    return path.resolve(explicitPath);
  }
  return findBundledFile(['dist', 'svsch_backend'])
    ?? findBundledFile(['svsch_backend'])
    ?? 'svsch_backend';
}

function resolveSurelogPath(explicitPath?: string): string {
  if (explicitPath) {
    return path.resolve(explicitPath);
  }
  return findBundledFile(['dist', 'surelog', 'bin', 'surelog'])
    ?? findBundledFile(['surelog', 'bin', 'surelog'])
    ?? 'surelog';
}

function findBundledFile(relativeParts: string[]): string | undefined {
  const starts = uniquePaths([
    process.cwd(),
    typeof __dirname === 'string' ? __dirname : undefined,
    path.dirname(process.execPath)
  ].filter((candidate): candidate is string => Boolean(candidate)));

  for (const start of starts) {
    const found = findUp(start, relativeParts);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function findUp(start: string, relativeParts: string[]): string | undefined {
  let current = path.resolve(start);
  while (true) {
    const candidate = path.join(current, ...relativeParts);
    if (fsSync.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map((candidate) => path.resolve(candidate))));
}
