/**
 * AI 会话历史记录面板
 *
 * 右侧抽屉面板，展示所有 AI 历史会话列表。
 * 支持点击切换会话、单条删除（hover 显示）、多选批量删除。
 * 桌面端从右侧滑入覆盖在聊天区域之上，移动端全屏展示。
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { AIConversation } from '../../types/chat';
import { formatMessageTime } from '../../utils/time';

interface AIHistoryPanelProps {
  visible: boolean;
  conversations: AIConversation[];
  loading: boolean;
  currentConversationId: string | null;
  onSelect: (convId: string) => void;
  onDelete: (convId: string) => void;
  onClose: () => void;
  onLoad: () => void;
}

export function AIHistoryPanel({
  visible,
  conversations,
  loading,
  currentConversationId,
  onSelect,
  onDelete,
  onClose,
  onLoad,
}: AIHistoryPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);
  const [multiSelect, setMultiSelect] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBatch, setConfirmBatch] = useState(false);

  useEffect(() => {
    if (visible && !loadedRef.current) {
      loadedRef.current = true;
      onLoad();
    }
    if (!visible) {
      loadedRef.current = false;
      setMultiSelect(false);
      setSelected(new Set());
      setConfirmBatch(false);
    }
  }, [visible, onLoad]);

  // ESC: 多选模式下退出多选，否则关闭面板
  useEffect(() => {
    if (!visible) { return; }
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (multiSelect) {
          setMultiSelect(false);
          setSelected(new Set());
          setConfirmBatch(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [visible, multiSelect, onClose]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) { onClose(); }
  }, [onClose]);

  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setConfirmBatch(false);
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selected.size === conversations.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(conversations.map(c => c.id)));
    }
    setConfirmBatch(false);
  }, [conversations, selected.size]);

  const handleBatchDelete = useCallback(() => {
    if (!confirmBatch) {
      setConfirmBatch(true);
      setTimeout(() => setConfirmBatch(false), 3000);
      return;
    }
    selected.forEach(id => onDelete(id));
    setSelected(new Set());
    setMultiSelect(false);
    setConfirmBatch(false);
  }, [confirmBatch, selected, onDelete]);

  const exitMultiSelect = useCallback(() => {
    setMultiSelect(false);
    setSelected(new Set());
    setConfirmBatch(false);
  }, []);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="ai-history-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={handleBackdropClick}
        >
          <motion.div
            ref={panelRef}
            className="ai-history-panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'tween', duration: 0.25 }}
          >
            {/* 头部 */}
            <div className="ai-history-header">
              {multiSelect ? (
                <>
                  <h3>已选 {selected.size} 项</h3>
                  <div className="ai-history-header-actions">
                    <button className="ai-history-header-btn" onClick={handleSelectAll} title="全选/取消全选">
                      {selected.size === conversations.length ? '取消全选' : '全选'}
                    </button>
                    <button className="ai-history-header-btn cancel" onClick={exitMultiSelect}>
                      取消
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <h3>历史记录</h3>
                  <div className="ai-history-header-actions">
                    {conversations.length > 0 && (
                      <button className="ai-history-header-btn" onClick={() => setMultiSelect(true)} title="多选删除">
                        多选
                      </button>
                    )}
                    <button className="ai-history-close" onClick={onClose}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* 列表 */}
            <div className="ai-history-list">
              {loading && conversations.length === 0 && (
                <div className="ai-history-empty">加载中...</div>
              )}
              {!loading && conversations.length === 0 && (
                <div className="ai-history-empty">暂无历史记录</div>
              )}
              {conversations.map(conv => (
                <HistoryItem
                  key={conv.id}
                  conversation={conv}
                  isActive={conv.id === currentConversationId}
                  multiSelect={multiSelect}
                  isSelected={selected.has(conv.id)}
                  onSelect={onSelect}
                  onDelete={onDelete}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </div>

            {/* 多选操作栏 */}
            <AnimatePresence>
              {multiSelect && selected.size > 0 && (
                <motion.div
                  className="ai-history-batch-bar"
                  initial={{ y: '100%', opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: '100%', opacity: 0 }}
                  transition={{ type: 'tween', duration: 0.2 }}
                >
                  <button
                    className={`ai-history-batch-delete ${confirmBatch ? 'confirm' : ''}`}
                    onClick={handleBatchDelete}
                  >
                    {confirmBatch ? `确认删除 ${selected.size} 项` : `删除 ${selected.size} 项`}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface HistoryItemProps {
  conversation: AIConversation;
  isActive: boolean;
  multiSelect: boolean;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleSelect: (id: string) => void;
}

function HistoryItem({
  conversation, isActive, multiSelect, isSelected,
  onSelect, onDelete, onToggleSelect,
}: HistoryItemProps) {
  const [showDelete, setShowDelete] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleClick = () => {
    if (multiSelect) {
      onToggleSelect(conversation.id);
    } else {
      onSelect(conversation.id);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirmDelete) {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    onDelete(conversation.id);
  };

  return (
    <div
      className={`ai-history-item ${isActive && !multiSelect ? 'active' : ''} ${isSelected ? 'selected' : ''}`}
      onClick={handleClick}
      onMouseEnter={() => { if (!multiSelect) { setShowDelete(true); } }}
      onMouseLeave={() => { setShowDelete(false); setConfirmDelete(false); }}
    >
      {multiSelect && (
        <div className={`ai-history-checkbox ${isSelected ? 'checked' : ''}`}>
          {isSelected && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
      )}
      <div className="ai-history-item-content">
        <div className="ai-history-item-title">{conversation.title || '新对话'}</div>
        <div className="ai-history-item-meta">
          <span>{conversation.message_count} 条消息</span>
          {conversation.last_message_at && (
            <>
              <span className="ai-history-dot">·</span>
              <span>{formatMessageTime(conversation.last_message_at)}</span>
            </>
          )}
        </div>
      </div>
      {!multiSelect && showDelete && (
        <button
          className={`ai-history-delete ${confirmDelete ? 'confirm' : ''}`}
          onClick={handleDelete}
          title={confirmDelete ? '再次点击确认删除' : '删除'}
        >
          {confirmDelete ? '确认' : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}
