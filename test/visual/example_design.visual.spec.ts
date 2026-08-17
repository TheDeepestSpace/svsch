import { test } from '@playwright/test';
import { expectGraphAndScreenshot, fitGraphView, openExampleDesignModule } from './helper';

const EXAMPLE_DESIGN_MODULES = [
  'adder',
  'alu',
  'control_unit',
  'cpu_top',
  'data_mem',
  'imm_gen',
  'instr_mem',
  'mux2',
  'pc_reg',
  'register_file'
];

test.describe('example design visual rendering', () => {
  for (const moduleName of EXAMPLE_DESIGN_MODULES) {
    test(`renders the ${moduleName} module`, async ({ page }) => {
      await openExampleDesignModule(page, moduleName);
      await fitGraphView(page, 0.2);

      await expectGraphAndScreenshot(page, `example-design-${moduleName}.png`);
    });
  }
});
