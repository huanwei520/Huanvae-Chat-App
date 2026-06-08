/**
 * 移动端安全区兜底（针对老旧 WebView 的 env(safe-area-inset-*) 失效）
 *
 * 背景：正常手机 WebView 支持 env(safe-area-inset-*)，加了 viewport-fit=cover 即生效。
 * 但**老旧工业平板**（如 T17X / Android 14 自带 Chromium < 140）的 WebView 即便有
 * viewport-fit=cover 也给 env(safe-area-inset-*) 返回 0 → 顶部贴状态栏、底部 TabBar 被
 * 三键导航栏遮住。Tauri 对此无官方解法（见 tauri-apps/tauri#14142 仍 open）。
 *
 * 方案：JS 探测真实 env 上下安全区，**当两者同时为 0 且在移动端**（= 该 WebView 不支持），
 * 才向 :root 注入固定高度 CSS 变量 `--sai-top` / `--sai-bottom`；否则不设（var 取 0px）。
 * 移动端各处 CSS 用 `max(env(safe-area-inset-*, 0px), var(--sai-*, 0px))`：
 *   - 手机/桌面（env 有效或无系统栏）→ var 未设=0 → max 退回 env，行为不变；
 *   - 老平板（env=0）→ max(0, 注入值) = 注入值，避开系统栏。
 */
import { isMobile } from './platform';

/** 注入的固定安全区高度（CSS px ≈ Android dp）。状态栏 24dp、三键导航栏 48dp 为 Android 标准值。 */
export const FALLBACK_INSET_TOP = 24;
export const FALLBACK_INSET_BOTTOM = 48;

/**
 * 纯决策：给定探测到的 env 上下安全区与是否移动端，返回需要注入的固定值；不需要注入返回 null。
 * 仅当「移动端 且 上下同时为 0」（WebView 不报安全区）才兜底——手机 env 生效时上/下非 0、桌面非移动端。
 */
export function resolveSafeAreaFallback(
  envTop: number,
  envBottom: number,
  mobile: boolean,
): { top: number; bottom: number } | null {
  if (mobile && envTop === 0 && envBottom === 0) {
    return { top: FALLBACK_INSET_TOP, bottom: FALLBACK_INSET_BOTTOM };
  }
  return null;
}

/** 探测 WebView 实际解析出的 env(safe-area-inset-top/bottom) 像素值（不支持时为 0）。 */
function probeEnvInsets(): { top: number; bottom: number } {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const top = parseFloat(cs.paddingTop) || 0;
  const bottom = parseFloat(cs.paddingBottom) || 0;
  probe.remove();
  return { top, bottom };
}

/**
 * 探测并按需注入安全区兜底变量到 :root。可重复调用（旋转 / resize 时重算）。
 * 不支持安全区的移动端 WebView → 设 `--sai-top/--sai-bottom`；其余 → 移除（让 CSS 退回 env）。
 */
export function applySafeAreaFallback(): void {
  const { top, bottom } = probeEnvInsets();
  const fallback = resolveSafeAreaFallback(top, bottom, isMobile());
  const root = document.documentElement;
  if (fallback) {
    root.style.setProperty('--sai-top', `${fallback.top}px`);
    root.style.setProperty('--sai-bottom', `${fallback.bottom}px`);
  } else {
    root.style.removeProperty('--sai-top');
    root.style.removeProperty('--sai-bottom');
  }
}

/** 启动时探测一次 + 监听 resize/旋转重算。返回取消监听的清理函数。 */
export function initSafeAreaFallback(): () => void {
  applySafeAreaFallback();
  const onResize = () => applySafeAreaFallback();
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);
  return () => {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
  };
}
