/**
 * AI 聊天消息列表
 *
 * 复用现有的 chat-messages 容器样式。
 * 支持流式消息的实时显示和工具调用状态指示。
 */

import { useRef, useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AIMessageBubble } from './AIMessageBubble';
import { AIAvatar } from '../../components/common/AIAvatar';
import type { AIMessage } from '../../types/chat';
import type { AIToolStatus } from './useAIMessages';

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

interface AIChatMessagesProps {
  messages: AIMessage[];
  streamingContent: string;
  streamingReasoning?: string;
  isLoading: boolean;
  toolStatus: AIToolStatus | null;
  onRetry?: () => void;
}

export function AIChatMessages({
  messages,
  streamingContent,
  streamingReasoning = '',
  isLoading,
  toolStatus,
  onRetry,
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
    if ((streamingContent || streamingReasoning || toolStatus) && isAtBottomRef.current) {
      scrollToBottom();
    }
  }, [streamingContent, streamingReasoning, toolStatus, scrollToBottom]);

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

      {toolStatus && !streamingContent && (
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
    </div>
  );
}
