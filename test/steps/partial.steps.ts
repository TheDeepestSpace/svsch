import { When, Then, BddWorld } from './fixtures';
import type { FrameLocator } from '@playwright/test';
import { expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Partial Diagram (issue #403) steps — the second "SVSCH Partial Diagram"
// webview pane. Panel addressing goes through BddWorld's activeOuterFrameIndex
// (see fixtures.ts): after "I switch to the partial diagram panel" every
// existing step helper (node lookups, position notes, screenshots) targets
// the partial pane instead of the main diagram.
// ---------------------------------------------------------------------------

const PARTIAL_TAB_SELECTOR =
  '.tab[aria-label*="SVSCH Partial Diagram"], .tab[title*="SVSCH Partial Diagram"]';

// Mirror of the module-local helpers in diagram.steps.ts (deliberately not
// exported there).
function exactText(text: string): RegExp {
  return new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

function cutNetLabelNodes(webviewPage: FrameLocator, label: string) {
  return webviewPage.locator('[data-node-kind="netLabel"]').filter({
    has: webviewPage.locator('.hdl-net-label-text-value').filter({ hasText: exactText(label) }),
  });
}

// The currently-active panel's real (non-label) block count — unlike
// partialPaneBlockCount below, this assumes the world is already switched to
// the pane of interest (see "I switch to the partial diagram panel") rather
// than scanning every outer iframe for the partial shell.
async function activePaneBlockCount(world: BddWorld): Promise<number> {
  return world.webviewPage.locator('.react-flow__node:not([data-node-kind="netLabel"])').count();
}

// The number of real (non-label) blocks currently rendered in the partial
// pane, or null while no partial pane webview exists yet. Scans the outer
// webview iframes the same way findPanelFrameIndex does, without disturbing
// the world's active-panel selection.
async function partialPaneBlockCount(world: BddWorld): Promise<number | null> {
  const frames = await world.workbox.locator('iframe.webview').count();
  for (let index = 0; index < frames; index++) {
    const frame = world.workbox
      .frameLocator('iframe.webview')
      .nth(index)
      .frameLocator('iframe#active-frame');
    const isPartial = await frame
      .locator('.shell[data-svsch-partial="true"]')
      .count()
      .catch(() => 0);
    if (isPartial > 0) {
      return frame
        .locator('.react-flow__node:not([data-node-kind="netLabel"])')
        .count()
        .catch(() => 0);
    }
  }
  return null;
}

// Clicks the selection toolbar's "Add to Partial" button. Unlike the generic
// "I click the {string} button" step this doesn't wait for a layout-file
// write — opening/adding to the partial pane never persists anything.
When('I add the selected block to the partial diagram', async function (this: BddWorld) {
  const blocksBefore = (await partialPaneBlockCount(this)) ?? 0;
  const button = this.webviewPage.locator('.svsch-selection-toolbar button', {
    hasText: 'Add to Partial',
  });
  await expect(button).toBeVisible();
  await button.click();
  // The screenshot below captures the whole workbench, and the click returns
  // while VS Code is still creating (or re-laying-out) the partial webview —
  // an immediate capture lands on a blank transient. Wait until the added
  // block actually rendered in the partial pane.
  const deadline = Date.now() + 30_000;
  for (;;) {
    const blocks = await partialPaneBlockCount(this);
    if (blocks !== null && blocks > blocksBefore) break;
    if (Date.now() > deadline) {
      throw new Error(
        `Partial pane block count did not increase past ${blocksBefore} after Add to Partial`,
      );
    }
    await this.workbox.waitForTimeout(250);
  }
  // Let the editor-split relayout settle so the main pane isn't captured
  // mid-resize.
  await this.workbox.waitForTimeout(300);
  await this.takeScreenshot('After clicking Add to Partial');
});

Then('the SVSCH partial diagram panel opens', async function (this: BddWorld) {
  await this.workbox.waitForSelector(PARTIAL_TAB_SELECTOR, { timeout: 30_000 });
  // The pane exists — also wait until its webview document actually rendered
  // the partial shell, so a following switch step can't race panel startup.
  await this.findPanelFrameIndex('partial');
});

Then('there should be exactly one partial diagram panel', async function (this: BddWorld) {
  await expect(this.workbox.locator(PARTIAL_TAB_SELECTOR)).toHaveCount(1);
});

Then('the SVSCH partial diagram panel is closed', async function (this: BddWorld) {
  await expect(this.workbox.locator(PARTIAL_TAB_SELECTOR)).toHaveCount(0);
});

When('I switch to the partial diagram panel', async function (this: BddWorld) {
  await this.switchToPanel('partial');
  // Wait for content: the partial always holds at least the block it was
  // opened with.
  await this.webviewPage.locator('.react-flow__node').first().waitFor({ timeout: 30_000 });
  await this.takeScreenshot('Viewing the partial diagram');
});

When('I switch to the main diagram panel', async function (this: BddWorld) {
  await this.switchToPanel('main');
});

When('I close the partial diagram panel', async function (this: BddWorld) {
  const tab = this.workbox.locator(PARTIAL_TAB_SELECTOR).first();
  await expect(tab).toBeVisible();
  await tab.click();
  await this.workbox.waitForTimeout(300);
  await this.evaluateInVSCode((_vscode) =>
    (_vscode as any).commands.executeCommand('workbench.action.closeActiveEditor'),
  );
  await expect(this.workbox.locator(PARTIAL_TAB_SELECTOR)).toHaveCount(0);
  await this.switchToPanel('main');
});

When(
  'I click the extend arrow on the cut net {string}',
  async function (this: BddWorld, label: string) {
    const labelNode = cutNetLabelNodes(this.webviewPage, label).first();
    await expect(labelNode).toBeVisible();
    await labelNode.hover({ force: true });
    const extend = labelNode.locator('.hdl-net-label-extend');
    await expect(extend).toBeVisible();
    await extend.click();
    // Clear the hover so the following screenshot isn't captured mid-reveal.
    await this.webviewPage.locator('body').hover({ position: { x: 10, y: 10 }, force: true });
    await this.takeScreenshot(`After extending the cut net ${label}`);
  },
);

Then(
  'the extend arrow should be visible on the cut net {string}',
  async function (this: BddWorld, label: string) {
    const labelNode = cutNetLabelNodes(this.webviewPage, label).first();
    await expect(labelNode).toBeVisible();
    await labelNode.hover({ force: true });
    await expect(labelNode.locator('.hdl-net-label-extend')).toBeVisible();
  },
);

// Repeatedly clicks whatever cut net label happens to be first, until none
// remain — i.e. every wire the source module has gets manually extended back
// in, one node at a time. Deliberately doesn't address labels by name: cut
// nets sourced from a mux or literal (as opposed to a port/instance/register/
// latch) get an anonymous "NET_n" fallback label (see defaultNetCutLabel in
// mergeLayout.ts) whose exact text and numbering shift as the partial grows,
// so asserting against it here would be asserting an implementation detail
// rather than the feature. Each successful extend adds exactly one new real
// block (the far end of that label's own edge — see extendNet in
// partialDiagramPanel.ts), which is what the block-count poll below waits on.
When('I extend every cut net in the partial diagram', async function (this: BddWorld) {
  const netLabels = this.webviewPage.locator('[data-node-kind="netLabel"]');
  const maxExtends = 40;
  for (let i = 0; i < maxExtends; i++) {
    if ((await netLabels.count()) === 0) break;
    const blocksBefore = await activePaneBlockCount(this);
    const label = netLabels.first();
    await label.hover({ force: true });
    const extend = label.locator('.hdl-net-label-extend');
    await expect(extend).toBeVisible();
    await extend.click();
    await expect
      .poll(() => activePaneBlockCount(this), { timeout: 10_000 })
      .toBeGreaterThan(blocksBefore);
  }
  // Clear the hover so the following screenshot isn't captured mid-reveal.
  await this.webviewPage.locator('body').hover({ position: { x: 10, y: 10 }, force: true });
  await expect(netLabels).toHaveCount(0, { timeout: 10_000 });
  await this.takeScreenshot('After extending every cut net in the partial diagram');
});

Then('I should not see any cut net labels in the partial diagram', async function (this: BddWorld) {
  await expect(this.webviewPage.locator('[data-node-kind="netLabel"]')).toHaveCount(0);
});

// The partial pane's toolbar mirrors the main diagram's (see DiagramToolbar
// in main.tsx — only the module select and Export SVG are gated off for
// partial), so "Auto Layout All" is available and releases every real block
// for one ELK pass exactly like it does on the main diagram. Unlike the main
// diagram's generic "I click {string} in the diagram toolbar" step, this
// can't poll the saved-layout file for a diff: the partial pane's layout
// lives only in the extension host's memory and is never written to disk
// (see PartialDiagramPanel) — the round trip is given time to settle instead.
When('I click "Auto Layout All" in the partial diagram toolbar', async function (this: BddWorld) {
  await this.webviewPage.locator('body').hover({ position: { x: 10, y: 10 }, force: true });
  const button = this.webviewPage.locator('.toolbar button', { hasText: 'Auto Layout All' });
  await expect(button).toBeVisible();
  await button.click();
  await this.workbox.waitForTimeout(1000);
  await this.webviewPage.locator('.react-flow__node').first().waitFor({ timeout: 10_000 });
  await this.takeScreenshot('After clicking Auto Layout All in the partial diagram');
});
