import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface SavedNodeLayout {
  x: number;
  y: number;
  stale?: boolean;
  fixed?: boolean;
}

export interface SavedEdgeLayout {
  waypoint?: {
    x: number;
    y: number;
  };
  routePoints?: Array<{
    x: number;
    y: number;
  }>;
  stale?: boolean;
}

export interface SavedRegionLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  stale?: boolean;
  fixed?: boolean;
}

export interface SavedViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface SavedNetCut {
  label: string;
  source: {
    nodeId: string;
    portId?: string;
  };
  /**
   * 'declared' means `label` is the net's actual SV-declared name (a port or
   * wire/reg/var name known from the source) — it must not be silently
   * regenerated and the UI should not allow renaming it. 'synthetic' means
   * the label was invented by the tool (e.g. "NET_3", "u_alu.result") and is
   * freely renameable. Absent on labels saved before this field existed —
   * treated as 'synthetic' for backward compatibility.
   */
  origin?: 'declared' | 'synthetic';
}

export interface SavedModuleLayout {
  nodes: Record<string, SavedNodeLayout>;
  edges?: Record<string, SavedEdgeLayout>;
  regions?: Record<string, SavedRegionLayout>;
  viewport?: SavedViewport;
  expanded?: Record<string, boolean>;
  netCuts?: Record<string, SavedNetCut>;
}

export interface SavedLayout {
  version: 1;
  modules: Record<string, SavedModuleLayout>;
}

export class LayoutStore {
  private writeQueue: Promise<void> = Promise.resolve();
  private pendingLayout: SavedLayout | null = null;
  private syncTimer: NodeJS.Timeout | null = null;
  private pendingResolves: Array<() => void> = [];
  private readonly SYNC_DEBOUNCE_MS = 100;

  constructor(private readonly workspaceRoot: string) {}

  get layoutPath(): string {
    return path.join(this.workspaceRoot, '.svsch', 'layout.json');
  }

  async read(): Promise<SavedLayout> {
    try {
      const raw = await fs.readFile(this.layoutPath, 'utf8');
      const parsed = JSON.parse(raw) as SavedLayout;
      return {
        version: 1,
        modules: parsed.modules ?? {}
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`Unable to read SVSCH layout: ${(error as Error).message}`);
      }
      return { version: 1, modules: {} };
    }
  }

  /**
   * Schedules a layout write. This is debounced and serialized.
   */
  async write(layout: SavedLayout): Promise<void> {
    this.pendingLayout = layout;
    
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
    }

    return new Promise((resolve) => {
      this.pendingResolves.push(resolve);
      this.syncTimer = setTimeout(() => {
        this.syncTimer = null;
        const resolves = this.pendingResolves;
        this.pendingResolves = [];
        this.writeQueue = this.writeQueue
          .then(() => this.performWrite())
          .then(() => {
            for (const r of resolves) r();
          });
      }, this.SYNC_DEBOUNCE_MS);
    });
  }

  /**
   * Immediately writes the layout to disk, bypassing debounce but still serialized.
   */
  async flush(): Promise<void> {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
      const resolves = this.pendingResolves;
      this.pendingResolves = [];
      this.writeQueue = this.writeQueue
        .then(() => this.performWrite())
        .then(() => {
          for (const r of resolves) r();
        });
    }
    return this.writeQueue;
  }

  private async performWrite(): Promise<void> {
    if (!this.pendingLayout) {
      return;
    }

    const layout = this.pendingLayout;
    this.pendingLayout = null;

    const dir = path.dirname(this.layoutPath);
    const tmpPath = `${this.layoutPath}.tmp`;

    try {
      await fs.mkdir(dir, { recursive: true });
      const content = `${JSON.stringify(layout, null, 2)}\n`;
      await fs.writeFile(tmpPath, content, 'utf8');
      await fs.rename(tmpPath, this.layoutPath);
    } catch (error) {
      console.error(`Failed to write SVSCH layout: ${(error as Error).message}`);
      // Try to clean up tmp file
      await fs.unlink(tmpPath).catch(() => {});
    }
  }
}
