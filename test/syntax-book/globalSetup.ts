import { acquirePlaywrightLock } from '../playwrightGlobalLock';

export default async function globalSetup() {
  acquirePlaywrightLock('test:syntax');
}
