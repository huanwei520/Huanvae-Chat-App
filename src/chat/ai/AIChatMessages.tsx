/**
 * AI 聊天消息列表
 *
 * 复用现有的 chat-messages 容器样式。
 * 支持流式消息的实时显示和工具调用状态指示。
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AIMessageBubble } from './AIMessageBubble';
import { AIAvatar } from '../../components/common/AIAvatar';
import type { AIMessage } from '../../types/chat';
import type { AIToolStatus, AIPendingToolCall } from './useAIMessages';

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
  get_friend_list: '好友列表',
  send_message: '发送消息',
  get_user_profile: '用户资料',
  get_group_list: '群组列表',
  get_recent_messages: '聊天记录',
  send_friend_request: '好友请求',
};

function getToolDisplayName(name: string): string {
  return TOOL_NAME_MAP[name] || name;
}

/** 工具参数友好显示名 */
const TOOL_ARG_LABEL: Record<string, string> = {
  friend_id: '好友',
  content: '内容',
  group_id: '群组',
  message: '消息',
  user_id: '用户',
};

function formatToolArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([k, v]) => `${TOOL_ARG_LABEL[k] || k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('，');
}

interface AIChatMessagesProps {
  messages: AIMessage[];
  streamingContent: string;
  streamingReasoning?: string;
  isLoading: boolean;
  toolStatus: AIToolStatus | null;
  pendingToolCall?: AIPendingToolCall | null;
  onRetry?: () => void;
  onConfirmToolCall?: (pendingId: string) => Promise<void>;
  onRejectToolCall?: (pendingId: string) => Promise<void>;
}

export function AIChatMessages({
  messages,
  streamingContent,
  streamingReasoning = '',
  isLoading,
  toolStatus,
  pendingToolCall = null,
  onRetry,
  onConfirmToolCall,
  onRejectToolCall,
}: AIChatMessagesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const skipAnimationId = useStreamedMessageId(streamingContent, messages);

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

  const hasMessages = messages.length > 0 || streamingContent || streamingReasoning || toolStatus || pendingToolCall;

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

      {toolStatus && !streamingContent && !pendingToolCall && (
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
                    正在查询{getToolDisplayName(toolStatus.name)}...
                  </>
                ) : (
                  <>
                    <span style={{ color: '#22c55e', flexShrink: 0 }}>✓</span>
                    {getToolDisplayName(toolStatus.name)}查询完成
                  </>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {pendingToolCall && (
        <PendingToolCallCard
          pending={pendingToolCall}
          onConfirm={onConfirmToolCall}
          onReject={onRejectToolCall}
        />
      )}
    </div>
  );
}

// ============================================
// 写操作工具确认卡片
// ============================================

function PendingToolCallCard({
  pending,
  onConfirm,
  onReject,
}: {
  pending: AIPendingToolCall;
  onConfirm?: (pendingId: string) => Promise<void>;
  onReject?: (pendingId: string) => Promise<void>;
}) {
  const [loading, setLoading] = useState<'confirm' | 'reject' | null>(null);

  const handleConfirm = useCallback(async () => {
    if (loading) { return; }
    setLoading('confirm');
    try {
      await onConfirm?.(pending.pendingId);
    } finally {
      setLoading(null);
    }
  }, [loading, onConfirm, pending.pendingId]);

  const handleReject = useCallback(async () => {
    if (loading) { return; }
    setLoading('reject');
    try {
      await onReject?.(pending.pendingId);
    } finally {
      setLoading(null);
    }
  }, [loading, onReject, pending.pendingId]);

  const toolDisplayName = getToolDisplayName(pending.toolName);
  const argsDisplay = formatToolArgs(pending.arguments);

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
          <div className="bubble-text" style={{ padding: 0 }}>
            <div style={{
              background: 'var(--bg-tertiary, #f5f5f5)',
              borderRadius: 10,
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              minWidth: 220,
            }}>
              {/* 标题 */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--text-primary)',
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                AI 请求执行操作
              </div>

              {/* 操作信息 */}
              <div style={{
                fontSize: 13,
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
              }}>
                <div style={{ marginBottom: 4 }}>
                  <strong>操作：</strong>{toolDisplayName}
                </div>
                {argsDisplay && (
                  <div style={{
                    background: 'var(--bg-secondary, #eee)',
                    borderRadius: 6,
                    padding: '6px 10px',
                    fontSize: 12,
                    wordBreak: 'break-all',
                  }}>
                    {argsDisplay}
                  </div>
                )}
              </div>

              {/* 操作按钮 */}
              <div style={{
                display: 'flex',
                gap: 8,
                justifyContent: 'flex-end',
              }}>
                <button
                  onClick={handleReject}
                  disabled={loading !== null}
                  style={{
                    padding: '5px 14px',
                    borderRadius: 6,
                    border: '1px solid var(--border-color, #ddd)',
                    background: 'var(--bg-primary, #fff)',
                    color: 'var(--text-secondary)',
                    fontSize: 12,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    opacity: loading === 'confirm' ? 0.5 : 1,
                  }}
                >
                  {loading === 'reject' ? '拒绝中...' : '拒绝'}
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={loading !== null}
                  style={{
                    padding: '5px 14px',
                    borderRadius: 6,
                    border: 'none',
                    background: '#3b82f6',
                    color: '#fff',
                    fontSize: 12,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    opacity: loading === 'reject' ? 0.5 : 1,
                  }}
                >
                  {loading === 'confirm' ? '确认中...' : '确认执行'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
