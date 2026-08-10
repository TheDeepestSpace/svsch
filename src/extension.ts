import * as vscode from 'vscode';
import { DiagramPanel } from './diagramPanel';
import { ElaborationService } from './elaborationService';
import { createVscodeElaborationHost } from './vscodeElaborationHost';
import { logger } from './logger';

let panel: DiagramPanel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  logger.init();
  logger.log('SVSCH extension activated');
  let elaborationService: ElaborationService | undefined;

  const getElaborationService = () => {
    if (!elaborationService) {
      elaborationService = new ElaborationService(createVscodeElaborationHost(context));
      context.subscriptions.push(elaborationService);
    }
    return elaborationService;
  };

  const getPanel = () => {
    if (!panel) {
      panel = new DiagramPanel(context, getElaborationService(), () => {
        panel = undefined;
      });
    }
    return panel;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('svsch.openDiagram', async () => {
      await getPanel().open();
    }),
    vscode.commands.registerCommand('svsch.setProjectFolder', async () => {
      const folder = await vscode.window.showInputBox({
        title: 'SVSCH: Set Project Folder',
        prompt: 'Workspace-relative folder containing SystemVerilog/Verilog files',
        value: vscode.workspace.getConfiguration('svsch').get<string>('projectFolder') || 'src'
      });
      if (folder === undefined) {
        return;
      }
      await vscode.workspace.getConfiguration('svsch').update('projectFolder', folder, vscode.ConfigurationTarget.Workspace);
      await getPanel().rebuild();
    }),
    vscode.commands.registerCommand('svsch.rebuildDiagram', async () => {
      await getPanel().rebuild();
    }),
    vscode.commands.registerCommand('svsch.resetLayout', async () => {
      await getPanel().resetLayoutForCurrentModule();
    })
  );
}

export function deactivate(): void {
  panel?.dispose();
}
