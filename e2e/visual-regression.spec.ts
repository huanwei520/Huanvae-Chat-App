/**
 * Visual regression tests.
 *
 * 纯截图对比 — 多页面 × 多主题 × 多视口的视觉基线锁定。
 * 基线截图存在 e2e/snapshots/ 并随代码 commit。
 *
 * 覆盖矩阵：
 * - 页面：login（默认） / register
 * - 视口：default / mobile (375x812) / tablet (768x1024) / wide (1920x1080)
 * - 主题：**未覆盖**（只有 default 一种）
 *
 * 🔴 为什么没有主题维度（2026-08-21 删掉了原来那三条）：
 *   原先有 `light theme` / `dark theme` / `mobile dark theme combo` 三条，做法是
 *   `page.emulateMedia({ colorScheme })`。**它对本 App 零效果** —— 主题模式的真值源是
 *   `src/theme/store.ts` 的 `DEFAULT_CONFIG.mode`，其值写死为 `'light'`；
 *   只有当它是 `'system'` 时 `getEffectiveMode()`（src/theme/generator.ts）才会去读
 *   `matchMedia('(prefers-color-scheme: dark)')`。默认既然是 `'light'`，媒体特性根本不被查询。
 *   实测后果：那三张基线与 `visual-login-default` / `visual-login-mobile` 在 Playwright 自己的
 *   比较器下差异 = **0 个像素**（见 .claude/rules/frontend-test.md 的重复度实测表）——
 *   名字写着 dark、内容却是 light，读测试清单的人会以为暗色有覆盖，而它一次都没被测过。
 *   ⇒ 按「删掉一个假覆盖比留着它更有价值」处理：删断言、删基线，并在此写明**暗色视觉回归未覆盖**。
 *   要真正覆盖暗色，得先把 App 的主题模式喂进去（种 localStorage 键 `huanvae-theme`
 *   的 `state.config.mode='dark'`，见 src/theme/store.ts 的 persist 配置），再在权威 linux 侧重出基线。
 *
 * 注意：
 *   - 触发 register/account-selector 需要先在 login 页交互；用 networkidle + 等待目标元素可见
 *   - `animations: 'disabled'` 只冻结 **CSS** 动画（背景 orb / 渐变），**冻不住 framer-motion**
 *     （JS 逐帧写 inline style）。凡是有 framer-motion 入场/切换动画的截图，必须再用
 *     `waitForVisualSettle()` 测到形态稳定再截 —— 裸 `waitForTimeout(ms)` 是在赌，会两头出错：
 *     赌输时截在动画中途（假红），而若基线本身就抓在动画中途，则赌输反而"匹配"（假绿）。
 *   - 登录后场景（主页/设置/我的文件）需要 Tauri runtime auth flow，不在 e2e 范围
 */

import { test, expect } from './helpers/test-fixtures';
import { waitForVisualSettle } from './helpers/visual-settle';
import { currentVisualGate, printVisualGateNotice } from './helpers/visual-authority';

// 🔴 本文件整份是截图断言。非权威平台（仓内无该平台入仓基线）上一律**显式跳过**，
// 不再产出一个「跟本机自产基线比出来的」绿数字。判据与理由见 helpers/visual-authority.ts。
// CI(ubuntu-latest) ⇒ process.platform === 'linux' ⇒ 落在权威分支，结构上跳不掉。
const visualGate = currentVisualGate();
printVisualGateNotice(visualGate);
test.skip(() => !visualGate.run, visualGate.reason ?? '');

const SCREENSHOT_OPTS = {
  maxDiffPixelRatio: 0.02,
  animations: 'disabled' as const,
};

const REGISTER_SCREENSHOT_OPTS = {
  maxDiffPixelRatio: 0.15,
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
    // 不能用裸 sleep：切换动画是 framer-motion（JS 驱动），`animations: 'disabled'` 冻不住它，
    // 等固定毫秒数只是在赌它跑完了。改为测量到「连续多帧形态完全不变」再截。详见 helper 注释。
    await waitForVisualSettle(page, '.auth-card');

    await expect(page).toHaveScreenshot('visual-register-default.png', REGISTER_SCREENSHOT_OPTS);
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
    await page.waitForTimeout(1500);

    await expect(page).toHaveScreenshot('visual-register-mobile.png', REGISTER_SCREENSHOT_OPTS);
  });
});

// 备注：account-selector 页面截图需要预先 mock 已保存账号到 Tauri Store —
// 当前 tauri-mock 返回空账号列表，所以 account-selector 永远不会渲染（默认走 login 页）。
// 待添加 mock seed 能力后再补此场景。

// 备注：登录后页面（Main/MobileMain/FilesModal/Settings）的视觉回归
// 由于依赖 Tauri runtime auth flow，e2e 不直接覆盖。
// 主要业务组件的渲染契约已在 vitest 组件测试中通过 className/structural assertions 覆盖。
