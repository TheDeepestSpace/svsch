import { test } from '@playwright/test';
import {
  EXAMPLE_DESIGN_MODULES,
  expectGraphAndScreenshot,
  fitGraphView,
  openExampleDesignModule,
} from './helper';

test.describe('example design visual rendering', () => {
  for (const moduleName of EXAMPLE_DESIGN_MODULES) {
    test(`renders the ${moduleName} module`, async ({ page }) => {
      await openExampleDesignModule(page, moduleName);
      await fitGraphView(page, 0.2);

      await expectGraphAndScreenshot(page, `example-design-${moduleName}.png`);
    });
  }
});
