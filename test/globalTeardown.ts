import { releasePlaywrightLock } from './playwrightGlobalLock';

export default async function globalTeardown() {
  releasePlaywrightLock();
}
