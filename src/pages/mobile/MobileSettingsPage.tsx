/**
 * 移动端设置页面
 *
 * 封装 SettingsPanel，添加移动端适配：
 * - 状态栏安全区域
 * - 页面过渡动画
 * - 与其他移动端页面一致的毛玻璃效果
 *
 * 样式：
 * - 使用与抽屉一致的白色毛玻璃效果
 * - 颜色通过 CSS 变量统一管理，支持主题切换
 */

import { motion } from 'framer-motion';
import { SettingsPanel } from '../../components/settings';

// ============================================
// 类型定义
// ============================================

interface MobileSettingsPageProps {
  /** 关闭页面回调 */
  onClose: () => void;
}

// ============================================
// 主组件
// ============================================

export function MobileSettingsPage({ onClose }: MobileSettingsPageProps) {
  // 页面动画
  const pageVariants = {
    initial: { x: '100%', opacity: 0 },
    animate: { x: 0, opacity: 1, transition: { type: 'spring' as const, damping: 25, stiffness: 200 } },
    exit: { x: '100%', opacity: 0, transition: { duration: 0.2 } },
  };

  return (
    <motion.div
      className="mobile-settings-page"
      variants={pageVariants}
      initial="initial"
      animate="animate"
      exit="exit"
    >
      <SettingsPanel onClose={onClose} />
    </motion.div>
  );
}
