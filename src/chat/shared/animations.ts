/**
 * 消息动画配置
 *
 * 提供消息气泡的入场/退出动画变体和过渡配置
 * 用于私聊和群聊消息组件
 *
 * ## 动画效果
 * - 类似 Telegram 的入场动画
 * - 自己的消息：从右往左、从下往上滑入
 * - 对方的消息：从左往右、从下往上滑入
 * - 退出时反方向播放
 *
 * ## 使用方式
 * ```typescript
 * import { getMessageVariants, messageTransition } from '../shared/animations';
 *
 * <motion.div
 *   variants={getMessageVariants(isOwn)}
 *   initial="initial"
 *   animate="animate"
 *   exit="exit"
 *   transition={messageTransition}
 * >
 *   ...
 * </motion.div>
 * ```
 *
 * @module chat/shared/animations
 * @created 2026-01-24
 */

/**
 * 生成消息动画变体
 *
 * @param isOwn 是否是自己发送的消息
 * @returns Framer Motion 动画变体对象
 */
export function getMessageVariants(isOwn: boolean) {
  const xOffset = isOwn ? 20 : -20; // 自己的消息从右边来，对方的从左边来
  const yOffset = 10; // 从下往上

  return {
    initial: {
      opacity: 0,
      x: xOffset,
      y: yOffset,
      scale: 0.98,
    },
    animate: {
      opacity: 1,
      x: 0,
      y: 0,
      scale: 1,
    },
    exit: {
      opacity: 0,
      x: xOffset, // 退出时往原方向滑出
      y: yOffset,
      scale: 0.98,
    },
  };
}

/**
 * 消息动画过渡配置
 *
 * 使用 as const 确保类型正确
 */
export const messageTransition = {
  // 入场/退出动画
  opacity: { duration: 0.2, ease: [0.0, 0.0, 0.2, 1] as const },
  x: { duration: 0.25, ease: [0.2, 0.8, 0.2, 1] as const },
  y: { duration: 0.25, ease: [0.2, 0.8, 0.2, 1] as const },
  scale: { duration: 0.2, ease: [0.2, 0.8, 0.2, 1] as const },
  // 布局动画（消息位置变化时）
  layout: { duration: 0.25, ease: [0.4, 0, 0.2, 1] as const },
};

/**
 * 会话消息区「整块淡入」过渡。
 *
 * 打开/切换会话时，整个消息列表容器作为一块内容 opacity 0→1 淡入，而非历史消息逐条滑入。
 * 与以下两者合起来构成「打开会话无插入抖动、只有柔和整体出现」的完整效果：
 * - column-reverse：首帧布局即稳定贴底（opacity=0 时排版与滚动定位已完成，淡入期间零布局变化）；
 * - shouldPlayEnter：历史消息 initial=false 不逐条入场，实时新到的消息仍按 getMessageVariants 滑入。
 *
 * 时长/缓动对齐 messageTransition.opacity（200ms，ease-out [0,0,0.2,1]），与逐条入场动画体系一致。
 */
export const panelFadeTransition = {
  duration: 0.2,
  ease: [0.0, 0.0, 0.2, 1] as const,
};

/**
 * 是否给该消息播放"入场滑入"动画。
 *
 * 仅"挂载后新增"且"自己发/WS 实时收到"的消息才演——即聊天中实时到达的新消息：
 * - `mountedKeys` 是消息列表首帧非空时的 key 快照；在快照内 = 打开/切换会话时已有的历史 → 不演；
 * - 不在快照内 = 挂载后新增（实时新消息）；
 * - 再要求带 `clientId`（自己发的保留 clientId、WS 收到的为 ws_<uuid>），借此排除 loadMore
 *   拉来的 DB 历史（`localMessageToMessage`/`localMessageToGroupMessage` 不带 clientId）。
 *
 * 于是：切换/打开 = 整体走面板渐变、无逐条并拢；聊天中新消息 = 自然滑入。
 *
 * @param clientId    消息的 clientId（自己发/WS 收到才有）
 * @param stableKey   该消息的稳定 key（= clientId || message_uuid）
 * @param mountedKeys 列表首帧非空时的 key 快照；尚未捕获时为 null（一律不演）
 */
export function shouldPlayEnter(
  clientId: string | undefined,
  stableKey: string,
  mountedKeys: Set<string> | null,
): boolean {
  return !!clientId && mountedKeys !== null && !mountedKeys.has(stableKey);
}
