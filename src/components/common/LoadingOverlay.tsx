/**
 * 全屏加载遮罩组件
 */

import { motion } from 'framer-motion';

export function LoadingOverlay() {
  return (
    <motion.div
      className="loading-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
        className="spinner-icon large"
      >
        ⟳
      </motion.div>
    </motion.div>
  );
}

