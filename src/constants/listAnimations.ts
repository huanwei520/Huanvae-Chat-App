/**
 * 列表组件通用动画配置
 *
 * 用于 UnifiedList 统一列表组件
 * 确保所有卡片有一致的入场/退场动画效果
 *
 * 动画效果：
 * - cardVariants: 卡片项的入场/退场动画（从左飞入，向右飞出）
 *
 * 注意：入场动画不使用延迟，避免与 layout 动画冲突导致从下方飞入的问题
 */

// 卡片动画变体：从左飞入，向右飞出
export const cardVariants = {
  initial: { opacity: 0, x: -30 },
  animate: {
    opacity: 1,
    x: 0,
    transition: {
      duration: 0.3,
      ease: [0.33, 1, 0.68, 1] as const, // 平滑的 ease-out
    },
  },
  exit: {
    opacity: 0,
    x: 30,
    transition: {
      duration: 0.25,
      ease: [0.33, 1, 0.68, 1] as const,
    },
  },
};

// 搜索框折叠阈值
export const SEARCH_COLLAPSE_WIDTH = 120;


