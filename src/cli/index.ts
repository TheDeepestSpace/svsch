#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import {
  buildDesignGraph,
  resolveProjectScope,
  renderModuleFromGraph,
  resolveSurelogPath,
  resolveBackendPath,
} from '../core';
import { renderSvg } from './svgRenderer';
import { minifySvg } from './svgMinify';
import type { SvgThemeName } from './theme';
import reactFlowCss from '@xyflow/react/dist/style.css?raw';
import extensionCss from '../webview/diagram.css?raw';

interface RenderOptions {
  output?: string;
  outputDir?: string;
  top?: string;
  layout?: string;
  noLayout: boolean;
  minifySvg: boolean;
  theme: SvgThemeName;
  workspaceRoot?: string;
  projectFolder?: string;
  svschDataDir?: string;
  surelogPath?: string;
  backendPath?: string;
  includePaths?: string[];
  defines?: Record<string, string>;
}

const HDL_EXTENSIONS = new Set(['.sv', '.v']);

async function main(argv: string[]): Promise<void> {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h') {
    printHelp();
    return;
  }
  if (command !== 'render') {
    throw new Error(`Unknown command: ${command}`);
  }

  await renderCommand(rest);
}

async function renderCommand(argv: string[]): Promise<void> {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      'output-dir': { type: 'string' },
      top: { type: 'string' },
      layout: { type: 'string' },
      'no-layout': { type: 'boolean', default: false },
      'no-minify': { type: 'boolean', default: false },
      theme: { type: 'string', default: 'dark' },
      workspace: { type: 'string' },
      'project-folder': { type: 'string' },
      'svsch-data-dir': { type: 'string' },
      watch: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (parsed.values.help) {
    printHelp();
    return;
  }
  if (parsed.values.watch) {
    throw new Error('--watch is not implemented yet.');
  }

  const theme =
    parsed.values.theme === 'light' ? 'light' : parsed.values.theme === 'dark' ? 'dark' : undefined;
  if (!theme) {
    throw new Error(`Unsupported theme: ${parsed.values.theme}`);
  }

  let inputs = await expandInputs(parsed.positionals);
  if (inputs.length === 0) {
    throw new Error('No input SystemVerilog files matched.');
  }

  const output = parsed.values.output;
  const outputDir = parsed.values['output-dir'];
  if (output && outputDir) {
    throw new Error('Use either --output or --output-dir, not both.');
  }

  const options: RenderOptions = {
    output,
    outputDir,
    top: parsed.values.top,
    layout: parsed.values.layout,
    noLayout: parsed.values['no-layout'] === true,
    minifySvg: parsed.values['no-minify'] !== true,
    theme,
    workspaceRoot: parsed.values.workspace,
    projectFolder: parsed.values['project-folder'],
    svschDataDir: parsed.values['svsch-data-dir'],
  };

  if (options.workspaceRoot) {
    process.stderr.write(`[svsch] Using custom Workspace root: ${options.workspaceRoot}\n`);
  }
  if (options.projectFolder) {
    process.stderr.write(`[svsch] Using custom Project folder: ${options.projectFolder}\n`);
  }
  if (options.svschDataDir) {
    process.stderr.write(`[svsch] Using custom SVSCH data directory: ${options.svschDataDir}\n`);
  }

  // 1. Resolve project scope using the FIRST input file (standard CLI behavior)
  const firstInputPath = path.resolve(inputs[0]);
  const { workspaceRoot, projectFolder } = resolveProjectScope(firstInputPath, options);

  // 2. Build design graph ONCE for the whole project
  const graph = await buildDesignGraph({
    workspaceRoot,
    projectFolder,
    backend: 'uhdm',
    veriblePath: 'verible-verilog-syntax',
    surelogPath: resolveSurelogPath(options.surelogPath),
    backendPath: resolveBackendPath(options.backendPath),
    includePaths: options.includePaths,
    defines: options.defines,
    includeExternalDiagnostics: true,
    onProgress: (message) => {
      process.stderr.write(`[svsch] ${message}\n`);
    },
  });

  // 3. Early validation of top module and input reduction
  if (options.top) {
    const topMod = graph.modules[options.top];
    if (!topMod) {
      throw new Error(`Top module "${options.top}" not found in project graph.`);
    }
    // If a specific module is requested, reduce inputs to only the file defining it.
    inputs = [path.resolve(workspaceRoot, topMod.file)];
  }

  // 4. Validate output flags now that inputs list is finalized
  if (output && (inputs.length > 1 || outputLooksLikeDirectory(output))) {
    options.outputDir = output;
    options.output = undefined;
  }
  if (inputs.length > 1 && options.output) {
    throw new Error(
      '--output can only be used with a single input. Use --output-dir for multiple files.',
    );
  }

  // 5. Pre-render all SVGs to ensure everything is valid before writing ANY files
  const results: Array<{ output: string; svg: string; layoutSource?: string }> = [];
  for (const input of inputs) {
    const output = outputPathFor(input, options);
    const { view, layoutSource } = await renderModuleFromGraph(
      graph,
      path.resolve(input),
      workspaceRoot,
      {
        ...options,
        layoutFile: options.layout,
        topModule: options.top,
      },
    );
    let svg = renderSvg(view, { theme: options.theme, reactFlowCss, extensionCss });
    if (options.minifySvg) {
      svg = await minifySvg(svg);
    }
    results.push({ output, svg, layoutSource });
  }

  // All valid? Write them out.
  for (const { output, svg, layoutSource } of results) {
    await fs.mkdir(path.dirname(output), { recursive: true });
    const relativeOutput = relativeToCwd(output);
    if (layoutSource) {
      process.stderr.write(
        `[svsch] rendering ${relativeOutput} using layout file ${relativeToCwd(layoutSource)}\n`,
      );
    } else {
      process.stderr.write(`[svsch] rendering ${relativeOutput} without a layout file\n`);
    }
    await fs.writeFile(output, svg, 'utf8');
    process.stdout.write(`${output}\n`);
  }
}

// Displays paths relative to the current working directory rather than the
// (possibly --workspace-overridden) internal workspaceRoot, so the output and
// layout paths logged here read the same way a user typed them.
function relativeToCwd(filePath: string): string {
  const relative = path.relative(process.cwd(), filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return filePath;
  }
  return normalizePath(relative);
}

function outputPathFor(input: string, options: RenderOptions): string {
  if (options.output) {
    return path.resolve(options.output);
  }
  const inputPath = path.resolve(input);
  const outputName = `${path.basename(inputPath, path.extname(inputPath))}.svg`;
  if (options.outputDir) {
    return path.resolve(options.outputDir, outputName);
  }
  return path.join(path.dirname(inputPath), outputName);
}

function outputLooksLikeDirectory(output: string): boolean {
  if (output.endsWith('/') || output.endsWith('\\')) {
    return true;
  }
  try {
    return fsSync.statSync(path.resolve(output)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function expandInputs(positionals: string[]): Promise<string[]> {
  const patterns = positionals.length > 0 ? positionals : ['.'];
  const all = await Promise.all(patterns.map(expandInput));
  return Array.from(new Set(all.flat().map((file) => path.resolve(file)))).sort();
}

async function expandInput(input: string): Promise<string[]> {
  if (hasGlob(input)) {
    return expandGlob(input);
  }

  const resolved = path.resolve(input);
  const stat = await fs.stat(resolved).catch(() => undefined);
  if (!stat) {
    return [];
  }
  if (stat.isDirectory()) {
    const files = await walk(resolved);
    return files.filter(isHdlFile);
  }
  return isHdlFile(resolved) ? [resolved] : [];
}

async function expandGlob(pattern: string): Promise<string[]> {
  const normalizedPattern = normalizePath(pattern);
  const base = globBase(normalizedPattern);
  const absoluteBase = path.resolve(base || '.');
  const matcher = globToRegExp(normalizePath(path.resolve(pattern)));
  const files = await walk(absoluteBase);
  return files.filter((file) => matcher.test(normalizePath(file)) && isHdlFile(file));
}

function globBase(pattern: string): string {
  const segments = pattern.split('/');
  const base: string[] = [];
  for (const segment of segments) {
    if (hasGlob(segment)) {
      break;
    }
    base.push(segment);
  }
  return base.join('/') || '.';
}

function globToRegExp(pattern: string): RegExp {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === '*') {
      if (next === '*') {
        source += '.*';
        index += 1;
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += escapeRegExp(char);
    }
  }
  source += '$';
  return new RegExp(source);
}

async function walk(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.svsch') {
      continue;
    }
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function hasGlob(value: string): boolean {
  return /[*?]/.test(value);
}

function isHdlFile(file: string): boolean {
  return HDL_EXTENSIONS.has(path.extname(file));
}

function normalizePath(file: string): string {
  return file.replace(/\\/g, '/');
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function printHelp(): void {
  process.stdout.write(`SVSCH CLI

Usage:
  svsch render <file.sv> [--output <file.svg>] [--top <module>] [--layout <json>] [--no-layout]
  svsch render "<glob>" --output-dir <dir>

Options:
  -o, --output <file>       Write a single SVG to this path
      --output-dir <dir>    Write one SVG per input into this directory
      --top <module>        Render a specific module
      --layout <json>       Use an explicit saved layout file
      --no-layout           Ignore saved layout and run auto-layout
      --no-minify           Skip SVGO minification of the exported SVG
      --theme <dark|light>  Fixed SVG color theme (default: dark)
      --workspace <dir>     Workspace root used for parser cache and relative paths
      --project-folder <d>  Project folder relative to workspace
      --svsch-data-dir <d>  Directory containing layouts/<module>.json (default: <workspace>/.svsch)
`);
}

main(process.argv.slice(2))
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    process.stderr.write(`[svsch] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
