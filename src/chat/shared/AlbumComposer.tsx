/**
 * 相册合成面板（Telegram 风格）—— 选完 N 张后配文再发
 *
 * @module chat/shared
 * @location src/chat/shared/AlbumComposer.tsx
 *
 * huanwei 的口径原话：「我要其外观和 telegram 类似」「能够混发集中，并配置文字装为一整个整体」
 * 「只要能够实现那个效果即可」。⇒ 形态照 Telegram：缩略图横排 + 配文输入框 + 发送键。
 *
 * 桌面与移动**共用同一个组件**（本仓两端对齐是硬指标），只靠 CSS 适配宽度。
 *
 * ## 两个不肯含糊的点
 * 1. **超出上限不静默丢弃**：选超过 10 张时，面板显式告诉用户「超出的 N 张未加入」，
 *    而不是悄悄截断 —— 用户以为发了 15 张、实际只发 10 张，是最坏的一种"成功"。
 * 2. **缩略图用 object URL 并在卸载时释放**：不释放会持有整份图片内存，
 *    连开几次相册就是几十上百 MB。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ALBUM_MAX_ITEMS } from './albumSend';
import type { PickedFile } from './FileAttachButton';

interface AlbumComposerProps {
  /** 用户选中的文件（可能超过上限，由本组件负责截断并明示） */
  picked: PickedFile[];
  /** 发送：回传最终入选的文件与整组配文 */
  onSend: (files: PickedFile[], caption: string) => void;
  /** 取消（不发送） */
  onCancel: () => void;
  /** 发送中（禁用交互，避免重复提交） */
  sending?: boolean;
}

export function AlbumComposer({ picked, onSend, onCancel, sending = false }: AlbumComposerProps) {
  // 超出上限的部分不进入待发列表，但**必须告诉用户**（见文件头第 1 点）
  const accepted = useMemo(() => picked.slice(0, ALBUM_MAX_ITEMS), [picked]);
  const droppedCount = picked.length - accepted.length;

  // 用户可以在面板里去掉某几张
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  const [caption, setCaption] = useState('');
  const captionRef = useRef<HTMLTextAreaElement>(null);

  const remaining = useMemo(
    () => accepted.filter((p) => !removed.has(p.localPath)),
    [accepted, removed],
  );

  // 缩略图 object URL：随入选集合建立，卸载/变更时释放（见文件头第 2 点）
  const previews = useMemo(
    () => accepted.map((p) => ({ key: p.localPath, url: URL.createObjectURL(p.file), name: p.file.name })),
    [accepted],
  );
  useEffect(() => () => {
    previews.forEach((pv) => URL.revokeObjectURL(pv.url));
  }, [previews]);

  useEffect(() => {
    captionRef.current?.focus();
  }, []);

  const toggleRemove = useCallback((localPath: string) => {
    setRemoved((prev) => {
      const next = new Set(prev);
      if (next.has(localPath)) {
        next.delete(localPath);
      } else {
        next.add(localPath);
      }
      return next;
    });
  }, []);

  const handleSend = useCallback(() => {
    if (sending || remaining.length === 0) { return; }
    onSend(remaining, caption);
  }, [sending, remaining, caption, onSend]);

  // Esc 取消；Ctrl/Cmd+Enter 发送（与输入框的换行不冲突）
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  }, [onCancel, handleSend]);

  return createPortal(
    <AnimatePresence>
      <motion.div
        className="album-composer-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.16 }}
        onClick={onCancel}
        role="presentation"
      >
        <motion.div
          className="album-composer"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={handleKeyDown}
          role="dialog"
          aria-modal="true"
          aria-label="发送相册"
        >
          <div className="album-composer-head">
            <span className="album-composer-title">
              发送 {remaining.length} 张
            </span>
            <span className="album-composer-count">{remaining.length}/{ALBUM_MAX_ITEMS}</span>
          </div>

          {/* 超出上限：明说被丢下多少张，不静默截断 */}
          {droppedCount > 0 && (
            <div className="album-composer-notice" role="status">
              一次最多 {ALBUM_MAX_ITEMS} 张，超出的 {droppedCount} 张未加入
            </div>
          )}

          <div className="album-composer-strip">
            {previews.map((pv) => {
              const isRemoved = removed.has(pv.key);
              return (
                <div
                  key={pv.key}
                  className={`album-composer-thumb${isRemoved ? ' album-composer-thumb--removed' : ''}`}
                >
                  <img src={pv.url} alt={pv.name} draggable={false} />
                  <button
                    type="button"
                    className="album-composer-thumb-toggle"
                    onClick={() => toggleRemove(pv.key)}
                    aria-label={isRemoved ? `重新加入 ${pv.name}` : `移除 ${pv.name}`}
                    title={isRemoved ? '重新加入' : '移除'}
                  >
                    {isRemoved ? '+' : '×'}
                  </button>
                </div>
              );
            })}
          </div>

          <textarea
            ref={captionRef}
            className="album-composer-caption"
            placeholder="添加描述（可选）"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={2}
            disabled={sending}
          />

          <div className="album-composer-actions">
            <button type="button" className="subtle-btn" onClick={onCancel} disabled={sending}>
              取消
            </button>
            <button
              type="button"
              className="subtle-btn subtle-btn--primary"
              onClick={handleSend}
              disabled={sending || remaining.length === 0}
            >
              {sending ? '发送中…' : '发送'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
