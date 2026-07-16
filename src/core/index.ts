import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import type { DesignGraph, DiagramViewModel } from '../ir/types';
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

  return await renderModuleFromGraph(graph, svFilePath, workspaceRoot, opts);
}

export async function renderModuleFromGraph(
  graph: DesignGraph,
  svFilePath: string,
  workspaceRoot: string,
  opts: RenderDiagramOptions
): Promise<DiagramViewModel> {
  let moduleName = opts.topModule;
  if (moduleName) {
    if (!graph.modules[moduleName]) {
      throw new Error(`Top module "${moduleName}" not found in project graph.`);
    }
  } else {
    // Try to find modules defined in the input file within the graph
    const modulesInFile = Object.values(graph.modules).filter((m) => path.resolve(workspaceRoot, m.file) === svFilePath);
    if (modulesInFile.length > 0) {
      const rootsInFile = modulesInFile.filter((m) => graph.rootModules.includes(m.name));
      moduleName = rootsInFile[0]?.name ?? modulesInFile[0].name;
    } else {
      // If the input file has no modules in the graph (e.g. excluded by project folder),
      // and no explicit top module was requested, error out instead of picking an unrelated module.
      throw new Error(`No modules from "${path.basename(svFilePath)}" were found in the project graph. Check --project-folder or --workspace.`);
    }
  }

  const layoutFile = opts.layoutFile;
  const layout = opts.noLayout ? EMPTY_LAYOUT : readLayoutForFileSync(svFilePath, workspaceRoot, layoutFile);

  return await buildViewModel(graph, moduleName, layout);
}

export function resolveProjectScope(
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

export { buildDesignGraph };
export { resolveSignalSource } from './sourceResolution';

async function assertReadableFile(filePath: string): Promise<void> {
  const stat = await fs.stat(filePath).catch((error) => {
    throw new Error(`Unable to read ${filePath}: ${(error as Error).message}`);
  });
  if (!stat.isFile()) {
    throw new Error(`Expected a SystemVerilog file, got ${filePath}`);
  }
}

function readLayoutForFileSync(
  svFilePath: string,
  workspaceRoot: string,
  explicitLayoutFile?: string
): SavedLayout {
  if (explicitLayoutFile) {
    return readLayoutSync(path.resolve(explicitLayoutFile));
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
      return readLayoutSync(candidate);
    }
  }

  return EMPTY_LAYOUT;
}

function readLayoutSync(layoutFile: string): SavedLayout {
  try {
    const raw = fsSync.readFileSync(layoutFile, 'utf8');
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

function relativeProjectFolder(workspaceRoot: string, projectDir: string): string {
  const relative = path.relative(workspaceRoot, projectDir);
  return relative.length > 0 ? relative : '.';
}

export function resolveBackendPath(explicitPath?: string): string {
  if (explicitPath) {
    return path.resolve(explicitPath);
  }
  return findBundledFile(['dist', 'svsch_backend'])
    ?? findBundledFile(['svsch_backend'])
    ?? 'svsch_backend';
}

export function resolveSurelogPath(explicitPath?: string): string {
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
