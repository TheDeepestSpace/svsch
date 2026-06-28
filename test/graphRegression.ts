import { type Page, expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { diffLines } from 'diff';

export interface GraphState {
  nodes: Array<{
    id: string;
    type?: string;
    position: { x: number; y: number };
    width: number;
    height: number;
    data?: {
      label?: string;
      kind?: string;
      ports?: Array<{
        id: string;
        name: string;
        side: string;
        direction?: string;
        metadata?: any;
      }>;
    };
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
    path: string; // Captured SVG path data
  }>;
}

export async function captureGraphState(page: Page): Promise<GraphState> {
  return await page.evaluate(() => {
    const rf = (window as any).reactFlowInstance;
    if (!rf) {
      throw new Error('reactFlowInstance not found on window');
    }
    
    const nodes = rf.getNodes().map((n: any) => ({
      id: n.id,
      type: n.type,
      position: {
        x: Math.round(n.position.x),
        y: Math.round(n.position.y)
      },
      width: Math.round(n.measured?.width ?? n.width ?? 0),
      height: Math.round(n.measured?.height ?? n.height ?? 0),
      data: n.data ? {
        label: n.data.label,
        kind: n.data.node?.kind,
        ports: n.data.node?.ports?.map((p: any) => ({
          id: p.id,
          name: p.name,
          side: p.side,
          direction: p.direction,
          metadata: p.metadata
        }))
      } : undefined
    }));

    const edges = rf.getEdges().map((e: any) => {
      // Use a more specific selector to find the path element for this specific edge
      const edgeElement = document.querySelector(`.react-flow__edge[data-id="${e.id}"] path.svsch-edge`);
      const pathData = edgeElement?.getAttribute('d') ?? '';
      
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
        path: pathData
      };
    });

    // Sort to ensure deterministic comparison
    nodes.sort((a: any, b: any) => a.id.localeCompare(b.id));
    edges.sort((a: any, b: any) => a.id.localeCompare(b.id));

    return { nodes, edges };
  });
}

export function compareGraphState(
  actual: GraphState,
  snapshotName: string,
  snapshotsDir: string,
  resultsDir: string,
  updateSnapshots: boolean = false,
  onFailure?: (expected: string, actual: string, diff: string) => void
) {
  const snapshotPath = path.join(snapshotsDir, `${snapshotName}.json`);
  const actualJson = JSON.stringify(actual, null, 2);
  const actualHasContent = actual.nodes.length > 0 || actual.edges.length > 0;

  const snapshotMissingOrEmpty = !fs.existsSync(snapshotPath) || fs.statSync(snapshotPath).size === 0;
  if (snapshotMissingOrEmpty || updateSnapshots) {
    const parentDir = path.dirname(snapshotPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(snapshotPath, actualJson);
    console.log(`Created or updated baseline graph: ${snapshotPath}`);
    return;
  }

  const expectedJson = fs.readFileSync(snapshotPath, 'utf8');
  const normalizedExpectedJson = normalizeGraphSnapshotJson(expectedJson);
  if (actualHasContent && normalizedExpectedJson === JSON.stringify({ nodes: [], edges: [] }, null, 2)) {
    fs.writeFileSync(snapshotPath, actualJson);
    console.log(`Replaced empty baseline graph: ${snapshotPath}`);
    return;
  }

  const expectedGraph = parseGraphSnapshot(expectedJson);
  if (expectedGraph && isMissingOnlyPortData(expectedGraph, actual)) {
    fs.writeFileSync(snapshotPath, actualJson);
    console.log(`Restored port data in baseline graph: ${snapshotPath}`);
    return;
  }
  
  if (actualJson !== normalizedExpectedJson) {
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    const actualPath = path.join(resultsDir, `${snapshotName}.actual.json`);
    const expectedPath = path.join(resultsDir, `${snapshotName}.expected.json`);
    const diffPath = path.join(resultsDir, `${snapshotName}.diff.txt`);

    fs.writeFileSync(actualPath, actualJson);
    fs.writeFileSync(expectedPath, normalizedExpectedJson);

    const diff = diffLines(normalizedExpectedJson, actualJson);
    let diffText = '';
    diff.forEach((part) => {
      const prefix = part.added ? '+ ' : part.removed ? '- ' : '  ';
      diffText += part.value.split('\n').map(line => line ? prefix + line : line).join('\n');
    });
    fs.writeFileSync(diffPath, diffText);

    if (onFailure) {
      onFailure(expectedJson, actualJson, diffText);
    }

    throw new Error(
      `Graph regression failure for "${snapshotName}".\n` +
      `Visual structure has changed from the baseline.\n\n` +
      `Expected: ${expectedPath}\n` +
      `Actual:   ${actualPath}\n` +
      `Diff:     ${diffPath}\n\n` +
      `Summary of changes:\n${diffText.split('\n').filter(l => l.startsWith('+') || l.startsWith('-')).slice(0, 20).join('\n')}\n...\n\n` +
      `If these changes are intentional, run tests with UPDATE_SNAPSHOTS=true to update the baseline.`
    );
  }
}

function normalizeGraphSnapshotJson(json: string): string {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json.trimEnd();
  }
}

function parseGraphSnapshot(json: string): GraphState | undefined {
  try {
    return JSON.parse(json) as GraphState;
  } catch {
    return undefined;
  }
}

function isMissingOnlyPortData(expected: GraphState, actual: GraphState): boolean {
  if (!hasAnyPortData(actual) || !hasMissingPortData(expected, actual)) {
    return false;
  }
  return JSON.stringify(stripPortData(expected), null, 2) === JSON.stringify(stripPortData(actual), null, 2);
}

function hasAnyPortData(graph: GraphState): boolean {
  return graph.nodes.some(node => (node.data?.ports?.length ?? 0) > 0);
}

function hasMissingPortData(expected: GraphState, actual: GraphState): boolean {
  const expectedById = new Map(expected.nodes.map(node => [node.id, node]));
  return actual.nodes.some(node => {
    const actualPorts = node.data?.ports;
    if (!actualPorts || actualPorts.length === 0) return false;
    const expectedPorts = expectedById.get(node.id)?.data?.ports;
    return !expectedPorts || expectedPorts.length === 0;
  });
}

function stripPortData(graph: GraphState): GraphState {
  return {
    nodes: graph.nodes.map(node => ({
      ...node,
      data: node.data ? {
        ...node.data,
        ports: undefined
      } : undefined
    })),
    edges: graph.edges
  };
}

export function compareSvgSnapshot(
  actualSvg: string,
  snapshotName: string,
  snapshotsDir: string,
  resultsDir: string,
  updateSnapshots: boolean = false
) {
  const snapshotPath = path.join(snapshotsDir, `${snapshotName}.svg`);

  if (!fs.existsSync(snapshotPath) || updateSnapshots) {
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, actualSvg);
    console.log(`Created or updated baseline SVG: ${snapshotPath}`);
    return;
  }

  const expectedSvg = fs.readFileSync(snapshotPath, 'utf8');

  if (actualSvg !== expectedSvg) {
    fs.mkdirSync(resultsDir, { recursive: true });

    const actualPath = path.join(resultsDir, `${snapshotName}.actual.svg`);
    const expectedPath = path.join(resultsDir, `${snapshotName}.expected.svg`);
    const diffPath = path.join(resultsDir, `${snapshotName}.svg.diff.txt`);

    fs.writeFileSync(actualPath, actualSvg);
    fs.writeFileSync(expectedPath, expectedSvg);

    const diff = diffLines(expectedSvg, actualSvg);
    let diffText = '';
    diff.forEach((part) => {
      const prefix = part.added ? '+ ' : part.removed ? '- ' : '  ';
      diffText += part.value.split('\n').map((line) => (line ? prefix + line : line)).join('\n');
    });
    fs.writeFileSync(diffPath, diffText);

    throw new Error(
      `SVG regression failure for "${snapshotName}".\n` +
      `SVG output has changed from the baseline.\n\n` +
      `Expected: ${expectedPath}\n` +
      `Actual:   ${actualPath}\n` +
      `Diff:     ${diffPath}\n\n` +
      `Summary of changes:\n${diffText.split('\n').filter((l) => l.startsWith('+') || l.startsWith('-')).slice(0, 20).join('\n')}\n...\n\n` +
      `If these changes are intentional, run tests with UPDATE_SNAPSHOTS=true to update the baseline.`
    );
  }
}
