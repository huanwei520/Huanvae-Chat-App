/**
 * 列表组件通用动画配置
 *
 * 用于 UnifiedList 统一列表组件
 * 确保所有卡片有一致的入场/退场动画效果
 *
 * 动画效果：
 * - cardVariants: 卡片项的入场/退场动画（从左飞入，向右飞出）
 * - cardTransition: 卡片过渡配置（包含 layout 动画配置）
 *
 * 注意：
 * - 入场动画不使用延迟，避免与 layout 动画冲突导致从下方飞入的问题
 * - layout 动画使用高阻尼值（damping: 30）避免回弹
 */

// 卡片动画变体：从左飞入，向右飞出
export const cardVariants = {
  initial: { opacity: 0, x: -30 },
  animate: {
    opacity: 1,
    x: 0,
  },
  exit: {
    opacity: 0,
    x: 30,
  },
};

// 卡片过渡配置：分离 layout 和 x/opacity 的过渡配置
export const cardTransition = {
  // x 位移动画：使用 ease-out 曲线
  x: {
    duration: 0.25,
    ease: [0.33, 1, 0.68, 1] as const,
  },
  // 透明度动画
  opacity: {
    duration: 0.2,
  },
  // layout 动画：使用 tween 而非 spring，避免回弹
  layout: {
    type: 'tween' as const,
    duration: 0.25,
    ease: [0.33, 1, 0.68, 1] as const,
  },
};

// 搜索框折叠阈值
export const SEARCH_COLLAPSE_WIDTH = 120;
