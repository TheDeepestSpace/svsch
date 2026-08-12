import { getVscodeApi } from '../../vscodeApi';
import { nodeModportName, nodeTypeName, structRole } from '../../../ir/nodeMetadata';
import type { PositionedNode, SourceRange } from '../../../ir/types';

const vscode = getVscodeApi();

export function navigateToSource(source: SourceRange): void {
  const msg = { type: 'navigateToSource', source };
  console.log('NAVIGATE:', JSON.stringify(msg));
  vscode.postMessage(msg);
}

/**
 * Double-click routing shared by every node kind: interface (bundle/type)
 * nodes open their interface definition, instances open their module,
 * everything else with a source location navigates there.
 */
export function handleNodeDoubleClick(node: PositionedNode): void {
  const typeName = nodeTypeName(node) ?? (node.kind === 'port' ? node.ports[0]?.typeName : undefined);
  const modportName = nodeModportName(node) ?? (node.kind === 'port' ? node.ports[0]?.modportName : undefined);
  const nodeRole = structRole(node);
  const isInterface = node.kind === 'interface' || (node.kind === 'port' && Boolean(typeName && (modportName !== undefined || typeName.endsWith('_if') || typeName.endsWith('if'))));

  let msg: any = null;
  if (isInterface && typeName && nodeRole !== 'modport') {
    msg = { type: 'openModule', moduleName: `interface ${typeName}` };
  } else if (node.kind === 'instance' && node.moduleName) {
    msg = { type: 'openModule', moduleName: node.moduleName };
  } else if (node.source) {
    msg = { type: 'navigateToSource', source: node.source };
  }
  if (msg) {
    console.log('NAVIGATE:', JSON.stringify(msg));
    vscode.postMessage(msg);
  }
}
