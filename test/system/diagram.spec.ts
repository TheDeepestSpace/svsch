import { test, expect } from 'vscode-test-playwright';
import path from 'path';
import fs from 'fs';

const logDir = path.resolve(__dirname, '../../test-results/system/artifacts');

test.beforeEach(async () => {
  fs.mkdirSync(logDir, { recursive: true });
});

test('opens svsch diagram and captures screenshot + output logs', async ({
  workbox,
  evaluateInVSCode,
}) => {
  // --- 1. Wait for the VSCode workbench to be interactive.
  await workbox.waitForSelector('.monaco-workbench', { timeout: 30_000 });
  await workbox.waitForTimeout(2_000);

  // --- 2. Dismiss any notification toasts that appeared during startup
  //     (e.g. the "git repository found" prompt) so they don't pollute
  //     the screenshot. Settings suppress most, but some fire before
  //     settings are read.
  for (const button of await workbox.locator('.notification-toast button', { hasText: /Never|Don't show/i }).all()) {
    await button.click().catch(() => {});
  }
  const closeAll = workbox.locator('.notifications-toasts .codicon-notifications-clear-all');
  if (await closeAll.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await closeAll.click();
  }

  // --- 3. Install pre-activation interceptors before any svsch.* command fires.
  //     Extension activates lazily on svsch.* commands, so these patches
  //     land before logger.init() and DiagramPanel construction are called.
  await evaluateInVSCode(vscode => {
    // (a) Capture SVSCH output channel log lines.
    const origCreateChannel = vscode.window.createOutputChannel;
    (vscode.window as any).createOutputChannel = function (name: string, ...args: any[]) {
      const ch = (origCreateChannel as any).call(vscode.window, name, ...args);
      if (name === 'SVSCH') {
        const origAppend = ch.appendLine.bind(ch);
        ch.appendLine = (line: string) => {
          if (!(global as any).__svschLogs) (global as any).__svschLogs = [];
          (global as any).__svschLogs.push(line);
          return origAppend(line);
        };
      }
      return ch;
    };

    // (b) Intercept the SVSCH webview panel so tests can:
    //     • record timestamps for each phase of the build pipeline
    //     • read the modules list sent from the extension to the webview
    //     • simulate the webview posting an openModule message back to the extension
    //     The webview lives in a cross-origin iframe so Playwright cannot touch it
    //     directly; this extension-host patch is the only bridge available.
    const origCreatePanel = vscode.window.createWebviewPanel;
    (vscode.window as any).createWebviewPanel = function (viewType: string, title: string, ...args: any[]) {
      const panel = (origCreatePanel as any).call(vscode.window, viewType, title, ...args);
      if (viewType === 'svsch.diagram') {
        const origPostMessage = panel.webview.postMessage.bind(panel.webview);
        panel.webview.postMessage = (msg: any) => {
          const now = Date.now();
          if (msg?.type === 'status' && msg.status === 'rebuilding') {
            if (!(global as any).__svschRebuildingAt) {
              (global as any).__svschRebuildingAt = now;
            }
          }
          if (msg?.type === 'graph') {
            if (!(global as any).__svschFirstGraphAt) {
              (global as any).__svschFirstGraphAt = now;
            }
            (global as any).__svschModules = msg.modules;
            (global as any).__svschCurrentModule = msg.view?.moduleName;
            (global as any).__svschGraphCount = ((global as any).__svschGraphCount ?? 0) + 1;
          }
          if (msg?.type === 'status' && msg.status === 'idle') {
            (global as any).__svschIdleAt = now;
          }
          return origPostMessage(msg);
        };

        // Capture the extension's onDidReceiveMessage listener so we can invoke it
        // directly, simulating a message posted from the webview.
        const origOnDidReceiveMessage = panel.webview.onDidReceiveMessage;
        const msgListeners: Array<(msg: any) => void> = [];
        (panel.webview as any).onDidReceiveMessage = function (listener: any, thisArgs?: any, disposables?: any) {
          msgListeners.push(thisArgs ? listener.bind(thisArgs) : listener);
          return (origOnDidReceiveMessage as any).call(panel.webview, listener, thisArgs, disposables);
        };
        (global as any).__svschFireWebviewMessage = (msg: any) => {
          for (const l of msgListeners) l(msg);
        };
      }
      return panel;
    };
  });

  // --- 4. Clear the UHDM cache so Surelog always runs and the progress
  //     notification is guaranteed to appear during this test.
  await evaluateInVSCode(vscode => {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (ws) {
      const cacheUri = vscode.Uri.joinPath(ws, '.svsch', 'uhdm_cache');
      return vscode.workspace.fs.delete(cacheUri, { recursive: true, useTrash: false }).then(
        () => {}, () => {} // ignore "not found" errors
      );
    }
  });

  // --- 5. Fire openDiagram WITHOUT awaiting its returned Promise.
  //     executeCommand resolves only when the full rebuild finishes (~18 s),
  //     so returning it would block until Surelog completes and we'd never
  //     catch the progress notification mid-flight.
  await evaluateInVSCode(vscode => {
    (global as any).__svschOpenRequestedAt = Date.now();
    void vscode.commands.executeCommand('svsch.openDiagram');
  });

  // --- 6. Confirm the SVSCH panel tab opened.
  //     This ensures the webview is created and visible before we snapshot
  //     the progress notification.
  await workbox.waitForSelector(
    '.tab[aria-label*="SVSCH"], .tab[title*="SVSCH"]',
    { timeout: 30_000 }
  );

  // --- 7. Programmatically verify the progress notification appears.
  //     This replaces the unstable visual screenshot check.
  const progress = workbox.locator('.notification-toast', { hasText: 'SVSCH' });
  await progress.waitFor({ state: 'visible', timeout: 10_000 });
  await expect(progress).toContainText(/Extracting|Elaborating/);

  // --- 8. Poll until the first graph arrives (Surelog can take ~18 s cold).
  for (let i = 0; i < 60; i++) {
    const loaded: boolean = await evaluateInVSCode(vscode => {
      void vscode;
      return ((global as any).__svschGraphCount ?? 0) > 0;
    });
    if (loaded) break;
    await workbox.waitForTimeout(500);
  }
  // Let the React render settle before snapshotting.
  await workbox.waitForTimeout(1_000);

  // Dismiss any notifications that appeared during parsing.
  for (const button of await workbox.locator('.notification-toast button', { hasText: /Never|Don't show/i }).all()) {
    await button.click().catch(() => {});
  }

  // --- 9. Snapshot the full VSCode window for the first module.
  //     Note: VSCode webview panels render in cross-origin iframes
  //     (vscode-webview:// vs vscode-file://) which Playwright cannot
  //     access from the main page context. The full-window snapshot is
  //     the primary visual regression artifact for system tests.
  await expect(workbox).toHaveScreenshot('full-window.png');

  // --- 10. Report load timing.
  const timing = await evaluateInVSCode(vscode => {
    void vscode;
    const openedAt: number = (global as any).__svschOpenRequestedAt ?? 0;
    const rebuildingAt: number = (global as any).__svschRebuildingAt ?? 0;
    const firstGraphAt: number = (global as any).__svschFirstGraphAt ?? 0;
    const idleAt: number = (global as any).__svschIdleAt ?? 0;
    return { openedAt, rebuildingAt, firstGraphAt, idleAt };
  });

  const toMs = (a: number, b: number) => b > 0 && a > 0 ? b - a : -1;
  const startup  = toMs(timing.openedAt, timing.rebuildingAt);
  const parse    = toMs(timing.rebuildingAt, timing.firstGraphAt);
  const total    = toMs(timing.openedAt, timing.firstGraphAt);
  const settle   = toMs(timing.firstGraphAt, timing.idleAt);

  const timingLines = [
    `[timing] openDiagram → rebuilding status : ${startup  >= 0 ? startup  + ' ms' : 'n/a'}`,
    `[timing] rebuilding  → first graph data  : ${parse    >= 0 ? parse    + ' ms' : 'n/a'}`,
    `[timing] openDiagram → diagram visible   : ${total    >= 0 ? total    + ' ms' : 'n/a'} (total)`,
    `[timing] first graph → idle status       : ${settle   >= 0 ? settle   + ' ms' : 'n/a'}`,
  ];
  for (const line of timingLines) console.log(line);
  fs.writeFileSync(path.join(logDir, 'timing.log'), timingLines.join('\n') + '\n', 'utf8');

  // --- 11. Switch to a different module via the dropdown.
  //     We fire an openModule message into the extension's handler directly
  //     (same path as the webview <select> onChange) and poll until the
  //     extension sends a new graph back to the webview.
  await evaluateInVSCode(vscode => {
    void vscode;
    const modules: string[] = (global as any).__svschModules ?? [];
    const current: string = (global as any).__svschCurrentModule ?? '';
    const next = modules.find((m: string) => m !== current);
    if (!next) return;
    (global as any).__svschGraphCountBeforeSwitch = (global as any).__svschGraphCount ?? 0;
    (global as any).__svschFireWebviewMessage({ type: 'openModule', moduleName: next });
  });

  // Poll until the extension has sent the new graph (max 15 s).
  for (let i = 0; i < 30; i++) {
    const received: boolean = await evaluateInVSCode(vscode => {
      void vscode;
      const before: number = (global as any).__svschGraphCountBeforeSwitch ?? 0;
      const now: number = (global as any).__svschGraphCount ?? 0;
      return now > before;
    });
    if (received) break;
    await workbox.waitForTimeout(500);
  }

  // Let the React render settle before snapshotting.
  await workbox.waitForTimeout(1_000);

  await expect(workbox).toHaveScreenshot('full-window-second-module.png');

  // --- 12. Collect captured log lines.
  const logs: string[] = await evaluateInVSCode(vscode => {
    void vscode;
    return (global as any).__svschLogs ?? [];
  });

  fs.writeFileSync(path.join(logDir, 'svsch-output.log'), logs.join('\n'), 'utf8');

  console.log(`[system] log lines captured: ${logs.length}`);
  if (logs.length) console.log(`[system] first log: ${logs[0]}`);

  // --- Assertions ---
  expect(logs.length, 'Expected SVSCH output channel to have log entries').toBeGreaterThan(0);
});
