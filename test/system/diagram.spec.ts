import { test, expect } from 'vscode-test-playwright';
import path from 'path';
import fs from 'fs';

  const logDir = path.resolve(__dirname, '../../test-results/system/artifacts');
  const webviewLogs: string[] = [];

  test.beforeEach(async ({ workbox }) => {
    fs.mkdirSync(logDir, { recursive: true });
    workbox.on('console', msg => {
      const line = `[WEBVIEW CONSOLE] [${msg.type()}] ${msg.text()}`;
      webviewLogs.push(line);
      if (msg.type() === 'error') console.error(line);
    });
  });

test('opens svsch diagram and captures screenshot + output logs', async ({
  workbox,
  evaluateInVSCode,
}) => {
  try {
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
      // (a) Capture SVSCH output channel log lines and console calls.
      const captureLine = (line: string) => {
        if (!(global as any).__svschLogs) (global as any).__svschLogs = [];
        (global as any).__svschLogs.push(line);
      };

      const origCreateChannel = vscode.window.createOutputChannel;
      (vscode.window as any).createOutputChannel = function (name: string, ...args: any[]) {
        const ch = (origCreateChannel as any).call(vscode.window, name, ...args);
        if (name === 'SVSCH') {
          const origAppend = ch.appendLine.bind(ch);
          ch.appendLine = (line: string) => {
            captureLine(line);
            return origAppend(line);
          };
        }
        return ch;
      };

      const origLog = console.log;
      console.log = (...args: any[]) => {
        captureLine(`[CONSOLE.LOG] ${args.join(' ')}`);
        return origLog.apply(console, args);
      };
      const origError = console.error;
      console.error = (...args: any[]) => {
        captureLine(`[CONSOLE.ERROR] ${args.join(' ')}`);
        return origError.apply(console, args);
      };
      const origWarn = console.warn;
      console.warn = (...args: any[]) => {
        captureLine(`[CONSOLE.WARN] ${args.join(' ')}`);
        return origWarn.apply(console, args);
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
              
              const nodes = msg.view?.nodes?.length ?? 0;
              const edges = msg.view?.edges?.length ?? 0;
              captureLine(`[WEBVIEW] Received graph for ${msg.view?.moduleName}: ${nodes} nodes, ${edges} edges`);
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

    const webviewIframe = workbox.frameLocator('iframe.webview').frameLocator('iframe#active-frame');

    // --- 8. Poll until the first graph arrives. Older supported VS Code
    //     builds can take longer to cold-start the extension and Surelog.
    let loaded = false;
    for (let i = 0; i < 180; i++) {
      loaded = await evaluateInVSCode(vscode => {
        void vscode;
        return ((global as any).__svschGraphCount ?? 0) > 0;
      });
      if (loaded) break;
      await workbox.waitForTimeout(500);
    }

    // The extension-host postMessage interceptor can miss the first graph on
    // some VS Code builds even though the webview has rendered. Treat the
    // visible diagram shell as the authoritative fallback.
    if (!loaded) {
      loaded = await webviewIframe.locator('.shell select[aria-label="Module"]').isVisible({ timeout: 1_000 }).catch(() => false);
    }
    expect(loaded, 'Expected graph to be received by webview').toBe(true);

    // Let the React render settle before snapshotting.
    await webviewIframe.locator('.react-flow__node').first().waitFor();
    await webviewIframe.locator('body').evaluate(() => document.fonts.ready);
    await workbox.waitForTimeout(1_000);

    // Verify the webview iframe exists
    try {
      await expect(webviewIframe.locator('.shell')).toBeVisible({ timeout: 20_000 });
    } catch (e) {
      const html = await workbox.mainFrame().locator('body').innerHTML().catch(() => 'could not capture body');
      console.log('--- WORKBOX BODY HTML ---');
      console.log(html);
      console.log('--- END WORKBOX BODY HTML ---');
      
      const webviewHtml = await workbox.frameLocator('iframe.webview').locator('body').innerHTML().catch(() => 'could not capture webview body');
      console.log('--- WEBVIEW BODY HTML ---');
      console.log(webviewHtml);
      console.log('--- END WEBVIEW BODY HTML ---');
      throw e;
    }

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
    //     We prioritize a complex module to ensure meaningful screenshots.
    const switchedViaHost = await evaluateInVSCode(vscode => {
      void vscode;
      const modules: string[] = (global as any).__svschModules ?? [];
      const complexModule = modules.find(m => m === 'aggregate_assignment_showcase');
      const next = complexModule || modules.find((m: string) => m !== (global as any).__svschCurrentModule);
      
      if (!next || next === (global as any).__svschCurrentModule || !(global as any).__svschFireWebviewMessage) return false;
      
      (global as any).__svschGraphCountBeforeSwitch = (global as any).__svschGraphCount ?? 0;
      (global as any).__svschFireWebviewMessage({ type: 'openModule', moduleName: next });
      return true;
    });

    if (switchedViaHost) {
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
    } else {
      const moduleSelect = webviewIframe.locator('select[aria-label="Module"]');
      const next = await moduleSelect.locator('option').evaluateAll((options) => {
        const values = options.map((option) => (option as HTMLOptionElement).value);
        const selected = options.find(option => (option as HTMLOptionElement).selected) as HTMLOptionElement | undefined;
        return values.find(value => value === 'aggregate_assignment_showcase')
          ?? values.find(value => value !== selected?.value)
          ?? '';
      });
      if (next) {
        await moduleSelect.selectOption(next);
      }
    }

    // Let the React render settle before snapshotting.
    await webviewIframe.locator('.react-flow__node').first().waitFor();
    await webviewIframe.locator('body').evaluate(() => document.fonts.ready);
    await workbox.waitForTimeout(1_000);

    await expect(workbox).toHaveScreenshot('full-window-second-module.png');

  } finally {
    // --- 12. Collect captured log lines (even on failure).
    const logs: string[] = await evaluateInVSCode(vscode => {
      void vscode;
      return (global as any).__svschLogs ?? [];
    }).catch(() => []);

    const combinedLogs = [...logs, ...webviewLogs];
    fs.writeFileSync(path.join(logDir, 'svsch-output.log'), combinedLogs.join('\n'), 'utf8');

    if (logs.length) {
      console.log('--- SVSCH OUTPUT LOGS ---');
      console.log(logs.join('\n'));
      console.log('--- END SVSCH OUTPUT LOGS ---');
    }

    if (webviewLogs.length) {
      console.log('--- WEBVIEW CONSOLE LOGS ---');
      console.log(webviewLogs.join('\n'));
      console.log('--- END WEBVIEW CONSOLE LOGS ---');
    }
  }
});
