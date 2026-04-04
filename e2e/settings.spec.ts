/**
 * Settings page E2E tests + visual snapshots.
 *
 * The settings panel requires an authenticated session to access.
 * Currently, the Tauri mock does not simulate a full login flow,
 * so these tests are skipped until the test fixture supports
 * authenticated state (e.g., via localStorage/IndexedDB seeding).
 *
 * TODO: Implement authenticated fixture in test-fixtures.ts,
 * then remove the .skip annotations below.
 */

import { test, expect } from './helpers/test-fixtures';

test.describe('Settings Page', () => {
  test.skip('settings panel renders correctly', async ({ page }) => {
    // Requires authenticated state
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Navigate to settings (requires login first)
    // await page.click('[data-testid="settings-button"]');

    await expect(page).toHaveScreenshot('settings-panel.png', {
      animations: 'disabled',
    });
  });

  test.skip('theme toggle changes visual appearance', async ({ page }) => {
    // Requires authenticated state
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Switch to dark theme
    // await page.click('[data-testid="theme-toggle"]');

    await expect(page).toHaveScreenshot('settings-dark-theme.png', {
      animations: 'disabled',
    });
  });
});
