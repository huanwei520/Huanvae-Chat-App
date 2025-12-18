/**
 * 加载动画组件
 */

import { motion } from 'framer-motion';

export const LoadingSpinner = () => (
  <motion.span
    animate={{ rotate: 360 }}
    transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
    style={{ display: 'inline-block' }}
  >
        ⟳
  </motion.span>
);
