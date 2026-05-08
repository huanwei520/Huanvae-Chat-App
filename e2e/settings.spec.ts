/**
 * Settings page E2E tests + visual snapshots.
 *
 * 当前状态：保留 .skip。
 *
 * 设置面板需要登录态才能进入；登录态需要：
 *   1. plugin-http 的 login API 返回成功响应（当前 tauri-mock 返回 502）
 *   2. plugin-sql 初始化数据库 + 写入用户记录
 *   3. plugin-store 持久化 session（移动端路径）
 *
 * tauri-mock.ts 已经为 plugin-store / plugin-sql / plugin-http 提供了基础 stub（返回空数据 / 502），
 * 但 login 流程会在 502 处早返回 + 显示错误提示，不会进入主页面。
 *
 * 要解锁这部分 E2E，需要进一步：
 *   - 实现 plugin-http login 的成功响应 mock（含 access_token / refresh_token / expires_at 字段格式）
 *   - 实现 plugin-sql initDatabase 的成功路径
 *   - 实现 getProfile 的成功响应 mock
 *
 * 这部分工作量大且依赖后端协议稳定。在这之前，设置面板的渲染契约由 vitest 组件测试覆盖：
 *   - tests/components/SettingsPanel.test.tsx
 *
 * @see e2e/helpers/tauri-mock.ts
 */

import { test, expect } from './helpers/test-fixtures';

test.describe('Settings Page', () => {
  test.skip('settings panel renders correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('settings-panel.png', {
      animations: 'disabled',
    });
  });

  test.skip('theme toggle changes visual appearance', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('settings-dark-theme.png', {
      animations: 'disabled',
    });
  });
});
