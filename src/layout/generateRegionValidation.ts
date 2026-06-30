import { diagramNodeDimensions } from '../diagram/nodeSizing';
import type { PositionedGenerateRegion, PositionedNode } from '../ir/types';

type RegionBounds = PositionedGenerateRegion['bounds'];

export const GENERATE_REGION_OVERLAP_WARNING = 'arm blocks overlapping';
export const GENERATE_REGION_EXTERNAL_NODE_WARNING = 'node does not belong to arm block';

export function annotateGenerateRegionWarnings(
  regions: PositionedGenerateRegion[],
  nodes: PositionedNode[]
): PositionedGenerateRegion[] {
  if (regions.length === 0) return regions;

  const byId = new Map(regions.map((region) => [region.id, region]));
  const warningsByRegion = new Map<string, Set<string>>();
  const addWarning = (regionId: string, warning: string) => {
    const warnings = warningsByRegion.get(regionId) ?? new Set<string>();
    warnings.add(warning);
    warningsByRegion.set(regionId, warnings);
  };

  const isAncestor = (ancestorId: string, descendantId: string): boolean => {
    let current = byId.get(descendantId)?.parentRegionId;
    while (current) {
      if (current === ancestorId) return true;
      current = byId.get(current)?.parentRegionId;
    }
    return false;
  };

  for (let i = 0; i < regions.length; i += 1) {
    for (let j = i + 1; j < regions.length; j += 1) {
      const a = regions[i];
      const b = regions[j];
      if (isAncestor(a.id, b.id) || isAncestor(b.id, a.id)) continue;
      if (rectsOverlap(a.bounds, b.bounds)) {
        addWarning(a.id, GENERATE_REGION_OVERLAP_WARNING);
        addWarning(b.id, GENERATE_REGION_OVERLAP_WARNING);
      }
    }
  }

  for (const region of regions) {
    const owned = new Set(descendantNodeIds(region, regions));
    for (const node of nodes) {
      if (owned.has(node.id) || node.kind === 'port') continue;
      const size = diagramNodeDimensions(node);
      const center = {
        x: node.position.x + size.width / 2,
        y: node.position.y + size.height / 2
      };
      if (pointInBounds(center, region.bounds)) {
        addWarning(region.id, GENERATE_REGION_EXTERNAL_NODE_WARNING);
        break;
      }
    }
  }

  return regions.map((region) => {
    const validationWarnings = Array.from(warningsByRegion.get(region.id) ?? []);
    return {
      ...region,
      invalid: validationWarnings.length > 0 || undefined,
      warningNote: validationWarnings.length > 0
        ? validationWarnings.join('; ')
        : undefined
    };
  });
}

function descendantNodeIds(region: PositionedGenerateRegion, regions: PositionedGenerateRegion[]): string[] {
  const ids = new Set(region.nodeIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of regions) {
      if (!candidate.parentRegionId) continue;
      if (ids.size === 0 && candidate.parentRegionId !== region.id) continue;
      let parent: string | undefined = candidate.parentRegionId;
      let isDescendant = parent === region.id;
      while (!isDescendant && parent) {
        const parentRegion = regions.find((item) => item.id === parent);
        parent = parentRegion?.parentRegionId;
        isDescendant = parent === region.id;
      }
      if (!isDescendant) continue;
      for (const nodeId of candidate.nodeIds) {
        if (!ids.has(nodeId)) {
          ids.add(nodeId);
          changed = true;
        }
      }
    }
  }
  return Array.from(ids);
}

function rectsOverlap(a: RegionBounds, b: RegionBounds): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function pointInBounds(point: { x: number; y: number }, bounds: RegionBounds): boolean {
  return point.x > bounds.x && point.x < bounds.x + bounds.width && point.y > bounds.y && point.y < bounds.y + bounds.height;
}
