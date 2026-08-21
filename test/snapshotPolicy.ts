import type { FullConfig } from '@playwright/test';

export const SNAPSHOT_THRESHOLDS = {
  playwright: {
    visual: {
      default: 50,
      muxLongNames: 2,
    },
    system: 50,
    pixelmatchThreshold: 0.2,
  },
  pixelmatch: {
    bdd: 50,
    cli: 20,
    threshold: 0.1,
  },
} as const;

export type SnapshotSuite = 'visual' | 'bdd' | 'system';

export interface BaselineThreshold {
  suite: SnapshotSuite;
  maxDiffPixels: number;
  pixelmatchThreshold: number;
}

function isPlaywrightSnapshotNamed(filePath: string, snapshotName: string): boolean {
  const fileName = filePath.slice(filePath.lastIndexOf('/') + 1);
  return fileName === `${snapshotName}.png` || fileName.startsWith(`${snapshotName}-`);
}

export function baselineThresholdFor(filePath: string): BaselineThreshold | undefined {
  const normalizedPath = filePath.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalizedPath.endsWith('.png')) return undefined;

  if (normalizedPath.startsWith('test/visual/__screenshots__/')) {
    let maxDiffPixels: number = SNAPSHOT_THRESHOLDS.playwright.visual.default;
    if (
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
