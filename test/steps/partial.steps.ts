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

// Clicks the selection toolbar's "Add to Partial" button. Unlike the generic
// "I click the {string} button" step this doesn't wait for a layout-file
// write — opening/adding to the partial pane never persists anything.
When('I add the selected block to the partial diagram', async function (this: BddWorld) {
  const button = this.webviewPage.locator('.svsch-selection-toolbar button', {
    hasText: 'Add to Partial',
  });
  await expect(button).toBeVisible();
  await button.click();
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
