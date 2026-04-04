/**
 * Visual regression tests.
 *
 * Pure screenshot comparison tests for core pages across
 * different themes, viewports, and states.
 * Baseline images are stored in e2e/snapshots/ and committed to git.
 */

import { test, expect } from './helpers/test-fixtures';

test.describe('Visual Regression', () => {
  test.describe('Login Page', () => {
    test('default viewport', async ({ page }) => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      await expect(page).toHaveScreenshot('visual-login-default.png', {
        maxDiffPixelRatio: 0.01,
        animations: 'disabled',
        fullPage: true,
      });
    });

    test('light theme', async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'light' });
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      await expect(page).toHaveScreenshot('visual-login-light.png', {
        maxDiffPixelRatio: 0.01,
        animations: 'disabled',
      });
    });

    test('dark theme', async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      await expect(page).toHaveScreenshot('visual-login-dark.png', {
        maxDiffPixelRatio: 0.01,
        animations: 'disabled',
      });
    });

    test('mobile viewport (375x812)', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      await expect(page).toHaveScreenshot('visual-login-mobile.png', {
        maxDiffPixelRatio: 0.01,
        animations: 'disabled',
      });
    });

    test('tablet viewport (768x1024)', async ({ page }) => {
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      await expect(page).toHaveScreenshot('visual-login-tablet.png', {
        maxDiffPixelRatio: 0.01,
        animations: 'disabled',
      });
    });

    test('wide viewport (1920x1080)', async ({ page }) => {
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      await expect(page).toHaveScreenshot('visual-login-wide.png', {
        maxDiffPixelRatio: 0.01,
        animations: 'disabled',
      });
    });
  });
});
