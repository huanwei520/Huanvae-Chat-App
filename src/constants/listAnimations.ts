/**
 * 列表组件通用动画配置
 *
 * 用于 ConversationList, FriendList, GroupList 等列表组件
 * 确保所有列表有一致的动画效果
 */

// 卡片动画变体：从左飞入，向右飞出（平滑版）
export const cardVariants = {
  initial: { opacity: 0, x: -40, scale: 0.98 },
  animate: (index: number) => ({
    opacity: 1,
    x: 0,
    scale: 1,
    transition: {
      duration: 0.4,
      delay: index * 0.03,
      ease: [0.33, 1, 0.68, 1] as const, // 平滑的 ease-out
    },
  }),
  exit: (index: number) => ({
    opacity: 0,
    x: 40,
    scale: 0.98,
    transition: {
      duration: 0.3,
      delay: index * 0.02,
      ease: [0.33, 1, 0.68, 1] as const,
    },
  }),
};

// 面板动画变体
export const panelVariants = {
  initial: { opacity: 1 },
  animate: { opacity: 1 },
  exit: { opacity: 1 },
};

// 搜索框折叠阈值
export const SEARCH_COLLAPSE_WIDTH = 120;
