/**
 * Animation health checks using Chrome DevTools Protocol (CDP).
 *
 * 这些测试使用 CDP 监听 Animation 事件 + Performance 指标，捕捉以下异常：
 *   - 页面静默期仍有动画在跑（疑似无限循环 / 未清理的 framer-motion 状态机）
 *   - 同一节点的同一属性被多条动画同时驱动（CSS transition × framer-motion 抢帧，
 *     即 .claude/rules/animation.md 规则一「单一所有权」的运行时违例）
 *   - 加载/导航期间过度布局抖动（layout thrashing）
 *   - JS 堆使用异常
 *
 * ⚠️ 测量纪律：CDP 的 animationStarted **投递有延迟**（本仓实测 2~529ms），
 * 所以"事件何时到达 Node"绝不能当作"动画何时开始"。判定窗口一律用动画自身的
 * `startTime`（页面时钟）来算，handler 全程挂着、断言前先排空管道。
 * 详见下方 `recordAnimations` / `expectNoConcurrentConflicts` 的注释。
 *
 * 另有一组 GSAP 健康检测（见底部 "GSAP read-receipt animations"）：
 *   - 同元素多 tween：同一 DOM 节点是否被多个并发 tween 控制（单一所有权违例）
 *   - 残留 tween：动画 settle 后 globalTimeline 是否清空（无未结束 / 无限循环 tween）
 *   - CSS↔GSAP 抢属性：被 GSAP 动 transform/opacity 的元素其 computed transition 是否也含该属性
 * 这组检测把 gsap（项目内置 dist）注入页面 + 复刻 ReaderAvatarStack / GroupReadListModal
 * 的真实动画模式（stagger from + matchMedia reduced-motion）来验证，含正向对照防恒真。
 *
 * 覆盖范围：
 * - 登录页（/）：默认 + 表单切换 + AccountSelector
 * - 多视口适配：mobile / tablet / wide / desktop
 * - 多主题：light / dark
 * - GSAP 已读回执动画（ReaderAvatarStack / GroupReadListModal 模式）：合成 harness
 *
 * 登录后场景（FilesModal、MobileFilesPage、FilePreviewModal、聊天文档气泡、群已读回执组件）
 * 由于需要真实 Tauri runtime 的登录 API/数据库依赖，e2e 不直接渲染真实组件；
 * 改用 vitest 组件测试验证动画属性 + 上述 GSAP 合成 harness 验证动画运行时不变量。
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

// ============================================
// 动画事件记录器（测量层）
// ============================================
//
// 🔴 为什么需要它，而不是在断言前才 `client.on(...)`：
//
// CDP 的 `Animation.animationStarted` **不是实时投递**的 —— 它先在渲染进程排队、
// 再过 CDP 管道、最后进 Node 事件循环。本仓实测该投递延迟为 2~529ms（p50≈100ms）。
// 于是"在观察窗开始的那一刻才注册 handler"会同时犯两个方向的错：
//   ① 假阳：窗口**之前**就已开跑的动画，事件晚到落进窗口 → 被算成"窗口内新起的"
//   ② 假阴：窗口**之内**新起的动画，事件在收集停止后才到 → 被漏掉
// ①正是 2026-08-12「Auth Form Toggle」6/10 抖动的成因：表单滑入把按钮送到指针下
// 触发的那批 hover 过渡创建于 click+470~640ms，而窗口 click+1000ms 才开；
// 延迟 299~529ms 恰好把它们推过窗口边界 —— 推过去的轮次 FAIL，没推过去的 PASS。
//
// 修法是把"何时收到事件"与"动画何时开始"彻底解耦：
//   - handler 在 `Animation.enable` 之后**立刻**注册，全程收集，不漏任何事件；
//   - 是否落在观察窗内，一律用动画**自身的** `startTime`（页面时钟）判定；
//   - 窗口关闭后额外 drain 一段时间，让窗口内动画的迟到事件全部落地再断言。
//
// `Animation.startTime` 与页面 `performance.now()` 同源（都以 time origin 起算，
// document timeline 即此时钟）—— 本仓已实测对齐：同一条过渡 CDP 报 startTime=2184，
// 页面内 `document.getAnimations()` 采样到的 `a.startTime` 同为 2184。

/** CDP 事件投递的排空时间。取值依据：实测最大延迟 529ms，留 ~2x 余量。 */
const CDP_DELIVERY_DRAIN_MS = 1200;

interface AnimationRecord {
  id: string;
  type: string;
  /** CSSTransition 的过渡属性名（CDP 放在 animation.name）；其余类型 CDP 不提供属性 → '' */
  property: string;
  /** 页面时钟（与 performance.now() 同源）上的活跃区间 */
  activeFrom: number;
  activeTo: number;
  backendNodeId: number;
}

/**
 * 在 `Animation.enable` 之后立刻调用，返回一个持续填充的记录数组。
 */
function recordAnimations(client: CDPSession): AnimationRecord[] {
  const records: AnimationRecord[] = [];
  client.on('Animation.animationStarted', (event: any) => {
    const animation = event.animation;
    const source = animation?.source;
    if (!source || !(source.duration > 0)) return;
    const activeFrom = animation.startTime + (source.delay ?? 0);
    records.push({
      id: String(animation.id),
      type: String(animation.type),
      property: animation.type === 'CSSTransition' ? String(animation.name ?? '') : '',
      activeFrom,
      activeTo: activeFrom + source.duration,
      backendNodeId: source.backendNodeId ?? 0,
    });
  });
  return records;
}

/** 失败时把 backendNodeId 解成可读的元素描述；解不出就退回裸 id（绝不让它影响判定） */
async function describeNode(client: CDPSession, backendNodeId: number): Promise<string> {
  try {
    const { node } = (await client.send('DOM.describeNode', { backendNodeId })) as any;
    const attrs: string[] = node?.attributes ?? [];
    let selector = String(node?.nodeName ?? '?').toLowerCase();
    for (let i = 0; i < attrs.length; i += 2) {
      if (attrs[i] === 'id') selector += `#${attrs[i + 1]}`;
      if (attrs[i] === 'class') selector += `.${String(attrs[i + 1]).trim().split(/\s+/).join('.')}`;
    }
    return `${selector} (node ${backendNodeId})`;
  } catch {
    return `node ${backendNodeId}`;
  }
}

/**
 * 单一所有权检测：观察窗内，同一节点的**同一个属性**不得同时被一条以上的动画驱动。
 *
 * 判据 = .claude/rules/animation.md 规则一（每个属性只能有一个动画主人）的直接翻译：
 * 取每条动画在页面时钟上的活跃区间 [startTime+delay, +duration]，按 (节点, 属性) 分组，
 * 组内任意两条区间相交、且相交部分落在观察窗内 → 冲突。
 *
 * 🔴 这**不是**放宽原来的「同节点动画数 > 2」，而是把那条粗糙代理换成它本来想代理的东西：
 *   - 原判据把"一次 :focus 展开的 4 条 border-*-color 长手写"、"一次 hover 起的 6 条
 *     **不同属性**过渡"当冲突 —— 它们各有各的主人，本就不冲突（假阳）；
 *   - 原判据又漏掉真冲突：同一属性被反复重启（JS 每帧写 inline style，CSS 对每次写入
 *     各起一条过渡）时，若只有 2 条落在窗口内就判 PASS（假阴）。
 *   两者在正对照上的灵敏度差距是实测的：把认证页那颗按钮改回"CSS+JS 双主人"后，
 *   本判据 5/5 轮报 FAIL（均为 `transform` 自相重叠），原判据只有 2/5。
 *
 * ⚠️ 已知边界：CDP 只对 CSSTransition 给出属性名（animation.name）。WebAnimation /
 * CSSAnimation 的 keyframesRule 里**没有**属性字段，故它们各自成组、永不互判冲突。
 * 本检测覆盖的正是"CSS transition × JS 逐帧写 inline style 抢同一属性"这一类
 * —— framer-motion 的 spring 写入正是以 CSSTransition 的形式暴露出来的。
 */
async function expectNoConcurrentConflicts(
  page: Page,
  client: CDPSession,
  records: AnimationRecord[],
  options: { settleMs?: number; label: string },
) {
  const { settleMs = 3000, label } = options;

  const windowStart = await page.evaluate(() => performance.now());
  await page.waitForTimeout(settleMs);
  const windowEnd = await page.evaluate(() => performance.now());
  // 排空迟到事件：窗口内新起的动画，其 CDP 事件可能此刻还在管道里
  await page.waitForTimeout(CDP_DELIVERY_DRAIN_MS);

  const byOwner = new Map<string, AnimationRecord[]>();
  for (const record of records) {
    // 属性未知的类型按自身身份分桶，不与任何人比较（见上方"已知边界"）
    const owner = `${record.backendNodeId}|${record.property || `${record.type}:${record.id}`}`;
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner)!.push(record);
  }

  const conflicts: { nodeId: number; property: string; from: number; to: number; count: number }[] = [];
  for (const group of byOwner.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.activeFrom - b.activeFrom);
    let maxEnd = -Infinity;
    for (const record of sorted) {
      if (record.activeFrom < maxEnd) {
        const from = record.activeFrom;
        const to = Math.min(maxEnd, record.activeTo);
        // 相交区间必须与观察窗有交集，才算"在本次观察期间发生的冲突"
        if (to > from && to >= windowStart && from <= windowEnd) {
          conflicts.push({
            nodeId: record.backendNodeId,
            property: record.property,
            from: Math.round(from - windowStart),
            to: Math.round(to - windowStart),
            count: sorted.length,
          });
          break;
        }
      }
      maxEnd = Math.max(maxEnd, record.activeTo);
    }
  }

  const detail = await Promise.all(
    conflicts.map(async (c) =>
      `  ${await describeNode(client, c.nodeId)}: "${c.property}" ` +
      `被 ${c.count} 条动画驱动，区间重叠 ${c.from}~${c.to}ms（相对观察窗起点）`,
    ),
  );

  expect(
    detail,
    `[${label}] 同一属性被多条动画同时驱动（单一所有权违例）:\n${detail.join('\n')}`,
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
    const records = recordAnimations(client);
    await page.goto('/');
    await expectNoConcurrentConflicts(page, client, records, { label: 'login default' });
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
    const records = recordAnimations(client);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // 触发表单切换（点击"立即注册"链接如果存在；否则跳过此交互）
    const registerLink = page.getByRole('button', { name: /注册|register/i });
    if (await registerLink.count() > 0) {
      await registerLink.first().click();
      await page.waitForTimeout(1000);
    }

    await expectNoConcurrentConflicts(page, client, records, {
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
    const records = recordAnimations(client);

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');

    await expectNoConcurrentConflicts(page, client, records, { label: 'dark theme' });
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

// ============================================
// 场景 5：GSAP 已读回执动画（ReaderAvatarStack / GroupReadListModal 模式）
// ============================================
//
// 真实组件（src/chat/shared/ReaderAvatarStack.tsx、src/chat/group/GroupReadListModal.tsx）
// 是登录后群聊内组件，受 plugin-http login 限制 e2e 不可直接渲染。
// 这里注入项目内置的 gsap dist + 复刻其 GSAP 动画模式（stagger from / matchMedia reduced-motion），
// 在真实浏览器里验证三条运行时不变量。每个检测都带"正向对照"，确保断言非恒真。

/** 项目内置 gsap UMD（addScriptTag 的 path 相对 cwd=项目根解析） */
const GSAP_DIST = 'node_modules/gsap/dist/gsap.min.js';

/**
 * 注入 gsap 并搭建复刻两个真实组件动画模式的 DOM/CSS harness。
 * - .read-row   镜像 .group-read-list-row（项目 CSS 中无 transform/opacity 的 transition）
 * - .avatar-item 镜像 .reader-avatar-stack-item（同上，无冲突 transition）
 * - .conflict-row 正向对照：故意给 transform/opacity 加 transition，用于验证"抢属性"检测可报真冲突
 */
async function setupGsapHarness(page: Page) {
  await page.goto('/');
  await page.addScriptTag({ path: GSAP_DIST });
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = [
      '.gsap-harness { position: fixed; top: 0; left: 0; pointer-events: none; }',
      '.read-row { height: 40px; width: 200px; }',
      '.avatar-item { width: 16px; height: 16px; }',
      '.conflict-row { height: 40px; width: 200px; transition: transform 0.2s ease, opacity 0.2s ease; }',
    ].join('\n');
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.className = 'gsap-harness';
    const rows = Array.from({ length: 6 }, (_, i) => `<div class="read-row" data-i="${i}"></div>`).join('');
    const avatars = Array.from({ length: 5 }, (_, i) => `<div class="avatar-item" data-i="${i}"></div>`).join('');
    root.innerHTML = `${rows}${avatars}<div class="conflict-row"></div>`;
    document.body.appendChild(root);
  });
}

animTest.describe('Animation Health — GSAP read-receipt animations', () => {
  animTest('single ownership: no element controlled by >1 concurrent tween', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await setupGsapHarness(page);

    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gsap = (window as any).gsap;
      // 复刻 GroupReadListModal 列表项错峰滑入
      gsap.from('.read-row', { opacity: 0, y: 8, duration: 0.3, ease: 'power2.out', stagger: 0.04, overwrite: 'auto' });
      // 复刻 ReaderAvatarStack 头像 stagger 淡入+微缩放
      gsap.from('.avatar-item', { opacity: 0, scale: 0.8, duration: 0.3, ease: 'power2.out', stagger: 0.05, overwrite: 'auto' });

      // 组件模式：每个元素被 ≤1 个 tween 控制（stagger 是单个 tween 控多 target）
      const els = Array.from(document.querySelectorAll('.read-row, .avatar-item')) as HTMLElement[];
      const maxPerElement = Math.max(...els.map((el) => gsap.getTweensOf(el).length));

      // 正向对照：故意叠两个未 overwrite 的 tween 在同一元素 → 检测器须能报 >1
      const probe = document.createElement('div');
      probe.className = 'avatar-item';
      document.body.appendChild(probe);
      gsap.to(probe, { x: 100, duration: 1 });
      gsap.to(probe, { x: 200, duration: 1 });
      const probeCount = gsap.getTweensOf(probe).length;

      return { maxPerElement, probeCount };
    });

    expect(result.maxPerElement, 'component pattern: each element controlled by <=1 tween').toBeLessThanOrEqual(1);
    expect(result.probeCount, 'detector sanity: double-bound element reports >1 tween').toBeGreaterThan(1);
  });

  animTest('no residual tweens on globalTimeline after animation settles', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await setupGsapHarness(page);

    await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gsap = (window as any).gsap;
      gsap.from('.read-row', { opacity: 0, y: 8, duration: 0.3, ease: 'power2.out', stagger: 0.04, overwrite: 'auto' });
      gsap.from('.avatar-item', { opacity: 0, scale: 0.8, duration: 0.3, ease: 'power2.out', stagger: 0.05, overwrite: 'auto' });
    });

    // 正向对照:刚启动时 globalTimeline 上应检出 active tween——证明该度量是活的、
    // 非恒返 0(否则 settle 后的 ===0 断言会假绿)。
    const beforeSettle = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gsap = (window as any).gsap;
      return gsap.globalTimeline.getChildren(true, true, false).length;
    });
    expect(beforeSettle, 'positive control: active tweens detectable right after start').toBeGreaterThan(0);

    // settle：最长 = 0.3 + 5*0.05 = 0.55s，留足余量
    await page.waitForTimeout(1500);

    const activeChildren = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gsap = (window as any).gsap;
      // globalTimeline 上的子动画；settle 后应清空（gsap 自动移除已完成 tween）
      return gsap.globalTimeline.getChildren(true, true, false).length;
    });

    expect(activeChildren, 'no residual tweens after settle (no infinite/uncleaned tween)').toBe(0);
  });

  animTest('reduced-motion branch uses instant gsap.set (no lingering tween)', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setupGsapHarness(page);

    const out = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gsap = (window as any).gsap;
      const mm = gsap.matchMedia();
      let branch = 'none';
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        branch = 'animate';
        gsap.from('.read-row', { opacity: 0, y: 8, duration: 0.3, stagger: 0.04 });
      });
      mm.add('(prefers-reduced-motion: reduce)', () => {
        branch = 'reduce';
        gsap.set('.read-row', { opacity: 1, y: 0 });
      });
      return { branch, active: gsap.globalTimeline.getChildren(true, true, false).length };
    });

    expect(out.branch, 'reduced-motion: reduce branch selected').toBe('reduce');
    expect(out.active, 'reduce branch creates no time-based tween (gsap.set is instantaneous)').toBe(0);
  });

  animTest('no CSS transition contends with GSAP-animated transform/opacity', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await setupGsapHarness(page);

    const result = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const gsap = (window as any).gsap;
      gsap.from('.read-row', { opacity: 0, y: 8, duration: 0.3, stagger: 0.04 });
      gsap.from('.avatar-item', { opacity: 0, scale: 0.8, duration: 0.3, stagger: 0.05 });
      gsap.from('.conflict-row', { opacity: 0, y: 20, duration: 0.3 }); // 正向对照

      const CONTROLLED = ['transform', 'opacity'];
      // 真冲突 = 元素有 duration>0 的 transition 且其 property 含被 GSAP 动的属性（或 all）
      // 注意：transition-property 默认计算值是 "all"，必须配合 transition-duration>0 才算真过渡
      const hasContention = (sel: string) => {
        const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
        return els.some((el) => {
          const cs = getComputedStyle(el);
          const durations = cs.transitionDuration.split(',').map((s) => parseFloat(s) || 0);
          if (!durations.some((d) => d > 0)) {
            return false;
          }
          const props = cs.transitionProperty;
          return CONTROLLED.some((p) => new RegExp(`\\b${p}\\b|\\ball\\b`).test(props));
        });
      };

      return {
        readRow: hasContention('.read-row'),
        avatarItem: hasContention('.avatar-item'),
        conflictRow: hasContention('.conflict-row'),
      };
    });

    // 组件镜像类：无 CSS transition 抢 transform/opacity
    expect(result.readRow, '.read-row (mirrors .group-read-list-row) must not transition transform/opacity').toBe(false);
    expect(result.avatarItem, '.avatar-item (mirrors .reader-avatar-stack-item) must not transition transform/opacity').toBe(false);
    // 检测器非恒真：能识别真实冲突
    expect(result.conflictRow, 'detector sanity: element with conflicting CSS transition is flagged').toBe(true);
  });
});

// 备注：登录后场景（FilesModal/MobileFilesPage/FilePreviewModal/DocumentMessage）
// 因依赖真实 Tauri runtime 的 plugin-http login + plugin-sql 数据库初始化，e2e 不直接渲染。
// 这些组件的动画属性（AnimatePresence 嵌套、cardVariants exit、body overflow useEffect、
// motion.button disabled 守卫）由 vitest 组件测试覆盖：
//   - tests/components/FilesModal.test.tsx
//   - tests/components/MobileFilesPage.test.tsx
//   - tests/components/FilePreviewModal.test.tsx
