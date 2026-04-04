import { test as base, expect } from '@playwright/test';
import { setupTauriMocks } from './tauri-mock';

/**
 * Extended test fixture with automatic Tauri API mock injection.
 * All E2E tests should import { test, expect } from this file
 * instead of directly from @playwright/test.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await setupTauriMocks(page);
    await use(page);
  },
});

export { expect };
