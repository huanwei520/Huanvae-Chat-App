/**
 * Authentication page E2E tests + visual snapshots.
 *
 * Tests the login/register flow rendered by App.tsx.
 * The app starts on a loading screen, then shows either
 * AccountSelector (if saved accounts exist) or Login form.
 */

import { test, expect } from './helpers/test-fixtures';

test.describe('Authentication Pages', () => {
  test('login page renders correctly', async ({ page }) => {
    await page.goto('/');

    // Wait for the app to finish loading and show auth form
    // The app shows a loading overlay first, then transitions to login
    await page.waitForLoadState('networkidle');

    // Take visual snapshot of whatever auth state is shown
    await expect(page).toHaveScreenshot('auth-initial.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  test('login form has expected input fields', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Look for typical login form elements (input fields)
    const inputs = page.locator('input');
    const inputCount = await inputs.count();

    // Should have at least server URL + user ID + password fields
    expect(inputCount).toBeGreaterThanOrEqual(2);
  });

  test('login form accepts user input', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Find and fill input fields
    const inputs = page.locator('input');
    const count = await inputs.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Fill the first visible text input
    const firstInput = inputs.first();
    await firstInput.fill('test-input');
    await expect(firstInput).toHaveValue('test-input');
  });

  test('auth page visual - dark theme', async ({ page }) => {
    // Emulate dark color scheme
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('auth-dark-theme.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });

  test('auth page visual - mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('auth-mobile.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });
});
