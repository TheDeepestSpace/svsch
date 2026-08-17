import type { FullConfig } from '@playwright/test';
import { acquirePlaywrightLock } from '../playwrightGlobalLock';
import { assertSafeSnapshotUpdateMode } from '../snapshotPolicy';
import { execSync } from 'child_process';
import path from 'path';

export default async function globalSetup(config: FullConfig) {
  assertSafeSnapshotUpdateMode(config);
  acquirePlaywrightLock('test:bdd');
  const root = path.resolve(__dirname, '../..');
  console.log('[SVSCH Playwright Lock] Running bddgen...');
  execSync('npx bddgen --config test/bdd/playwright.config.ts', { cwd: root, stdio: 'inherit' });
}
