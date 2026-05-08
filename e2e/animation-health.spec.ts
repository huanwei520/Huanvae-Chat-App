/**
 * Animation health checks using Chrome DevTools Protocol (CDP).
 *
 * 这些测试使用 CDP 监听 Animation 事件 + Performance 指标，捕捉以下异常：
 *   - 页面静默期仍有动画在跑（疑似无限循环 / 未清理的 framer-motion 状态机）
 *   - 同一元素并发动画（CSS transition × framer-motion 转换冲突）
 *   - 加载/导航期间过度布局抖动（layout thrashing）
 *   - JS 堆使用异常
 *
 * 覆盖范围：
 * - 登录页（/）：默认 + 表单切换 + AccountSelector
 * - 多视口适配：mobile / tablet / wide / desktop
 * - 多主题：light / dark
 *
 * 登录后场景（FilesModal、MobileFilesPage、FilePreviewModal、聊天文档气泡）
 * 由于需要真实 Tauri runtime 的登录 API/数据库依赖，e2e 不直接覆盖；
 * 改用 vitest 组件测试验证动画属性（exit variants、AnimatePresence 嵌套、body overflow useEffect）。
 *
 * Chromium-only：CDP 仅支持 Chromium。运行：`pnpm test:animation`
 */

import { test, expect, type Page, type CDPSession } from '@playwright/test';
import { test as fixtureTest } from './helpers/test-fixtures';

// 用 fixtureTest（带 Tauri mock）的 page，但保留 base test 的 expect
const animTest = fixtureTest;

// ============================================
// 共享检测工具
// ============================================

/**
 * 在 quietPeriod 中收集动画事件，过滤掉装饰性短动画后断言阈值
 */
async function expectNoExcessiveAnimations(
  page: Page,
  client: CDPSession,
  options: {
    settleMs?: number;
    quietMs?: number;
    threshold?: number;
    label: string;
  },
) {
  const { settleMs = 3000, quietMs = 2000, threshold = 3, label } = options;
  await page.waitForTimeout(settleMs);

  const quietPeriodAnimations: any[] = [];
  const handler = (event: any) => quietPeriodAnimations.push(event.animation);
  client.on('Animation.animationStarted', handler);

  await page.waitForTimeout(quietMs);

  const unexpected = quietPeriodAnimations.filter((a) => {
    if (a.type === 'CSSAnimation') return false;
    if (a.source?.duration && a.source.duration < 100) return false;
    return true;
  });

  expect(
    unexpected.length,
    `[${label}] ${unexpected.length} unexpected animations in quiet period`,
  ).toBeLessThanOrEqual(threshold);
}

/**
 * 检测同一节点上并发动画 > 2 的情形（多动画转换冲突信号）
 */
async function expectNoConcurrentConflicts(
  page: Page,
  client: CDPSession,
  options: { settleMs?: number; label: string },
) {
  const { settleMs = 3000, label } = options;
  const animationsByNode = new Map<number, any[]>();

  client.on('Animation.animationStarted', (event: any) => {
    const nodeId = event.animation.source?.backendNodeId;
    if (nodeId) {
      if (!animationsByNode.has(nodeId)) animationsByNode.set(nodeId, []);
      animationsByNode.get(nodeId)!.push(event.animation);
    }
  });

  await page.waitForTimeout(settleMs);

  const conflicts: string[] = [];
  for (const [nodeId, anims] of animationsByNode) {
    const concurrent = anims.filter(
      (a) => a.source?.duration && a.source.duration > 0,
    );
    if (concurrent.length > 2) {
      conflicts.push(`Node ${nodeId}: ${concurrent.length} concurrent`);
    }
  }

  expect(
    conflicts,
    `[${label}] animation conflicts:\n${conflicts.join('\n')}`,
  ).toHaveLength(0);
}

async function expectReasonableLayouts(
  client: CDPSession,
  options: { threshold?: number; label: string },
) {
  const { threshold = 500, label } = options;
  const { metrics } = await client.send('Performance.getMetrics');
  const layoutCount = metrics.find((m: any) => m.name === 'LayoutCount');

  expect(
    layoutCount?.value ?? 0,
    `[${label}] excessive layouts: ${layoutCount?.value}`,
  ).toBeLessThan(threshold);
}

async function expectReasonableHeap(
  client: CDPSession,
  options: { thresholdMB?: number; label: string },
) {
  const { thresholdMB = 100, label } = options;
  const { metrics } = await client.send('Performance.getMetrics');
  const jsHeap = metrics.find((m: any) => m.name === 'JSHeapUsedSize');
  const heapMB = (jsHeap?.value ?? 0) / (1024 * 1024);

  expect(
    heapMB,
    `[${label}] heap: ${heapMB.toFixed(1)}MB`,
  ).toBeLessThan(thresholdMB);
}

// ============================================
// 场景 1：登录页（默认视口）
// ============================================

animTest.describe('Animation Health — Login Page', () => {
  animTest('no excessive animations after page load settles', async ({ page }) => {
    const client = await page.context().newCDPSession(page);
    await client.send('Animation.enable');
    await page.goto('/');
    await expectNoExcessiveAnimations(page, client, { label: 'login default' });
    await client.send('Animation.disable');
  });

  animTest('no animation conflicts on same element', async ({ page }) => {
    const client = await page.context().newCDPSession(page);
    await client.send('Animation.enable');
    await page.goto('/');
    await expectNoConcurrentConflicts(page, client, { label: 'login default' });
    await client.send('Animation.disable');
  });

  animTest('page load does not cause excessive layouts', async ({ page }) => {
    const client = await page.context().newCDPSession(page);
    await client.send('Performance.enable');
    await page.goto('/');
    await page.waitForTimeout(2000);
    await expectReasonableLayouts(client, { label: 'login default' });
    await client.send('Performance.disable');
  });

  animTest('JS heap usage is reasonable after page load', async ({ page }) => {
    const client = await page.context().newCDPSession(page);
    await client.send('Performance.enable');
    await page.goto('/');
    await page.waitForTimeout(3000);
    await expectReasonableHeap(client, { label: 'login default' });
    await client.send('Performance.disable');
  });
});

// ============================================
// 场景 2：登录 ↔ 注册表单切换（AnimatePresence mode="wait"）
// ============================================

animTest.describe('Animation Health — Auth Form Toggle', () => {
  animTest('toggling login/register does not produce concurrent animation conflicts', async ({ page }) => {
    const client = await page.context().newCDPSession(page);
    await client.send('Animation.enable');

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 触发表单切换（点击"立即注册"链接如果存在；否则跳过此交互）
    const registerLink = page.getByRole('button', { name: /注册|register/i });
    if (await registerLink.count() > 0) {
      await registerLink.first().click();
      await page.waitForTimeout(1000);
    }

    await expectNoConcurrentConflicts(page, client, {
      settleMs: 1500,
      label: 'auth form toggle',
    });
    await client.send('Animation.disable');
  });
});

// ============================================
// 场景 3：多视口适配（mobile / tablet / wide）
// ============================================

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'wide', width: 1920, height: 1080 },
];

for (const vp of VIEWPORTS) {
  animTest.describe(`Animation Health — Viewport ${vp.name} (${vp.width}x${vp.height})`, () => {
    animTest('no excessive animations after settle', async ({ page }) => {
      const client = await page.context().newCDPSession(page);
      await client.send('Animation.enable');

      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');

      await expectNoExcessiveAnimations(page, client, {
        label: `viewport ${vp.name}`,
      });
      await client.send('Animation.disable');
    });

    animTest('layouts under threshold after page load', async ({ page }) => {
      const client = await page.context().newCDPSession(page);
      await client.send('Performance.enable');

      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');
      await page.waitForTimeout(2000);

      await expectReasonableLayouts(client, { label: `viewport ${vp.name}` });
      await client.send('Performance.disable');
    });
  });
}

// ============================================
// 场景 4：暗色主题适配
// ============================================

animTest.describe('Animation Health — Dark Theme', () => {
  animTest('dark theme: no animation conflicts', async ({ page }) => {
    const client = await page.context().newCDPSession(page);
    await client.send('Animation.enable');

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');

    await expectNoConcurrentConflicts(page, client, { label: 'dark theme' });
    await client.send('Animation.disable');
  });

  animTest('dark theme: heap stays reasonable', async ({ page }) => {
    const client = await page.context().newCDPSession(page);
    await client.send('Performance.enable');

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await page.waitForTimeout(3000);

    await expectReasonableHeap(client, { label: 'dark theme' });
    await client.send('Performance.disable');
  });
});

// 备注：登录后场景（FilesModal/MobileFilesPage/FilePreviewModal/DocumentMessage）
// 因依赖真实 Tauri runtime 的 plugin-http login + plugin-sql 数据库初始化，e2e 不直接渲染。
// 这些组件的动画属性（AnimatePresence 嵌套、cardVariants exit、body overflow useEffect、
// motion.button disabled 守卫）由 vitest 组件测试覆盖：
//   - tests/components/FilesModal.test.tsx
//   - tests/components/MobileFilesPage.test.tsx
//   - tests/components/FilePreviewModal.test.tsx
