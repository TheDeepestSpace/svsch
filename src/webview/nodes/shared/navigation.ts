import type { MouseEvent as ReactMouseEvent } from 'react';
import { getVscodeApi } from '../../vscodeApi';
import { nodeModportName, nodeTypeName, structRole } from '../../../ir/nodeMetadata';
import type { PositionedNode, SourceRange } from '../../../ir/types';

const vscode = getVscodeApi();

const BUS_TAP_DESCENDANT_SELECTOR = '.bus-tap, .svsch-bus-tap-label, .svsch-interface-field-label, .svsch-interface-side-label';

/**
 * The port skin (and its ancestor bus/interface node) renders navigable
 * tap/field labels as descendants; a double-click there should navigate to
 * that label's own source, not fall through to the node's own double-click.
 */
export function stopIfBusTapDescendant(event: ReactMouseEvent, onDoubleClick: () => void): void {
  if (event.target instanceof Element && event.target.closest(BUS_TAP_DESCENDANT_SELECTOR)) {
    return;
  }
  onDoubleClick();
}

/** True for ports whose type identifies them as an interface bundle (vs. a plain signal). */
export function isInterfacePortLike(port: { typeName?: string; modportName?: string } | undefined): boolean {
  const typeName = port?.typeName;
  return Boolean(typeName && (port?.modportName !== undefined || typeName.endsWith('if')));
}

export function navigateToSource(source: SourceRange): void {
  vscode.postMessage({ type: 'navigateToSource', source });
}

type NavigationMessage =
  | { type: 'openModule'; moduleName: string }
  | { type: 'navigateToSource'; source: SourceRange };

/**
 * Double-click routing shared by every node kind: interface (bundle/type)
 * nodes open their interface definition, instances open their module,
 * everything else with a source location navigates there.
 */
export function handleNodeDoubleClick(node: PositionedNode): void {
  const typeName = nodeTypeName(node) ?? (node.kind === 'port' ? node.ports[0]?.typeName : undefined);
  const modportName = nodeModportName(node) ?? (node.kind === 'port' ? node.ports[0]?.modportName : undefined);
  const nodeRole = structRole(node);
  const isInterface = node.kind === 'interface' || (node.kind === 'port' && isInterfacePortLike({ typeName, modportName }));

  let msg: NavigationMessage | null = null;
  if (isInterface && typeName && nodeRole !== 'modport') {
    msg = { type: 'openModule', moduleName: `interface ${typeName}` };
  } else if (node.kind === 'instance' && node.moduleName) {
    msg = { type: 'openModule', moduleName: node.moduleName };
  } else if (node.source) {
    msg = { type: 'navigateToSource', source: node.source };
  }
  if (msg) {
    vscode.postMessage(msg);
  }
}
