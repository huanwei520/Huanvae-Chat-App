/**
 * 视觉回归门禁的「权威平台」判定。
 *
 * ## 它解决的问题：一侧恒绿、一侧恒红
 *
 * 本仓的截图基线**只有 linux 一套入仓**（`e2e/snapshots/**\/*-chromium-linux.png`），
 * 具体几张**不写死** —— 它随断言增删而变，写死一个数就是埋一颗必然过期的雷
 * （同一颗雷 2026-08-21 已经响过一次）；张数由 `e2e/visual-authority.spec.ts` 的守卫现算。
 * `.gitignore` 显式排除了 `*-chromium-darwin.png` 与 `*-chromium-win32.png`。
 * Playwright 的基线文件名带平台后缀，所以在非 linux 平台上：
 *
 *   1. 首跑找不到 `*-chromium-<本平台>.png` → 它**写一张**并把该条判 failed；
 *   2. 第二跑起，比对的对象是**这台机器自己刚写的那张** → **结构上不可能失败** → 恒绿。
 *
 * 「恒绿」不是「没有回归」，是**这条断言从此不携带任何信息**。而 CI(ubuntu-latest) 那一侧
 * 拿的是 2026-05-11 的旧基线、UI 早已前进 → 恒红。两侧都不再是「门」。
 *
 * ## 判据：以「基线文件存在于仓库」为准，不以「是不是 CI」为准
 *
 * 权威 = 该平台在仓库里**有入仓基线**。当前唯一有基线的平台是 linux（见上）。
 * 所以判据写成 `process.platform === 'linux'`，而不是 `process.env.CI`：
 *
 *   - CI 跑在 `runs-on: ubuntu-latest`（`.github/workflows/test.yml`）⇒ `process.platform === 'linux'`
 *     ⇒ 落在下面 `decideVisualGate` 的**第一个分支**、直接 `run: true`，**没有任何一条路径能把它跳过**
 *     （这是本模块最关键的安全属性，`e2e/visual-authority.spec.ts` 用真值表钉住它）；
 *   - 一台 linux 开发机在本地跑，比对的也正是 CI 用的那套基线 ⇒ 让它真跑是对的，不该跳过；
 *   - 反过来若用 `process.env.CI`，判据就与「基线到底存不存在」脱钩 —— 换个 runner OS 就静默失真。
 *
 * ## 逃生阀只能把结论推向「跑」，永远推不向「跳过」
 *
 * `E2E_VISUAL_FORCE=1` 供本机调试视觉问题时强制开启（此时比的是本机自产基线，**不具权威性**）。
 * 它只出现在「非权威平台」那一支里，**不可能**让权威平台被跳过 —— 新判据只许放行、不许当门。
 */

/** 唯一有入仓基线的平台。改它之前先改 `.gitignore` 与 `e2e/snapshots/` 里真实入仓的那套文件。 */
export const VISUAL_BASELINE_PLATFORM = 'linux';

/** 强制在非权威平台上跑视觉断言的环境变量名（只放行、不设卡）。 */
export const VISUAL_FORCE_ENV = 'E2E_VISUAL_FORCE';

export type VisualGateDecision =
  | { run: true; forced: boolean; reason: null }
  | { run: false; forced: false; reason: string };

/**
 * 纯函数形态的判定：把 `process.platform` / `process.env` 作为**入参**，
 * 好让真值表在任何一台机器上都能跑（否则「CI 不会被误跳过」就只剩嘴上保证）。
 */
export function decideVisualGate(
  platform: string,
  forceRaw: string | undefined,
): VisualGateDecision {
  // 🔴 权威平台优先返回，且这一支内没有任何 `run: false` 的出口 —— CI 结构上跳不掉。
  if (platform === VISUAL_BASELINE_PLATFORM) {
    return { run: true, forced: false, reason: null };
  }
  if (forceRaw === '1' || forceRaw === 'true') {
    return { run: true, forced: true, reason: null };
  }
  return {
    run: false,
    forced: false,
    reason:
      `视觉回归权威在 CI linux（仓内只入 *-chromium-${VISUAL_BASELINE_PLATFORM}.png 基线），` +
      `本地不断言：当前平台 ${platform} 无入仓基线，跑了也只是跟本机自产的那张比 —— 恒绿、零信息。` +
      `确要本地看视觉 diff：${VISUAL_FORCE_ENV}=1 强制开启（结果不具权威性）。`,
  };
}

/** 取当前进程的判定。 */
export function currentVisualGate(): VisualGateDecision {
  return decideVisualGate(process.platform, process.env[VISUAL_FORCE_ENV]);
}

let noticePrinted = false;

/**
 * 在 worker 进程里打一行原因（每进程只打一次）。
 * skip 的 annotation 已经带原因，但 annotation 只在 json/html 报告里；
 * 这一行让 `--reporter=list` 的终端输出也能直接看见「为什么没断言」。
 */
export function printVisualGateNotice(gate: VisualGateDecision = currentVisualGate()): void {
  if (noticePrinted) {
    return;
  }
  noticePrinted = true;
  // 用 console.warn 而不是 console.log：eslint 的 no-console 只放行 warn/error，
  // 而这两行本质就是「你这一跑的视觉结论不具权威性」的告警，语义也对得上。
  if (!gate.run) {
    console.warn(`[visual-gate] SKIP — ${gate.reason}`);
  } else if (gate.forced) {
    console.warn(
      `[visual-gate] FORCED — 非权威平台 ${process.platform} 上经 ${VISUAL_FORCE_ENV} 强制开启，结果不具权威性。`,
    );
  }
}
