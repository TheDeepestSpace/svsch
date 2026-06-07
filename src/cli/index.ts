#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import { parseArgs } from 'node:util';
import { renderDiagram } from '../core';
import { renderSvg } from './svgRenderer';
import type { SvgThemeName } from './theme';
import reactFlowCss from '@xyflow/react/dist/style.css?raw';
import extensionCss from '../webview/styles.css?raw';

interface RenderOptions {
  output?: string;
  outputDir?: string;
  top?: string;
  layout?: string;
  noLayout: boolean;
  theme: SvgThemeName;
  surelogPath?: string;
  backendPath?: string;
  workspaceRoot?: string;
  projectFolder?: string;
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
      theme: { type: 'string', default: 'dark' },
      surelog: { type: 'string' },
      backend: { type: 'string' },
      workspace: { type: 'string' },
      'project-folder': { type: 'string' },
      watch: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false }
    }
  });

  if (parsed.values.help) {
    printHelp();
    return;
  }
  if (parsed.values.watch) {
    throw new Error('--watch is not implemented yet.');
  }

  const theme = parsed.values.theme === 'light' ? 'light' : parsed.values.theme === 'dark' ? 'dark' : undefined;
  if (!theme) {
    throw new Error(`Unsupported theme: ${parsed.values.theme}`);
  }

  const inputs = await expandInputs(parsed.positionals);
  if (inputs.length === 0) {
    throw new Error('No input SystemVerilog files matched.');
  }

  let output = parsed.values.output;
  let outputDir = parsed.values['output-dir'];
  if (output && outputDir) {
    throw new Error('Use either --output or --output-dir, not both.');
  }
  if (output && (inputs.length > 1 || outputLooksLikeDirectory(output))) {
    outputDir = output;
    output = undefined;
  }
  if (inputs.length > 1 && output) {
    throw new Error('--output can only be used with a single input. Use --output-dir for multiple files.');
  }

  const options: RenderOptions = {
    output,
    outputDir,
    top: parsed.values.top,
    layout: parsed.values.layout,
    noLayout: parsed.values['no-layout'] === true,
    theme,
    surelogPath: parsed.values.surelog,
    backendPath: parsed.values.backend,
    workspaceRoot: parsed.values.workspace,
    projectFolder: parsed.values['project-folder']
  };

  for (const input of inputs) {
    const output = outputPathFor(input, options);
    await fs.mkdir(path.dirname(output), { recursive: true });
    const view = await renderDiagram(input, {
      layoutFile: options.layout,
      topModule: options.top,
      noLayout: options.noLayout,
      surelogPath: options.surelogPath,
      backendPath: options.backendPath,
      workspaceRoot: options.workspaceRoot,
      projectFolder: options.projectFolder,
      onProgress: (message) => {
        process.stderr.write(`[svsch] ${message}\n`);
      }
    });
    const svg = renderSvg(view, { theme: options.theme, reactFlowCss, extensionCss });
    await fs.writeFile(output, svg, 'utf8');
    process.stdout.write(`${output}\n`);
  }
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
      files.push(...await walk(fullPath));
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
      --theme <dark|light>  Fixed SVG color theme (default: dark)
      --surelog <path>      Surelog executable path
      --backend <path>      svsch_backend executable path
      --workspace <dir>     Workspace root used for parser cache and relative paths
      --project-folder <d>  Project folder relative to workspace
`);
}

main(process.argv.slice(2)).then(() => {
  process.exit(0);
}).catch((error) => {
  process.stderr.write(`[svsch] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
