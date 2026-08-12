import type { Page } from '@playwright/test';

/**
 * 截图前把页面推到一个「可重复」的视觉状态 —— 用于替代裸 `page.waitForTimeout(ms)`。
 *
 * 做三件事，缺一不可（2026-08-12 逐条实测得来，每一条都单独造成过一种"稳定但不可重复"）：
 *   ① **把指针移开**（消掉 `whileHover` 双稳态）
 *   ② **等到动画真的停了**（测量，不是赌时长）
 *   ③ **把 focus 触发的滚动复位**（消掉"停了、但停在两个不同位置"的双稳态）
 *
 * ②只保证"画面不再变"，**不保证"每次停在同一个画面"**——①③修的正是后者。
 * 这个区别是本文件存在的全部理由：一条只等①②的实现，实测三次重抓仍有 4.59% / 3.73% 的差异。
 *
 * ## ① 为什么不能用裸 sleep
 *
 * 认证页的入场/切换动画是 **framer-motion 驱动的（JS）**，不是 CSS 动画：
 *   - `src/constants/authAnimations.ts` `cardVariants`（卡片入场 0.7s，opacity/scale/y）
 *   - 同文件 `cardContentVariants` + `cardContentTransition`（登录↔注册切换 0.25s，x/opacity）
 *   - `src/pages/Register.tsx` `stepVariants` / `stepTransition`（步骤切换 0.3s，x/opacity）
 *     以及 `itemVariants` 的 stagger 入场、`whileFocus={{ scale: 1.01 }}`（首个输入框 autoFocus）
 *
 * Playwright 截图选项 `animations: 'disabled'` 只处理 **CSS** animation / transition
 * （把它们倒回一致状态）——它**冻不住 framer-motion**，后者是自己按帧写 inline style 的。
 * 并且 `src/styles/*auth*` 里根本没有 `@keyframes` / `animation:`，所以这条链上
 * 「让画面停下来」的责任 100% 不在 Playwright 手里。
 *
 * 于是 `waitForTimeout(1500)` 是在**赌** 1500ms 内动画跑完。它更坏的一面是**会假绿**：
 * 若基线本身就抓在动画中途，那么"同样抓在动画中途"的一次运行反而更容易匹配上。
 *
 * 判据：在页面内按帧轮询目标子树里每个元素的 `getBoundingClientRect()` + `opacity` +
 * `transform`，拼成签名字符串；连续 `stableFrames` 次签名**逐字节相同**才算稳定。
 * 位置、透明度、变换矩阵、元素增删（AnimatePresence 进出场会改节点数）任一变化都会清零重来。
 * 这样它对「动画由谁驱动」完全不敏感 —— 无论 framer-motion 走 WAAPI 还是自己的 rAF 循环，
 * 只要画面还在变，签名就会变。
 *
 * ⚠️ 采样作用域必须收窄到目标子树（默认 `.auth-card`），**不要**扩到整个 `body`：
 * 背景的 `.floating-orb` / `.flowing-bg` 是 `infinite` 的 **CSS** 动画
 * （`src/styles/base.css` 的 `orb-flow-1..5` / `flow-gradient`），永远不会停，
 * 纳入采样必然超时。它们由 Playwright 的 `animations: 'disabled'` 冻结，是确定性的。
 *
 * ## ① 为什么必须把指针移开（2026-08-12 实测）
 *
 * `locator.click()` 把鼠标移到目标中心后**就把它留在那里**。登录页的「注册」切换控件位于
 * 约 (683, 574)；切到注册表单后，那个坐标正好压在「下一步」提交按钮上（y≈568.5..622.5）。
 * 该按钮是 `MotionAppButton ... whileHover="hover"`，于是它可能进入 hover 态。
 *
 * 关键在于：光标**没有移动**，Chromium 是否会在动画布局落定后重新计算"光标下是谁"，
 * 是时序相关的 —— 6 次探针实测 3 次进 hover（`transform: matrix(1.02,0,0,1.02,0,-3)`、
 * 背景 alpha 0.65、辉光 40px）、3 次不进（`transform: none`、alpha 0.55、辉光 30px），
 * 又是掷硬币。差异实测 3.73% / 34388 px，集中在 x=471..808, y=521..622 这一个矩形里。
 *
 * 所以在等待之前先 `mouse.move()` 到视口角落：那里是 `.floating-orb`（`pointer-events: none`）
 * 与非交互背景，不会点亮任何 hover 样式；这一次**真实的 mousemove** 会强制 Chromium
 * 重算 hover，把按钮确定性地退出 hover 态。
 *
 * ## ③ 为什么还必须复位滚动（2026-08-12 实测）
 *
 * 只做 ① 还不够 —— 6 次探针实测拿到**两个都"稳定"但互不相同**的终态：3 次
 * `.login-container.scrollTop === 0`、3 次 `=== 211`，掷硬币一样。成因：
 * `src/pages/Register.tsx` 首个输入框带 `autoFocus`，浏览器会把获得焦点的元素滚进可视区；
 * 而 `.login-container` 虽然是 `overflow-y: hidden`，其 `scrollHeight`(~1150-1250) 仍远大于
 * `clientHeight`(755)（卡片自身就有 754.5px 高），**`overflow:hidden` 挡得住用户滚动，
 * 挡不住浏览器的 focus-scroll**。焦点落下的那一刻卡片入场动画是否已结束，决定了它算出来
 * 该不该滚 —— 于是同一份代码稳定地产出两种画面，差异实测 4.59% / 42299 px。
 *
 * 所以在①之后把所有非零的 `scrollTop/scrollLeft` 归零，再跑一次①确认没有回弹。
 * 归零态（= 卡片完整、图标与标题都在）正是用户加载页面看到的样子，也是正确的基线画面。
 */
export async function waitForVisualSettle(
  page: Page,
  selector = '.auth-card',
  opts: {
    /** 需要连续多少次采样完全一致才算稳定 */
    stableFrames?: number;
    /** 总等待上限；超时抛错而不是静默继续，避免退化成另一种「赌」 */
    timeoutMs?: number;
    /**
     * 是否把 focus-scroll 造成的滚动复位到 0。
     * 视觉回归页面默认开启；若某条用例本身就要截「滚动到某处」的状态，显式传 false。
     */
    normalizeScroll?: boolean;
    /**
     * 是否把鼠标移到视口角落以清除残留 hover。
     * 默认开启；若某条用例本身就要截 hover 态，显式传 false。
     */
    neutralizePointer?: boolean;
  } = {},
): Promise<void> {
  const {
    stableFrames = 8,
    timeoutMs = 10_000,
    normalizeScroll = true,
    neutralizePointer = true,
  } = opts;

  // 字体未就位会让文本先以 fallback 字形排版再回流 —— 与动画无关的另一条抖动来源，一并消掉。
  await page.waitForFunction(() => document.fonts.status === 'loaded', undefined, {
    timeout: timeoutMs,
  });

  await page.waitForSelector(selector, { state: 'visible', timeout: timeoutMs });

  // 必须在等待「稳定」之前做：退出 hover 本身也是一段 framer-motion 补间，
  // 要让它跟入场动画一起被下面的 settle() 等掉。
  if (neutralizePointer) {
    await page.mouse.move(0, 0);
  }

  const settle = async () => {
    await page.evaluate(
      async ({ sel, needStable, budgetMs }) => {
        // 推进一帧：rAF 为主（与真实绘制对齐）；万一 rAF 被节流则由 50ms 兜底，
        // 保证循环一定能向前走、由 budgetMs 收口，而不是永久挂起。
        const nextTick = () =>
          new Promise<void>((resolve) => {
            let done = false;
            const finish = () => {
              if (!done) {
                done = true;
                resolve();
              }
            };
            requestAnimationFrame(finish);
            setTimeout(finish, 50);
          });

        const snapshot = (): string | null => {
          const root = document.querySelector(sel);
          if (!root) {
            return null;
          }
          const nodes: Element[] = [root, ...Array.from(root.querySelectorAll('*'))];
          return nodes
            .map((node) => {
              const r = node.getBoundingClientRect();
              const cs = getComputedStyle(node);
              // 位置/尺寸取两位小数：亚像素级的动画帧要能被看见，浮点噪声不至于永不收敛。
              return [
                r.x.toFixed(2),
                r.y.toFixed(2),
                r.width.toFixed(2),
                r.height.toFixed(2),
                cs.opacity,
                cs.transform,
              ].join(',');
            })
            .join('|');
        };

        const start = performance.now();
        let previous: string | null = null;
        let stable = 0;

        while (performance.now() - start < budgetMs) {
          await nextTick();
          const current = snapshot();
          if (current !== null && current === previous) {
            stable += 1;
            if (stable >= needStable) {
              return;
            }
          } else {
            stable = 0;
          }
          previous = current;
        }

        throw new Error(
          `waitForVisualSettle: "${sel}" 在 ${budgetMs}ms 内未达到连续 ${needStable} 帧稳定` +
            `（最后一次连续稳定 ${stable} 帧）——画面仍在变化，此时截图必然不可重复。`,
        );
      },
      { sel: selector, needStable: stableFrames, budgetMs: timeoutMs },
    );
  };

  await settle();

  if (normalizeScroll) {
    const resetCount = await page.evaluate(() => {
      let n = 0;
      const all: Element[] = [
        ...(document.scrollingElement ? [document.scrollingElement] : []),
        ...Array.from(document.querySelectorAll('*')),
      ];
      for (const el of all) {
        const e = el as HTMLElement;
        if (e.scrollTop !== 0 || e.scrollLeft !== 0) {
          e.scrollTop = 0;
          e.scrollLeft = 0;
          n += 1;
        }
      }
      window.scrollTo(0, 0);
      return n;
    });
    // 复位本身会改变几何 —— 再等一次稳定，确认没有回弹（例如又被 focus 拉回去）。
    if (resetCount > 0) {
      await settle();
    }
  }
}
