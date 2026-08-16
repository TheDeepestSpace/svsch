import type { FullConfig } from '@playwright/test';
import { acquirePlaywrightLock } from '../playwrightGlobalLock';
import { assertSafeSnapshotUpdateMode } from '../snapshotPolicy';

export default async function globalSetup(config: FullConfig) {
  assertSafeSnapshotUpdateMode(config);
  acquirePlaywrightLock('test:system');
}
