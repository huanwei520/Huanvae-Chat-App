/**
 * AI 聊天消息列表
 *
 * 复用现有的 chat-messages 容器样式。
 * 支持流式消息的实时显示、工具调用状态指示和写操作工具确认弹窗。
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AIMessageBubble } from './AIMessageBubble';
import { AIAvatar } from '../../components/common/AIAvatar';
import type { AIMessage } from '../../types/chat';
import type { AIToolStatus, AIPendingToolCall, AIStatus } from './useAIMessages';

/** 跟踪流式完成后需要跳过入场动画的消息 ID */
function useStreamedMessageId(streamingContent: string, messages: AIMessage[]): string | null {
  const wasStreamingRef = useRef(false);
  const skipIdRef = useRef<string | null>(null);

  if (streamingContent) {
    wasStreamingRef.current = true;
    skipIdRef.current = null;
  } else if (wasStreamingRef.current) {
    wasStreamingRef.current = false;
    const last = messages[messages.length - 1];
    skipIdRef.current = last?.role === 'assistant' ? last.id : null;
  }

  return skipIdRef.current;
}

const TOOL_NAME_MAP: Record<string, string> = {
  get_friend_list: '查询好友列表',
  send_message: '发送消息',
  get_user_profile: '查询用户资料',
  get_group_list: '查询群组列表',
  get_recent_messages: '查询聊天记录',
  send_friend_request: '发送好友请求',
  delete_friend: '删除好友',
  create_group: '创建群组',
  leave_group: '退出群组',
  send_group_message: '发送群消息',
};

/** 写操作工具参数的中文显示名 */
const TOOL_ARG_LABEL: Record<string, string> = {
  friend_id: '好友',
  content: '内容',
  group_id: '群组',
  group_name: '群名',
  user_id: '用户',
};

function getToolDisplayName(name: string): string {
  return TOOL_NAME_MAP[name] || name;
}

/** 写操作工具确认卡片 */
function ToolConfirmCard({
  pending,
  loading,
  onConfirm,
  onReject,
}: {
  pending: AIPendingToolCall;
  loading: boolean;
  onConfirm: () => void;
  onReject: () => void;
}) {
  const [remainingMs, setRemainingMs] = useState(() => {
    const expires = new Date(pending.expiresAt).getTime();
    return Math.max(0, expires - Date.now());
  });

  useEffect(() => {
    const timer = setInterval(() => {
      const expires = new Date(pending.expiresAt).getTime();
      setRemainingMs(Math.max(0, expires - Date.now()));
    }, 1000);
    return () => clearInterval(timer);
  }, [pending.expiresAt]);

  const remainingSec = Math.ceil(remainingMs / 1000);
  const expired = remainingMs <= 0;

  return (
    <motion.div
      className="message-row"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <div className="message-bubble other">
        <div className="bubble-avatar" style={{ width: 36, height: 36, flexShrink: 0 }}>
          <AIAvatar />
        </div>
        <div className="bubble-content">
          <div className="ai-tool-confirm-card">
            <div className="ai-tool-confirm-header">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>AI 想要执行操作</span>
            </div>

            <div className="ai-tool-confirm-name">
              {getToolDisplayName(pending.toolName)}
            </div>

            {Object.keys(pending.arguments).length > 0 && (
              <div className="ai-tool-confirm-args">
                {Object.entries(pending.arguments).map(([key, value]) => (
                  <div key={key} className="ai-tool-confirm-arg-row">
                    <span className="ai-tool-confirm-arg-label">
                      {TOOL_ARG_LABEL[key] || key}
                    </span>
                    <span className="ai-tool-confirm-arg-value">
                      {typeof value === 'string' ? value : JSON.stringify(value)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="ai-tool-confirm-timer">
              {expired ? '已超时' : `${remainingSec}秒后自动拒绝`}
            </div>

            <div className="ai-tool-confirm-actions">
              <button
                className="ai-tool-confirm-btn reject"
                onClick={onReject}
                disabled={loading || expired}
              >
                拒绝
              </button>
              <button
                className="ai-tool-confirm-btn confirm"
                onClick={onConfirm}
                disabled={loading || expired}
              >
                {loading ? '处理中...' : '确认执行'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

interface AIChatMessagesProps {
  messages: AIMessage[];
  streamingContent: string;
  streamingReasoning?: string;
  isLoading: boolean;
  toolStatus: AIToolStatus | null;
  aiStatus?: AIStatus | null;
  pendingToolCall?: AIPendingToolCall | null;
  onRetry?: () => void;
  onConfirmTool?: () => Promise<void>;
  onRejectTool?: () => Promise<void>;
}

export function AIChatMessages({
  messages,
  streamingContent,
  streamingReasoning = '',
  isLoading,
  toolStatus,
  aiStatus,
  pendingToolCall,
  onRetry,
  onConfirmTool,
  onRejectTool,
}: AIChatMessagesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const skipAnimationId = useStreamedMessageId(streamingContent, messages);
  const [confirmLoading, setConfirmLoading] = useState(false);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = containerRef.current;
    if (!el) { return; }
    el.scrollTo({
      top: el.scrollHeight,
      behavior: smooth ? 'smooth' : 'instant',
    });
  }, []);

  const checkAtBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) { return; }
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  useEffect(() => {
    scrollToBottom(false);
  }, [messages.length, scrollToBottom]);

  useEffect(() => {
    if ((streamingContent || streamingReasoning || toolStatus || pendingToolCall) && isAtBottomRef.current) {
      scrollToBottom();
    }
  }, [streamingContent, streamingReasoning, toolStatus, pendingToolCall, scrollToBottom]);

  if (isLoading) {
    return (
      <div
        ref={containerRef}
        className="chat-messages-container"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <span style={{ color: 'var(--text-tertiary)', fontSize: 14 }}>加载中...</span>
      </div>
    );
  }

  const hasMessages = messages.length > 0 || streamingContent || streamingReasoning || toolStatus;

  return (
    <div
      ref={containerRef}
      className="chat-messages-container"
      onScroll={checkAtBottom}
    >
      {!hasMessages && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 8,
          color: 'var(--text-tertiary)',
        }}>
          <span style={{ fontSize: 32 }}>AI</span>
          <span style={{ fontSize: 14 }}>发送消息开始对话</span>
        </div>
      )}

      <AnimatePresence mode="popLayout">
        {messages.map((msg, idx) => (
          <AIMessageBubble
            key={msg.id}
            message={msg}
            skipAnimation={msg.id === skipAnimationId}
            onRetry={
              msg.error && idx === messages.length - 1
                ? onRetry
                : undefined
            }
          />
        ))}
      </AnimatePresence>

      {(streamingContent || streamingReasoning) && (
        <AIMessageBubble
          message={{
            id: 'streaming',
            role: 'assistant',
            content: streamingContent || null,
            reasoning: streamingReasoning || null,
            created_at: new Date().toISOString(),
          }}
          isStreaming
          streamingReasoning={streamingReasoning}
        />
      )}

      {toolStatus && !streamingContent && toolStatus.status !== 'pending_confirm' && (
        <motion.div
          className="message-row"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="message-bubble other">
            <div className="bubble-avatar" style={{ width: 36, height: 36, flexShrink: 0 }}>
              <AIAvatar />
            </div>
            <div className="bubble-content">
              <div className="bubble-text" style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: 'var(--text-secondary)',
                fontSize: 13,
              }}>
                {toolStatus.status === 'calling' ? (
                  <>
                    <span style={{
                      display: 'inline-block',
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: '#3b82f6',
                      animation: 'ai-blink 1.2s ease-in-out infinite',
                      flexShrink: 0,
                    }} />
                    正在执行{getToolDisplayName(toolStatus.name)}...
                  </>
                ) : (
                  <>
                    <span style={{ color: '#22c55e', flexShrink: 0 }}>✓</span>
                    {getToolDisplayName(toolStatus.name)}完成
                  </>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {pendingToolCall && (
        <ToolConfirmCard
          pending={pendingToolCall}
          loading={confirmLoading}
          onConfirm={async () => {
            setConfirmLoading(true);
            try { await onConfirmTool?.(); } finally { setConfirmLoading(false); }
          }}
          onReject={async () => {
            setConfirmLoading(true);
            try { await onRejectTool?.(); } finally { setConfirmLoading(false); }
          }}
        />
      )}

      {aiStatus === 'thinking' && !streamingContent && !streamingReasoning && !toolStatus && !pendingToolCall && (
        <motion.div
          className="message-row"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="message-bubble other">
            <div className="bubble-avatar" style={{ width: 36, height: 36, flexShrink: 0 }}>
              <AIAvatar />
            </div>
            <div className="bubble-content">
              <div className="bubble-text" style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                color: 'var(--text-tertiary)',
                fontSize: 13,
              }}>
                <span style={{
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: 'var(--text-tertiary)',
                  animation: 'ai-blink 1.2s ease-in-out infinite',
                  flexShrink: 0,
                }} />
                AI 正在思考...
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
