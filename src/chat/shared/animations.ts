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
