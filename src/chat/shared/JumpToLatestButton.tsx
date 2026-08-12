/**
 * 「回到最新」浮动按钮 —— 离开底部时浮出，点击回到最新一条消息。
 *
 * @module chat/shared
 * @location src/chat/shared/JumpToLatestButton.tsx
 *
 * 桌面（ChatPanel）与移动（MobileChatView）复用同一套 ChatMessages / GroupChatMessages，
 * 按钮挂在这两个列表组件里，故两端天然一致，不需要两处接线。
 *
 * **坐标约定（column-reverse）**：消息列表容器是 `flex-direction: column-reverse`，
 * 滚动原点在**底部** —— `scrollTop === 0` 就是最新一条（视觉底部），往更旧翻是负值
 * （取值区间 `[-(scrollHeight - clientHeight), 0]`）。所以：
 * - 「离底距离」= `Math.abs(scrollTop)`（用 Math.abs 写成符号无关，兼容不同引擎的符号约定，
 *   与 ChatMessages.handleScroll 的加载更多判据同款）
 * - 「回到底部」= 把 scrollTop 滚回 **0**，不是滚到 scrollHeight
 *
 * **为什么用 container.scrollTo 而不是 el.scrollIntoView**：scrollIntoView 会沿祖先链冒泡，
 * 让每个可滚祖先都把目标往自己可视区里对齐 —— 真机表现是整个 App 外壳被顶上去
 * （见 .claude/rules/common.md「element.scrollIntoView() 会沿祖先链冒泡」）。
 * `scrollTo` 作用在**指定容器**上、不冒泡，且由浏览器接管滚动，天然可被用户滚动打断。
 * 手法与 scrollMessageIntoView.ts 完全一致，两条通路同源。
 *
 * **动画单一所有权**（.claude/rules/animation.md 规则一）：opacity / transform 由 framer-motion
 * 逐帧接管，JumpToLatestButton.css 对 `.jump-to-latest-btn` 只准过渡 background / box-shadow /
 * border-color，且点按反馈走 `whileTap` 而不是 CSS `:active { transform }`。
 * 该约束由 tests/animation-conflict.test.ts 的注册表静态守卫。
 */

import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { scrollToLatestAfterTwoFrames } from './useStickToBottom';
import './JumpToLatestButton.css';

/**
 * 离底超过这么多像素才浮出按钮。
 * 贴底附近（正常聊天时）不打扰；翻了一段历史才给回程入口。
 */
export const JUMP_TO_LATEST_THRESHOLD_PX = 160;

/** 系统「减弱动效」开启时不做平滑滚动，直接瞬时到位（同 scrollMessageIntoView 的口径） */
function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * 把消息列表容器滚回最新一条（column-reverse 下即 scrollTop = 0）。
 *
 * 只滚传入的容器自己，绝不冒泡到祖先。
 */
export function scrollToLatest(container: HTMLElement): void {
  if (prefersReducedMotion()) {
    container.scrollTop = 0;
    return;
  }
  container.scrollTo({ top: 0, behavior: 'smooth' });
}

interface JumpToLatestButtonProps {
  /** 消息列表滚动容器（`.chat-messages-container--reverse`） */
  containerRef: RefObject<HTMLDivElement | null>;
  /**
   * 「回到最新」的接管回调：用于「当前停在很早的历史区域、最新消息根本不在已加载窗口里」
   * 的场景 —— 那时纯滚动只能滚到已加载窗口的底部，需要上层先重新加载最新一段。
   *
   * 🔴 **重载之后仍必须滚**。真机实测过一次反例：只调回调不滚，结果是"数据换成了最新 50 条，
   * 但容器还停在原来的滚动位置" —— 用户点了按钮，画面从 #241 跳到 #351，最新是 #400，
   * 按钮还挂在那儿。所以本组件的顺序是 **await 回调 → 再滚容器**；
   * 返回 Promise 时会等它 resolve，避免在列表重渲染之前就滚（滚了也白滚）。
   *
   * 不传则直接滚（已加载窗口的最新一条就是真正的最新）。
   */
  onJumpToLatest?: () => void | Promise<void>;
  /**
   * 恒显（无视滚动位置）。
   *
   * 用于**定位窗口态**：此时列表是「围绕某条历史消息的一段窗口」，**最新消息根本不在里面**，
   * 于是「滚到容器底部」只是滚到了窗口的底 —— 位置判据会认为"已经贴底"而把按钮藏起来，
   * 用户反而失去唯一的回程入口。窗口态下必须一直给着这个出口。
   */
  forceVisible?: boolean;
}

export function JumpToLatestButton({
  containerRef,
  onJumpToLatest,
  forceVisible = false,
}: JumpToLatestButtonProps) {
  const [scrolledUp, setScrolledUp] = useState(false);

  // 可见性默认由容器的实际滚动位置决定：贴底（|scrollTop| <= 阈值）隐藏，翻上去才浮出。
  // 新消息到达不改变 scrollTop（column-reverse 原生底锚），故无需额外依赖消息条数。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) { return; }

    const sync = () => {
      setScrolledUp(Math.abs(container.scrollTop) > JUMP_TO_LATEST_THRESHOLD_PX);
    };
    sync();

    container.addEventListener('scroll', sync, { passive: true });
    return () => container.removeEventListener('scroll', sync);
  }, [containerRef]);

  const visible = forceVisible || scrolledUp;

  const handleClick = useCallback(async () => {
    const hasReload = Boolean(onJumpToLatest);
    // 先让上层把最新一段装回来（窗口态下要重新查 DB，是异步的）
    await onJumpToLatest?.();

    const container = containerRef.current;
    if (!container) { return; }

    if (!hasReload) {
      // 没有重载：列表没变，平滑滚过去即可
      scrollToLatest(container);
      return;
    }

    // 🔴 有重载时必须再等两帧才滚。真机实测踩过两次：
    //   1. await 只等到上层 setState **被调用**，React 尚未提交渲染 ——
    //      此刻滚的是**旧 DOM**，等新列表渲染出来位置又不对了。
    //   2. 即便滚对了，`behavior: 'smooth'` 的动画会被紧随其后的内容替换**打断**，
    //      停在半路（实测：数据已是最新 50 条，画面却停在第 375 条附近）。
    // 双 rAF 保证「提交 + 绘制」都已完成；且**这一路用瞬时滚**——
    // 旧内容已经整段换掉了，没有什么可供"平滑滚过"，动画只会制造上面第 2 种失败。
    // 实现与「新消息到达时贴底」共用同一份（useStickToBottom.scrollToLatestAfterTwoFrames）——
    // 这套写法是真机验证过的，全仓只留一份，不要在别处另写。
    scrollToLatestAfterTwoFrames(containerRef);
  }, [containerRef, onJumpToLatest]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          className="jump-to-latest-btn"
          aria-label="回到最新消息"
          title="回到最新消息"
          onClick={handleClick}
          initial={{ opacity: 0, y: 8, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.9 }}
          whileTap={{ scale: 0.92 }}
          transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            width={18}
            height={18}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M19 12l-7 7-7-7" />
          </svg>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
