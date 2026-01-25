/**
 * 发送状态指示器组件
 *
 * 显示消息的发送状态：
 * - sending: 旋转的圆圈动画
 * - failed: 红色感叹号
 * - sent: 不显示（已发送成功）
 *
 * ## 使用方式
 * ```typescript
 * import { SendStatusIndicator } from '../shared/SendStatusIndicator';
 *
 * <SendStatusIndicator status={message.sendStatus} />
 * ```
 *
 * @module chat/shared/SendStatusIndicator
 * @created 2026-01-24
 */

import { motion } from 'framer-motion';

/**
 * 发送状态类型
 */
export type SendStatus = 'sending' | 'sent' | 'failed';

interface SendStatusIndicatorProps {
  /** 发送状态 */
  status?: SendStatus;
}

/**
 * 发送状态指示器
 *
 * @param status 发送状态
 * @returns 状态指示器组件或 null
 */
export function SendStatusIndicator({ status }: SendStatusIndicatorProps) {
  if (!status || status === 'sent') {
    return null;
  }

  if (status === 'sending') {
    return (
      <motion.div
        className="send-status-indicator sending"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        title="发送中..."
      >
        <svg className="sending-spinner" viewBox="0 0 24 24" width={16} height={16}>
          <circle
            cx="12"
            cy="12"
            r="10"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="31.4 31.4"
            strokeLinecap="round"
          />
        </svg>
      </motion.div>
    );
  }

  if (status === 'failed') {
    return (
      <motion.div
        className="send-status-indicator failed"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.8 }}
        title="发送失败"
      >
        <svg viewBox="0 0 24 24" width={16} height={16} fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
        </svg>
      </motion.div>
    );
  }

  return null;
}
