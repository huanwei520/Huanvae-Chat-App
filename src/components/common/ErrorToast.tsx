/**
 * 错误提示组件
 */

import { motion } from 'framer-motion';

interface ErrorToastProps {
  message: string;
  onClose: () => void;
}

export function ErrorToast({ message, onClose }: ErrorToastProps) {
  return (
    <motion.div
      className="error-toast"
      initial={{ opacity: 0, y: 50 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 50 }}
      onClick={onClose}
    >
      <span className="error-icon">⚠</span>
      <span>{message}</span>
      <button onClick={onClose}>✕</button>
    </motion.div>
  );
}
