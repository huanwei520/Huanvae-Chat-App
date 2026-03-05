/**
 * AI 消息气泡组件
 *
 * 复用现有的 message-bubble 样式结构。
 * user 消息显示在右侧蓝色气泡，assistant 消息显示在左侧灰色气泡。
 * 右键菜单仅提供「复制」功能，复制 Markdown 原始文本。
 */

import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AIAvatar } from '../../components/common/AIAvatar';
import { MarkdownRenderer } from '../../components/common/MarkdownRenderer';
import { formatMessageTime } from '../../utils/time';
import { isMobile } from '../../utils/platform';
import type { AIMessage } from '../../types/chat';

interface AIMessageBubbleProps {
  message: AIMessage;
  isStreaming?: boolean;
  skipAnimation?: boolean;
  streamingReasoning?: string;
  onRetry?: () => void;
}

const variants = {
  initial: (isOwn: boolean) => ({
    opacity: 0,
    x: isOwn ? 20 : -20,
    y: 10,
  }),
  animate: {
    opacity: 1,
    x: 0,
    y: 0,
  },
  exit: (isOwn: boolean) => ({
    opacity: 0,
    x: isOwn ? 20 : -20,
    y: -10,
  }),
};

const transition = { duration: 0.25, ease: [0.25, 0.1, 0.25, 1] as const };

/** AI 消息右键菜单（仅复制） */
function AIContextMenu({
  isOpen,
  position,
  bubbleRect,
  content,
  onClose,
}: {
  isOpen: boolean;
  position: { x: number; y: number };
  bubbleRect: DOMRect | null;
  content: string;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const mobile = isMobile();

  const handleCopy = useCallback(async () => {
    if (!content) { return; }
    try {
      await navigator.clipboard.writeText(content);
    } catch (err) {
      console.error('[AI ContextMenu] 复制失败:', err);
    }
    onClose();
  }, [content, onClose]);

  useEffect(() => {
    if (!isOpen) { return; }

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleTouchOutside = (e: TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleScroll = () => onClose();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); }
    };

    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleTouchOutside, { passive: true });
      document.addEventListener('scroll', handleScroll, true);
      document.addEventListener('keydown', handleKeyDown);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleTouchOutside);
      document.removeEventListener('scroll', handleScroll, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  const getMenuStyle = (): React.CSSProperties => {
    const padding = 10;

    if (mobile && bubbleRect) {
      const menuWidth = 68;
      const menuHeight = 44;
      let x = bubbleRect.left + bubbleRect.width / 2 - menuWidth / 2;
      if (x < padding) { x = padding; }
      if (x + menuWidth > window.innerWidth - padding) { x = window.innerWidth - menuWidth - padding; }
      let y = bubbleRect.top - menuHeight - 8;
      if (y < padding) { y = bubbleRect.bottom + 8; }
      return { position: 'fixed', left: x, top: y, zIndex: 99999 };
    }

    const menuWidth = 120;
    const menuHeight = 44;
    let x = position.x;
    let y = position.y;
    if (x + menuWidth > window.innerWidth - padding) { x = window.innerWidth - menuWidth - padding; }
    if (y + menuHeight > window.innerHeight - padding) { y = window.innerHeight - menuHeight - padding; }
    if (x < padding) { x = padding; }
    if (y < padding) { y = padding; }
    return { position: 'fixed', left: x, top: y, zIndex: 99999 };
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={menuRef}
          className={`message-context-menu ${mobile ? 'mobile-horizontal' : ''}`}
          style={getMenuStyle()}
          initial={{ opacity: 0, scale: 0.9, y: mobile ? 5 : -5 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: mobile ? 5 : -5 }}
          transition={{ duration: 0.15, ease: [0, 0, 0.2, 1] }}
        >
          <button className="context-menu-item" onClick={handleCopy}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" width={16} height={16}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
            </svg>
            <span>复制</span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** 思考过程可折叠面板 */
function ReasoningPanel({
  reasoning,
  isStreamingReasoning,
}: {
  reasoning: string;
  isStreamingReasoning: boolean;
}) {
  const [expanded, setExpanded] = useState(isStreamingReasoning);
  const prevStreamingRef = useRef(isStreamingReasoning);

  useEffect(() => {
    if (prevStreamingRef.current && !isStreamingReasoning) {
      setExpanded(false);
    }
    prevStreamingRef.current = isStreamingReasoning;
  }, [isStreamingReasoning]);

  return (
    <div className="ai-reasoning-panel">
      <button
        className="ai-reasoning-toggle"
        onClick={() => setExpanded(prev => !prev)}
      >
        <span className={`ai-reasoning-chevron ${expanded ? 'expanded' : ''}`}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M4 2.5L7.5 6L4 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="ai-reasoning-label">
          {isStreamingReasoning ? '思考中...' : '思考过程'}
        </span>
        {isStreamingReasoning && (
          <span className="ai-reasoning-dot" />
        )}
      </button>
      {isStreamingReasoning ? (
        // 流式阶段：不使用 motion 高度动画，避免 height:auto 不跟随内容增长
        expanded && (
          <div className="ai-reasoning-content">
            <div className="ai-reasoning-text">
              <MarkdownRenderer content={reasoning} />
            </div>
          </div>
        )
      ) : (
        // 完成后：使用 motion 动画实现折叠/展开
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              className="ai-reasoning-content"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            >
              <div className="ai-reasoning-text">
                <MarkdownRenderer content={reasoning} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}

/** 用户友好的错误文案映射 */
function getErrorDisplay(error: string): string {
  if (error.includes('流中断') || error.includes('响应流中断')) {
    return '回复中断';
  }
  if (error.includes('GLM stream failed') || error.includes('retries')) {
    return 'AI 服务暂时不可用';
  }
  if (error.includes('网络')) {
    return '网络连接失败';
  }
  return error.length > 40 ? `${error.slice(0, 40)}...` : error;
}

export const AIMessageBubble = memo(function AIMessageBubble({
  message,
  isStreaming = false,
  skipAnimation = false,
  streamingReasoning = '',
  onRetry,
}: AIMessageBubbleProps) {
  const isOwn = message.role === 'user';
  const bubbleRef = useRef<HTMLDivElement>(null);

  const [menuState, setMenuState] = useState<{
    isOpen: boolean;
    position: { x: number; y: number };
    bubbleRect: DOMRect | null;
  }>({ isOpen: false, position: { x: 0, y: 0 }, bubbleRect: null });

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = bubbleRef.current?.getBoundingClientRect() ?? null;
    setMenuState({ isOpen: true, position: { x: e.clientX, y: e.clientY }, bubbleRect: rect });
  }, []);

  const mobile = isMobile();
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    longPressTimer.current = setTimeout(() => {
      const rect = bubbleRef.current?.getBoundingClientRect() ?? null;
      setMenuState({ isOpen: true, position: { x: touch.clientX, y: touch.clientY }, bubbleRect: rect });
    }, 500);
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const handleCloseMenu = useCallback(() => {
    setMenuState(prev => ({ ...prev, isOpen: false }));
  }, []);

  return (
    <motion.div
      className={`message-row ${isOwn ? 'own' : ''}`}
      custom={isOwn}
      variants={variants}
      initial={skipAnimation ? false : 'initial'}
      animate="animate"
      exit="exit"
      transition={transition}
      layout="position"
    >
      <div
        ref={bubbleRef}
        className={`message-bubble ${isOwn ? 'own' : 'other'}`}
        onContextMenu={handleContextMenu}
        {...(mobile ? { onTouchStart: handleTouchStart, onTouchEnd: handleTouchEnd, onTouchCancel: handleTouchEnd } : {})}
      >
        {!isOwn && (
          <div className="bubble-avatar" style={{ width: 36, height: 36, flexShrink: 0 }}>
            <AIAvatar />
          </div>
        )}

        <div className="bubble-content">
          {!isOwn && (message.reasoning || streamingReasoning) && (
            <ReasoningPanel
              reasoning={message.reasoning || streamingReasoning}
              isStreamingReasoning={!!streamingReasoning && isStreaming}
            />
          )}
          <div className="bubble-text">
            {isOwn ? (
              <span style={{ whiteSpace: 'pre-wrap' }}>{message.content ?? ''}</span>
            ) : (
              <>
                {/* eslint-disable-next-line no-nested-ternary */}
                {message.content ? (
                  <MarkdownRenderer content={message.content} />
                ) : isStreaming ? (
                  <span className="ai-reasoning-waiting">思考完毕，正在组织回复...</span>
                ) : null}
                {isStreaming && message.content && (
                  <span className="ai-cursor" style={{
                    display: 'inline-block',
                    width: 2,
                    height: '1em',
                    background: 'var(--primary, #3b82f6)',
                    marginLeft: 2,
                    animation: 'ai-blink 1s step-end infinite',
                    verticalAlign: 'text-bottom',
                  }} />
                )}
              </>
            )}
          </div>

          {!isOwn && message.error && (
            <div className="ai-error-badge">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span className="ai-error-text">{getErrorDisplay(message.error)}</span>
              {onRetry && (
                <button className="ai-error-retry" onClick={onRetry}>
                  重试
                </button>
              )}
            </div>
          )}

          <div className="bubble-time">
            {formatMessageTime(message.created_at)}
          </div>
        </div>
      </div>

      <AIContextMenu
        isOpen={menuState.isOpen}
        position={menuState.position}
        bubbleRect={menuState.bubbleRect}
        content={message.content ?? ''}
        onClose={handleCloseMenu}
      />
    </motion.div>
  );
});
