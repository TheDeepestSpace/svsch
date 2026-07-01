import { diagramNodeDimensions } from '../diagram/nodeSizing';
import type { PositionedGenerateRegion, PositionedNode } from '../ir/types';

type RegionBounds = PositionedGenerateRegion['bounds'];

export const GENERATE_REGION_OVERLAP_WARNING = 'arm blocks overlapping';
export const GENERATE_REGION_EXTERNAL_NODE_WARNING = 'node does not belong to arm block';
export const GENERATE_REGION_EXTERNAL_BLOCK_WARNING = 'this block does not belong to a generate arm block';

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

  const { regionIds: regionsWithExternalNode } = classifyExternalBlocks(regions, nodes);
  for (const regionId of regionsWithExternalNode) {
    addWarning(regionId, GENERATE_REGION_EXTERNAL_NODE_WARNING);
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

// Ids of blocks whose visual bounds overlap a generate arm they do not belong to.
export function findExternalBlockIds(
  regions: PositionedGenerateRegion[],
  nodes: PositionedNode[]
): Set<string> {
  return classifyExternalBlocks(regions, nodes).nodeIds;
}

// Single geometry pass shared by the arm warning and the block highlight so the
// two stay consistent: a block/region pair is flagged when the block is not owned
// by the region (nor a descendant) yet its bounds overlap the region bounds.
function classifyExternalBlocks(
  regions: PositionedGenerateRegion[],
  nodes: PositionedNode[]
): { regionIds: Set<string>; nodeIds: Set<string> } {
  const regionIds = new Set<string>();
  const nodeIds = new Set<string>();
  for (const region of regions) {
    const owned = new Set(descendantNodeIds(region, regions));
    for (const node of nodes) {
      if (owned.has(node.id) || node.kind === 'port') continue;
      const size = diagramNodeDimensions(node);
      const nodeBounds = {
        x: node.position.x,
        y: node.position.y,
        width: size.width,
        height: size.height
      };
      if (rectsOverlap(nodeBounds, region.bounds)) {
        regionIds.add(region.id);
        nodeIds.add(node.id);
      }
    }
  }
  return { regionIds, nodeIds };
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
