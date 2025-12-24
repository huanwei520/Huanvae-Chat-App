/**
 * 认证页面动画配置
 *
 * 用于 App.tsx 中登录/注册页面的动画
 */

// 卡片内容切换动画（登录和注册之间）
export const cardContentVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 80 : -80,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -80 : 80,
    opacity: 0,
  }),
};

export const cardContentTransition = {
  type: 'tween',
  ease: 'easeInOut',
  duration: 0.25,
} as const;

// 卡片动画
export const cardVariants = {
  hidden: { opacity: 0, scale: 0.95, y: 30 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: {
      duration: 0.7,
      ease: [0.4, 0, 0.2, 1] as const,
    },
  },
};
