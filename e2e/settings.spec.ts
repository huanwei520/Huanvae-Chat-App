/**
 * 设置面板 E2E —— 登录后场景。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 2026-08-19 重写：原来这里是**两条从创建起就没跑过的 `test.skip` 截图**，
 * 配一段解释"为什么进不了登录态"的长注释。那段注释的结论**是错的**：
 *
 *   原文：「登录态需要 plugin-http 的 login API 返回成功响应（当前 tauri-mock 返回 502）」
 *   实测：登录路径**根本不经过** `plugin:http` —— 数据面早已走 `invoke('secure_http')`
 *         （src/services/secureFetch.ts），而旧 mock 对 `secure_http` 没有任何分支、
 *         落到"未列出的命令 → null" ⇒ 从**发现面第一跳**就断了，与 502 无关。
 *
 * 那段错误注释不是无害的：它把"e2e 进不去登录态"的原因指错了方向，
 * 后来的审计照抄了它，于是没有人去看真正断掉的那一跳。
 * ⇒ 按 CLAUDE.md「零污染 / 无误导性残留」，错误注释 + 两条从未执行的占位一并删除，
 *   换成**真的会跑、真的有断言**的一条。
 *
 * mock 侧现在提供了最小假后端（见 e2e/helpers/tauri-mock.ts），登录态可达。
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { test, expect } from './helpers/test-fixtures';

test.describe('设置面板（登录后） @gate', () => {
  test('登录后能打开设置面板', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('#user-id').fill('e2euser');
    await page.locator('#password').fill('e2epass');
    await page.getByRole('button', { name: '登陆' }).click();

    // 先确认真的进了主界面（登录表单消失）
    await expect(page.locator('#user-id')).toHaveCount(0, { timeout: 30_000 });

    // 侧栏底部的设置按钮（Sidebar.tsx 的 title="设置"）
    const settingsBtn = page.getByTitle('设置');
    await expect(settingsBtn).toBeVisible({ timeout: 30_000 });
    await settingsBtn.click();

    // 断言面板真的渲染出来了（不是"点了但什么都没发生"）
    await expect(page.getByRole('heading', { name: '设置' })).toBeVisible({ timeout: 15_000 });
  });
});
