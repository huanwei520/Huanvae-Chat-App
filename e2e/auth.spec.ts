/**
 * Authentication page E2E tests + visual snapshots.
 *
 * Tests the login/register flow rendered by App.tsx.
 * The app starts on a loading screen, then shows either
 * AccountSelector (if saved accounts exist) or Login form.
 */

import { test, expect } from './helpers/test-fixtures';
import { currentVisualGate, printVisualGateNotice } from './helpers/visual-authority';

// 本文件是「截图断言」与「非截图断言」混编：只有前者随权威平台跳过，后者照跑。
// 这个混编是有意的 —— 同一次跑里，skipped 的截图条与 passed 的非截图条并存，
// 才能证明「不是整套被跳过」（正对照）。判据见 helpers/visual-authority.ts。
const visualGate = currentVisualGate();
printVisualGateNotice(visualGate);

test.describe('Authentication Pages', () => {
  test('login page renders correctly', async ({ page }) => {
    test.skip(!visualGate.run, visualGate.reason ?? '');
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

  test('auth page visual - mobile viewport', async ({ page }) => {
    test.skip(!visualGate.run, visualGate.reason ?? '');
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page).toHaveScreenshot('auth-mobile.png', {
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
    });
  });
});
