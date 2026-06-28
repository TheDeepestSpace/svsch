# BDD Test Suite: Plain Browser → VSCode Emulation Migration

## Goal

Migrate the Cucumber BDD test suite from running against a standalone Vite dev server
(plain Playwright + mocked `acquireVsCodeApi`) to running inside a real VSCode instance
via `vscode-test-playwright`, matching how the system test suite works.

---

## Current Architecture

### BDD suite (what exists today)

| Aspect | Current implementation |
|--------|------------------------|
| Runner | `@cucumber/cucumber` via `scripts/test-bdd.sh` + `cucumber.js` |
| Browser | `chromium.launch()` per scenario in `Before` hook |
| Target URL | `http://127.0.0.1:5176/` (Vite dev server) |
| VSCode API | Mocked via `page.addInitScript(() => { window.acquireVsCodeApi = ... })` |
| Graph delivery | Test calls `buildDesignGraph` + `buildViewModel`, then `page.evaluate(window.postMessage({type:'graph',...}))` |
| Message capture | `(window).__svschMessages` accumulated via `console.log` listener |
| DOM access | `this.page` (Playwright `Page`) used directly in every step |
| Webview | Is the whole page — no iframe nesting |

### System test (target reference)

| Aspect | System test implementation |
|--------|---------------------------|
| Runner | `@playwright/test` via `test:system` script |
| Browser | VSCode Electron app launched by `vscode-test-playwright` |
| Fixtures | `workbox` (VSCode main `Page`), `evaluateInVSCode` |
| Graph delivery | Extension runs real pipeline; interceptor on `panel.webview.postMessage` captures state |
| Message capture | `evaluateInVSCode` reads `(global).__svschLogs` / `__svschFireWebviewMessage` |
| DOM access | `workbox` for workbench; `workbox.frameLocator('iframe.webview').frameLocator('iframe#active-frame')` for webview content |

---

## Migration Strategy

### Test runner: keep Cucumber, add `playwright-bdd` as the bridge

`vscode-test-playwright` fixtures (`workbox`, `evaluateInVSCode`) only exist inside a
Playwright test worker. Cucumber's `World` has no native path to them.

The cleanest fix is **`playwright-bdd`** — a small package that lets Playwright's test
runner execute `.feature` files with full fixture access. Feature files are unchanged;
step definitions are rewritten once to use Playwright fixtures instead of the Cucumber
`World`.

Alternative considered: manually launch VSCode inside Cucumber's `Before` hook via
`@vscode/test-electron` + CDP. Rejected because it replicates what `vscode-test-playwright`
already encapsulates and makes worker lifecycle fragile.

### Graph-posting strategy: keep direct graph injection

The BDD tests call `buildDesignGraph` + `buildViewModel` directly (no real Surelog/extension
pipeline). This should be preserved for speed and determinism. In VSCode mode we replicate
the system test's `createWebviewPanel` interceptor so we can:

- Push a graph message into the webview: `evaluateInVSCode` → `panel.webview.postMessage(msg)`
- Read messages out of the webview: `evaluateInVSCode` → `__svschFireWebviewMessage` pattern
  (extension-host sees webview messages via the intercepted `onDidReceiveMessage`)

This means the BDD tests still never actually run Surelog; they just drive the webview UI
the same way as before, but now through the real VSCode shell.

### VSCode version

Start with a single version (`1.91.0`) — the same pin used in the existing system test
playwright.config.ts. Multi-version matrix comes later.

---

## Concrete Changes Required

### 1. New dependency: `playwright-bdd`

```
npm install --save-dev playwright-bdd
```

`@cucumber/cucumber` can remain for its step-definition typings; `playwright-bdd` re-exports
them from `@cucumber/cucumber` and wraps Playwright's test executor around them.

### 2. New BDD playwright config: `test/bdd/playwright.config.ts`

Mirrors `test/system/playwright.config.ts` but points `testDir` at the steps/features
and uses `defineBddConfig()` from `playwright-bdd`.

```typescript
import { defineConfig } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';
import type { VSCodeWorkerOptions, VSCodeTestOptions } from 'vscode-test-playwright';

const bddConfig = defineBddConfig({
  features: 'test/features/**/*.feature',
  steps: 'test/steps/**/*.ts',
});

export default defineConfig<VSCodeTestOptions, VSCodeWorkerOptions>({
  testDir: bddConfig.outputDir,
  workers: 1,             // VSCode launch is expensive; keep sequential
  timeout: 120_000,
  use: {
    extensionDevelopmentPath: process.cwd(),
    baseDir: path.join(process.cwd(), 'test'), // same workspace as system test
    vscodeVersion: process.env.VSCODE_VERSION || '1.91.0',
  },
});
```

### 3. New world/fixture file: `test/steps/fixtures.ts`

Defines a `test` object that merges `vscode-test-playwright`'s fixtures with the BDD
world state. The `CustomWorld` class disappears; its fields become properties on the
`BddWorld` fixture.

```typescript
import { test as base } from 'vscode-test-playwright';
import { createBdd } from 'playwright-bdd';

export type BddFixtures = {
  page: Page;          // re-exported as webviewPage (the inner iframe)
  evaluateInVSCode: <T>(fn: (vscode: typeof import('vscode')) => T) => Promise<T>;
  // ... bdd world state fields
};

export const test = base.extend<BddFixtures>({ ... });
export const { Given, When, Then, Before, After } = createBdd(test);
```

### 4. Rewrite `test/steps/diagram.steps.ts`

This is the bulk of the work. All step definitions import `{ Given, When, Then }` from
`./fixtures` instead of `@cucumber/cucumber`. The transformation rules:

| Old pattern | New pattern |
|-------------|-------------|
| `this.page!.locator(...)` | `webviewPage.locator(...)` where `webviewPage = workbox.frameLocator('iframe.webview').frameLocator('iframe#active-frame')` |
| `this.browser = await chromium.launch(...)` in `Before` | Removed — VSCode launched by fixture |
| `this.page.goto(...)` | Removed — VSCode opens the webview via `evaluateInVSCode` |
| `this.page.addInitScript(acquireVsCodeApi mock)` | Removed — real VSCode provides `acquireVsCodeApi` |
| `page.evaluate(window.postMessage({type:'graph',...}))` | `evaluateInVSCode(vscode => { panel.webview.postMessage({type:'graph',...}) })` using stored panel reference |
| `webviewMessages(this.page)` → `(window).__svschMessages` | `evaluateInVSCode(() => (global).__svschMessages)` |
| `this.page.evaluate(reactFlowInstance.getNodes())` | `webviewPage.evaluate(...)` — same JS, different page context |
| `this.messages` (webview→extension messages) | `evaluateInVSCode(() => (global).__svschReceivedMessages)` accumulated by `onDidReceiveMessage` interceptor |
| Screenshot: `this.page.screenshot()` | `workbox.screenshot()` (full VSCode window) or `webviewPage` as appropriate |

### 5. VSCode interceptor setup in `Before`

Reuse and extend the interceptor pattern from `test/system/diagram.spec.ts`:

```typescript
Before(async ({ evaluateInVSCode, workbox }) => {
  // Install panel interceptor (same as system test)
  await evaluateInVSCode(vscode => {
    // intercept createWebviewPanel to capture panel.webview.postMessage
    // and panel.webview.onDidReceiveMessage
    // store as (global).__svschPanel
  });

  // Open the diagram once to create the panel
  await evaluateInVSCode(vscode => {
    void vscode.commands.executeCommand('svsch.openDiagram');
  });
  await workbox.waitForSelector('.tab[aria-label*="SVSCH"]', { timeout: 30_000 });
});
```

### 6. `postGraph` / `postCurrentView` helpers

The core graph-posting logic stays in Node.js (still calls `buildDesignGraph` +
`buildViewModel`). Only the final delivery changes:

```typescript
// old
await page.evaluate(({ view, modules }) => {
  window.postMessage({ type: 'graph', view, modules }, '*');
}, { view: viewModel, modules });

// new
await evaluateInVSCode((vscode, { view, modules }) => {
  (global as any).__svschPanel?.webview.postMessage({ type: 'graph', view, modules });
}, { view: viewModel, modules });
```

The webview receives the message identically — the only difference is the delivery path
goes through the real VSCode webview bridge instead of the mock.

### 7. Message capture helpers

```typescript
// old: webviewMessages(page)
//   reads (window).__svschMessages from inside the webview JS

// new: webviewMessages(evaluateInVSCode)
//   reads from extension-host global accumulated by onDidReceiveMessage interceptor
async function webviewMessages(evaluateInVSCode): Promise<any[]> {
  return evaluateInVSCode(() => (global as any).__svschReceivedMessages ?? []);
}
```

### 8. CLI steps — no change needed

Steps that use `execFileAsync` / `execAsync` (CLI rendering) have no browser/page
dependency. They remain identical.

### 9. Snapshot directories

Visual snapshots currently live in `test/features/snapshots/`. For VSCode emulation the
screenshots capture the full workbench window (like system tests). Plan:

- Keep existing snapshot directory for the plain-browser baseline
- New VSCode-mode snapshots go to `test/features/__screenshots__/1.91.0/`
- Snapshot update command: `UPDATE_SNAPSHOTS=1 npm run test:bdd`

### 10. `npm run test:bdd` script update

Update `scripts/test-bdd.sh` (or add a new `test:bdd:vscode` npm script) to run:

```bash
env -u ELECTRON_RUN_AS_NODE xvfb-run --auto-servernum \
  playwright test --config test/bdd/playwright.config.ts
```

---

## Implementation Phases

### Phase 1 — Scaffolding (no step changes yet)

1. Install `playwright-bdd`
2. Create `test/bdd/playwright.config.ts`
3. Create `test/steps/fixtures.ts` with VSCode world fixture
4. Add `Before`/`After` hooks that launch VSCode and install the panel interceptor
5. Verify a single smoke scenario runs (e.g. "Observing input and output ports") without failures

Acceptance: `npm run test:bdd:vscode` runs the smoke scenario end-to-end in VSCode.

### Phase 2 — Migrate `this.page` usages

1. Replace all `this.page!.locator(...)` in steps with `webviewPage.locator(...)`
2. Replace all `this.page!.evaluate(...)` that access React Flow state with `webviewPage.evaluate(...)`
3. Replace `this.page!.mouse.*` drag operations with equivalent on `webviewPage`
4. Replace `this.page!.waitForSelector(...)` / `waitForTimeout(...)` accordingly

Acceptance: All non-screenshot steps pass for `diagram_interaction.feature` and `schematic_observation.feature`.

### Phase 3 — Migrate graph posting and message capture

1. Port `postGraph` / `postCurrentView` / `selectModule` to use `evaluateInVSCode`
2. Port `webviewMessages()` to read from extension-host global
3. Port `dragPortNodeTo` (needs both webviewPage for DOM and evaluateInVSCode for messages)

Acceptance: `diagram_interaction.feature` (node dragging, layout persistence) passes fully.

### Phase 4 — Migrate remaining features

1. `dynamic_updates.feature` — file editing + workspace graph
2. `navigation.feature` — double-click navigateToSource
3. `schematic_observation.feature` — node type assertions
4. `variable_bit_select.feature`
5. `command_line_interface.feature` — CLI steps (mostly no-ops, but verify workspace setup)

### Phase 5 — Snapshot baseline

1. Run with `UPDATE_SNAPSHOTS=1` to capture new VSCode-mode baselines
2. Review generated screenshots
3. Remove or archive old plain-browser snapshots

---

## Files Changed / Created

| File | Action |
|------|--------|
| `package.json` | Add `playwright-bdd` devDependency; add `test:bdd:vscode` script |
| `test/bdd/playwright.config.ts` | New — VSCode-mode BDD playwright config |
| `test/steps/fixtures.ts` | New — `test` fixture merging vscode-test-playwright + BDD world |
| `test/steps/diagram.steps.ts` | Rewrite — swap `this.page` → `webviewPage`; swap `page.evaluate(postMessage)` → `evaluateInVSCode` |
| `cucumber.js` | Kept for reference / plain-browser mode; not deleted until VSCode mode is stable |
| `scripts/test-bdd.sh` | Add VSCode variant invocation |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| VSCode webview iframe cross-origin blocks some Playwright APIs | Use `webviewPage` (inner frameLocator) for DOM; avoid `page.evaluate` on the outer `workbox` for webview DOM |
| Panel interceptor timing (scenario runs before `createWebviewPanel` is patched) | Install interceptor in `Before` before opening any file; assert panel is captured before posting graph |
| `reactFlowInstance` global not available in webview iframe | Same `page.evaluate` pattern works inside `webviewPage`; `reactFlowInstance` is set by the React app on mount |
| Scenario isolation — VSCode stays open between scenarios | `After` hook clears workspace files, resets layout state, and sends an empty graph to blank the webview instead of closing/reopening VSCode for each scenario |
| `xvfb-run` not available in some CI environments | Already required by `test:system`; no new constraint |

---

## Out of Scope (this migration)

- Multi-version VSCode matrix (handled by existing `test:system:all` pattern; apply same approach later)
- Visual snapshot comparison tooling changes
- Migrating `test/visual/` (those tests don't use Cucumber)
- CLI feature file scenarios that have no UI component (they stay unchanged)
