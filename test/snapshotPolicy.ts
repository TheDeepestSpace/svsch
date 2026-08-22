import type { FullConfig } from '@playwright/test';

export const SNAPSHOT_THRESHOLDS = {
  playwright: {
    visual: {
      default: 50,
      generateRegions: 120,
      muxLongNames: 2,
    },
    bdd: 300,
    system: 500,
    pixelmatchThreshold: 0.2,
  },
  pixelmatch: {
    bdd: 50,
    cli: 100,
    threshold: 0.1,
  },
} as const;

export type SnapshotSuite = 'visual' | 'bdd' | 'system';

/**
 * BDD scenarios whose screenshots are pixel-compare-exempt for the whole
 * scenario (the JSON graph regression still fully covers their structural
 * correctness — see BddWorld.takeScreenshot). Both current entries trace to
 * renderer/viewport nondeterminism around an expanded instance's frame, not
 * an application or test-logic bug:
 * - "re-anchors": dashed frame border at a non-integer fit-view zoom leaves
 *   ~9k px of antialiasing/dash-phase jitter between byte-identical layouts.
 * - every scenario with an "I drag-select across the entire diagram" step:
 *   the marquee sweeps to the viewport edge; with the frame mirroring the
 *   child's full standalone width the drag rides the canvas auto-pan, whose
 *   distance is timing-dependent, and the shifted pan persists into every
 *   later screenshot of the scenario.
 * See PR #233.
 */
export const SCENARIOS_WITH_FLAKY_SCREENSHOT_PIXELS = new Set([
  "Auto Layout re-anchors a cut net end to the expanded frame's border",
  'Auto Layout on a border-crossing drag-selection re-lays out the outer diagram and ' +
    'carries the sub-diagram along',
  'Auto Layout places outer blocks clear of the expanded frame',
  'Drag-selection crossing the expanded instance selects only top-level nodes',
]);

export interface BaselineThreshold {
  suite: SnapshotSuite;
  maxDiffPixels: number;
  pixelmatchThreshold: number;
}

const generateRegionOverrides = [
  'error-highlight-block-types',
  'generate-block-intrusion-warning',
  'generate-block-overlap-warning',
  'generate-case-regions-auto-canvas',
  'generate-case-regions-canvas',
  'generate-if-else-regions-auto-canvas',
  'generate-if-else-regions-canvas',
  'generate-region-external-node-warning',
  'generate-region-overlap-warning',
];

function isPlaywrightSnapshotNamed(filePath: string, snapshotName: string): boolean {
  const fileName = filePath.slice(filePath.lastIndexOf('/') + 1);
  return fileName === `${snapshotName}.png` || fileName.startsWith(`${snapshotName}-`);
}

export function baselineThresholdFor(filePath: string): BaselineThreshold | undefined {
  const normalizedPath = filePath.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalizedPath.endsWith('.png')) return undefined;

  if (normalizedPath.startsWith('test/visual/__screenshots__/')) {
    let maxDiffPixels: number = SNAPSHOT_THRESHOLDS.playwright.visual.default;
    if (normalizedPath.includes('/generate_regions.visual.spec.ts-snapshots/')) {
      const hasFixedOverride = generateRegionOverrides.some((name) =>
        isPlaywrightSnapshotNamed(normalizedPath, name),
      );
      const hasResizeOverride =
        isPlaywrightSnapshotNamed(normalizedPath, 'generate-region-resize-bottom') ||
        isPlaywrightSnapshotNamed(normalizedPath, 'generate-region-resize-left') ||
        isPlaywrightSnapshotNamed(normalizedPath, 'generate-region-resize-right') ||
        isPlaywrightSnapshotNamed(normalizedPath, 'generate-region-resize-top');
      if (hasFixedOverride || hasResizeOverride) {
        maxDiffPixels = SNAPSHOT_THRESHOLDS.playwright.visual.generateRegions;
      }
    } else if (
      normalizedPath.includes('/mux.visual.spec.ts-snapshots/') &&
      isPlaywrightSnapshotNamed(normalizedPath, 'mux-long-names-webview')
    ) {
      maxDiffPixels = SNAPSHOT_THRESHOLDS.playwright.visual.muxLongNames;
    }
    return {
      suite: 'visual',
      maxDiffPixels,
      pixelmatchThreshold: SNAPSHOT_THRESHOLDS.playwright.pixelmatchThreshold,
    };
  }

  if (normalizedPath.startsWith('test/features/__screenshots__/')) {
    return {
      suite: 'bdd',
      maxDiffPixels: SNAPSHOT_THRESHOLDS.playwright.bdd,
      pixelmatchThreshold: SNAPSHOT_THRESHOLDS.playwright.pixelmatchThreshold,
    };
  }

  if (normalizedPath.startsWith('test/features/snapshots/')) {
    return {
      suite: 'bdd',
      maxDiffPixels: normalizedPath.endsWith('--cli-png.png')
        ? SNAPSHOT_THRESHOLDS.pixelmatch.cli
        : SNAPSHOT_THRESHOLDS.pixelmatch.bdd,
      pixelmatchThreshold: SNAPSHOT_THRESHOLDS.pixelmatch.threshold,
    };
  }

  if (normalizedPath.startsWith('test/system/__screenshots__/')) {
    return {
      suite: 'system',
      maxDiffPixels: SNAPSHOT_THRESHOLDS.playwright.system,
      pixelmatchThreshold: SNAPSHOT_THRESHOLDS.playwright.pixelmatchThreshold,
    };
  }

  return undefined;
}

// UPDATE_SNAPSHOTS is the update switch used by the custom comparators. Keep
// Playwright in equivalent compare-first mode when that switch is used.
export function configuredPlaywrightUpdateMode(): 'changed' | 'missing' {
  return process.env.UPDATE_SNAPSHOTS ? 'changed' : 'missing';
}

export function assertSafeSnapshotUpdateMode(config: FullConfig): void {
  if (config.updateSnapshots === 'all') {
    throw new Error(
      'Snapshot update mode "all" rewrites passing baselines. ' +
        'Use --update-snapshots=changed instead.',
    );
  }
}
