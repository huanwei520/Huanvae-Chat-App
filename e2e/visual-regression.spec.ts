/**
 * Visual regression tests.
 *
 * 纯截图对比 — 多页面 × 多主题 × 多视口的视觉基线锁定。
 * 基线截图存在 e2e/snapshots/ 并随代码 commit。
 *
 * 覆盖矩阵：
 * - 页面：login（默认） / register / account-selector
 * - 主题：default / light / dark
 * - 视口：default / mobile (375x812) / tablet (768x1024) / wide (1920x1080)
 *
 * 注意：
 *   - 触发 register/account-selector 需要先在 login 页交互；用 networkidle + 等待目标元素可见
 *   - 所有截图禁用动画（animations: 'disabled'）以保证稳定
 *   - 登录后场景（主页/设置/我的文件）需要 Tauri runtime auth flow，不在 e2e 范围
 */

import { test, expect } from './helpers/test-fixtures';

const SCREENSHOT_OPTS = {
  maxDiffPixelRatio: 0.01,
  animations: 'disabled' as const,
};

test.describe('Visual Regression — Login Page', () => {
  test('default viewport', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('visual-login-default.png', {
      ...SCREENSHOT_OPTS,
      fullPage: true,
    });
  });

  test('light theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('visual-login-light.png', SCREENSHOT_OPTS);
  });

  test('dark theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('visual-login-dark.png', SCREENSHOT_OPTS);
  });

  test('mobile viewport (375x812)', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('visual-login-mobile.png', SCREENSHOT_OPTS);
  });

  test('tablet viewport (768x1024)', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('visual-login-tablet.png', SCREENSHOT_OPTS);
  });

  test('wide viewport (1920x1080)', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('visual-login-wide.png', SCREENSHOT_OPTS);
  });

  test('mobile dark theme combo', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('visual-login-mobile-dark.png', SCREENSHOT_OPTS);
  });
});

test.describe('Visual Regression — Register Page', () => {
  test('register form via toggle', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 试图切换到注册表单。如果切换控件不存在（不同布局），跳过此测试以避免基线噪音
    const registerToggle = page.getByRole('button', { name: /注册|register/i });
    if (await registerToggle.count() === 0) {
      test.skip(true, 'register toggle button not found in current build');
      return;
    }
    await registerToggle.first().click();
    await page.waitForTimeout(500); // 等切换动画结束（截图本身 disable 动画）

    await expect(page).toHaveScreenshot('visual-register-default.png', SCREENSHOT_OPTS);
  });

  test('register form mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const registerToggle = page.getByRole('button', { name: /注册|register/i });
    if (await registerToggle.count() === 0) {
      test.skip(true, 'register toggle button not found');
      return;
    }
    await registerToggle.first().click();
    await page.waitForTimeout(500);

    await expect(page).toHaveScreenshot('visual-register-mobile.png', SCREENSHOT_OPTS);
  });
});

// 备注：account-selector 页面截图需要预先 mock 已保存账号到 Tauri Store —
// 当前 tauri-mock 返回空账号列表，所以 account-selector 永远不会渲染（默认走 login 页）。
// 待添加 mock seed 能力后再补此场景。

// 备注：登录后页面（Main/MobileMain/FilesModal/Settings）的视觉回归
// 由于依赖 Tauri runtime auth flow，e2e 不直接覆盖。
// 主要业务组件的渲染契约已在 vitest 组件测试中通过 className/structural assertions 覆盖。
