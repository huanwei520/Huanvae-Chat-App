/**
 * NFC 操作反馈 toast
 *
 * - 单实例（同时只存在一个，新 toast 替换旧 toast）
 * - 双变体：success（绿）/ error（红）
 * - 3 秒自动消失 + 点击立即关闭
 * - motion.div + variants 控制进出场（不写 CSS transition: transform/opacity）
 *
 * toastKey 字段（外部 hook 自增）让连续相同内容也触发 motion 重 mount。
 */

import { useEffect } from 'react';
import { motion } from 'framer-motion';

interface NfcFeedbackToastProps {
  variant: 'success' | 'error';
  message: string;
  toastKey: number;
  onDismiss: () => void;
}

const AUTO_DISMISS_MS = 3000;

const toastVariants = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 30 },
};

export function NfcFeedbackToast({ variant, message, toastKey, onDismiss }: NfcFeedbackToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toastKey, onDismiss]);

  return (
    <motion.div
      key={toastKey}
      className={`nfc-feedback-toast nfc-feedback-toast--${variant}`}
      variants={toastVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: 0.2 }}
      onClick={onDismiss}
      role="status"
      aria-live="polite"
    >
      <span className="nfc-feedback-toast-icon">{variant === 'success' ? '✓' : '⚠'}</span>
      <span className="nfc-feedback-toast-message">{message}</span>
    </motion.div>
  );
}
