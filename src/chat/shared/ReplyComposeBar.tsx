/**
 * 输入框上方的「正在回复」条（Telegram 风格）
 *
 * @module chat/shared
 * @location src/chat/shared/ReplyComposeBar.tsx
 *
 * 由 ChatInputArea 渲染 —— 桌面 ChatPanel 与移动 MobileChatView 都复用同一个 ChatInputArea，
 * 所以这一条天然两端一致，不需要两处接线。
 *
 * 动画只做 opacity + height，不做 x/y/scale：位移会把元素边界伸出 .chat-content
 * （overflow:hidden 同时也是 scroll container），叠加 textarea 的 autofocus 滚动会造成
 * 头部栏/消息区「假下滑」——同 ChatInputArea 自身入场的约束，见 tests/unit/chatOpenNoYShift.test.ts。
 */

import { motion } from 'framer-motion';

interface ReplyComposeBarProps {
  /** 被回复者显示名 */
  senderName: string;
  /** 被回复消息的单行摘要 */
  preview: string;
  /** 取消回复 */
  onCancel: () => void;
}

export function ReplyComposeBar({ senderName, preview, onCancel }: ReplyComposeBarProps) {
  return (
    <motion.div
      className="reply-compose-bar"
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className="reply-compose-inner">
        <span className="reply-compose-bar-line" aria-hidden="true" />
        <div className="reply-compose-body">
          <span className="reply-compose-title">回复 {senderName}</span>
          <span className="reply-compose-preview">{preview}</span>
        </div>
        <button
          type="button"
          className="reply-compose-cancel"
          onClick={onCancel}
          aria-label="取消回复"
          title="取消回复"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} width={16} height={16}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </motion.div>
  );
}
