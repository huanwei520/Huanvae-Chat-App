/**
 * 移动端聊天页三段式 IME 布局护栏（仅 MobileChatView 挂载，桌面不消费）
 *
 * ## 背景：三段式契约
 * 聊天页 `.mobile-chat-view` 是「header 固定 / 消息区唯一可压缩段 / 输入栏贴键盘」的
 * flex 三段式。键盘弹起时视口变矮的唯一权威通道是壳层
 * MainActivity 的 ime() insets（WebView 整体变矮；API<30 由 manifest
 * adjustResize 经典窗口缩放兜底；Chromium 自身的 IME 缩放已被
 * viewport meta 的 interactive-widget=overlays-content 显式关闭）。
 * 视口变矮后 flex 自动压缩中间段：header 不动、输入栏贴在新视口底沿（= 键盘上沿）。
 *
 * ## 本护栏补两条结构保证（正常宿主上均为 no-op，异常宿主上兜底）
 * 1. 文档滚动钉扎：视口 resize / 平移一律不得以「文档整体上推」的形式表达
 *    —— document 滚动位置恒钉在 0，顶栏永远不会被推出屏
 *    （flex 压缩是唯一合法表达，见 chat-view.css 三段式注释）。
 * 2. 压缩贴底保持：消息区是 column-reverse（scrollTop=0 即视觉底部）。
 *    压缩发生时若用户原本贴底，布局落定后强制回到 0，保证「底部消息可见」
 *    不依赖各引擎对收缩瞬间 scrollTop 钳位的行为差异。
 *    用户主动离开底部（读历史）时不打扰，压缩后停在原阅读位置。
 */

import { useEffect, useRef, type RefObject } from 'react';

/** column-reverse 贴底判定：|scrollTop| ≤ 8px 视为在底部 */
const BOTTOM_EPS = 8;
/** resize 后的「引擎钳位滚动窗口」：窗口内的 scroll 事件视为收缩伪影，不更新贴底标记 */
const CLAMP_QUIET_MS = 160;

export function useImeThreeSegmentLayout(rootRef: RefObject<HTMLDivElement | null>) {
  /** 用户是否停在消息区底部（钳位伪滚动不更新） */
  const userAtBottomRef = useRef(true);
  /** 钳位静默窗口截止时刻（ms 时间基） */
  const clampQuietUntilRef = useRef(0);

  useEffect(() => {
    const vv = window.visualViewport;
    const root = rootRef.current;
    const readContainer = () =>
      root?.querySelector<HTMLElement>('.chat-messages-container') ?? null;

    // 消息区滚动跟踪（capture 委托在根上，容器按会话 key 重挂也不漏）
    const onScrollCapture = (e: Event) => {
      const c = readContainer();
      if (!c || e.target !== c) { return; }
      if (performance.now() < clampQuietUntilRef.current) { return; }
      userAtBottomRef.current = Math.abs(c.scrollTop) <= BOTTOM_EPS;
    };

    // Guard A：文档级滚动钉扎（滚动修正收敛：钉 0 后条件不再成立，无循环）
    const pinDocument = () => {
      const se = document.scrollingElement;
      if (se && se.scrollTop !== 0) { se.scrollTop = 0; }
      if (window.scrollY !== 0 || window.scrollX !== 0) { window.scrollTo(0, 0); }
    };

    // 视口尺寸变化 = IME 高度变化（唯一权威通道在壳层；此处只做结构保证）
    const onViewportResize = () => {
      clampQuietUntilRef.current = performance.now() + CLAMP_QUIET_MS;
      pinDocument();
      // 两帧后布局与引擎钳位均已落定，再恢复贴底
      requestAnimationFrame(() => requestAnimationFrame(() => {
        pinDocument();
        const c = readContainer();
        if (c && userAtBottomRef.current) { c.scrollTop = 0; }
      }));
    };

    vv?.addEventListener('resize', onViewportResize);
    vv?.addEventListener('scroll', pinDocument);
    window.addEventListener('scroll', pinDocument, { passive: true });
    root?.addEventListener('scroll', onScrollCapture, true);
    return () => {
      vv?.removeEventListener('resize', onViewportResize);
      vv?.removeEventListener('scroll', pinDocument);
      window.removeEventListener('scroll', pinDocument);
      root?.removeEventListener('scroll', onScrollCapture, true);
    };
  }, [rootRef]);
}
