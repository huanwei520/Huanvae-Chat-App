/**
 * 顶置架浮层卡（非模态，可收起）。portal + fixed + framer-motion。
 * 内容解析：从本地会话窗口（db.getMessages）取卡片消息内容源；CardRenderer 再叠 cardLiveStore live。
 * 群主管理：上架（从本地会话卡片消息候选选取）/ 取消上架 / 上移下移排序（全部服务端二次强制）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { createPortal } from 'react-dom';
import { CardRenderer } from './CardRenderer';
import { useApi } from '../../contexts/SessionContext';
import * as db from '../../db';
import {
  getShelf,
  pinToShelf,
  unpinFromShelf,
  reorderShelf,
  type ShelfItem,
  type ShelfScope,
} from '../../api/shelf';
import { useShelfStore } from '../../stores/shelfStore';
import './ConversationShelf.css';

/** 内容解析 + 上架候选的本地会话窗口条数 */
const CONTENT_WINDOW = 200;

interface ShelfCardOverlayProps {
  open: boolean;
  onClose: () => void;
  items: ShelfItem[];
  scope: ShelfScope;
  scopeKey: string;
  conversationId: string;
  sourceType: 'friend' | 'group';
  canManage: boolean;
  anchor: { top: number; left: number; width: number };
}

export function ShelfCardOverlay({
  open, onClose, items, scope, scopeKey, conversationId, sourceType, canManage, anchor,
}: ShelfCardOverlayProps) {
  const api = useApi();
  const [contentMap, setContentMap] = useState<Map<string, string>>(() => new Map());
  const [cardMessages, setCardMessages] = useState<{ uuid: string; content: string }[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  // 浮层打开：拉本地会话卡片消息 → 内容源 + 群主上架候选源
  useEffect(() => {
    if (!open) { return; }
    let cancelled = false;
    db.getMessages(conversationId, CONTENT_WINDOW)
      .then((msgs) => {
        if (cancelled) { return; }
        const cards = msgs.filter((m) => m.content_type === 'card' && !m.is_deleted && !m.is_recalled);
        setContentMap(new Map(cards.map((m) => [m.message_uuid, m.content])));
        setCardMessages(cards.map((m) => ({ uuid: m.message_uuid, content: m.content })));
      })
      .catch(() => { /* 本地窗口不可用 → 占位 */ });
    return () => { cancelled = true; };
  }, [open, conversationId]);

  // ESC 关闭
  useEffect(() => {
    if (!open) { return; }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { onClose(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // 外点关闭（非模态）
  useEffect(() => {
    if (!open) { return; }
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.shelf-card-overlay') && !t.closest('.conversation-shelf-bar')) { onClose(); }
    };
    const timer = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => { clearTimeout(timer); document.removeEventListener('mousedown', onDown); };
  }, [open, onClose]);

  const refreshShelf = useCallback(async () => {
    const res = await getShelf(api, scope, scopeKey);
    useShelfStore.getState().setItems(scope, scopeKey, res.items);
  }, [api, scope, scopeKey]);

  const handleUnpin = useCallback(async (itemId: string) => {
    setActionError(null);
    try {
      await unpinFromShelf(api, scope, scopeKey, itemId);
      await refreshShelf();
    } catch {
      setActionError('取消上架失败');
    }
  }, [api, scope, scopeKey, refreshShelf]);

  const handleReorder = useCallback(async (index: number, dir: -1 | 1) => {
    const next = index + dir;
    if (next < 0 || next >= items.length) { return; }
    const ids = items.map((it) => it.item_id);
    const tmp = ids[index];
    ids[index] = ids[next];
    ids[next] = tmp;
    setActionError(null);
    try {
      const res = await reorderShelf(api, scope, scopeKey, ids);
      useShelfStore.getState().setItems(scope, scopeKey, res.items);
    } catch {
      setActionError('排序失败');
    }
  }, [api, scope, scopeKey, items]);

  const handlePin = useCallback(async (messageUuid: string) => {
    setActionError(null);
    try {
      await pinToShelf(api, scope, scopeKey, { message_uuid: messageUuid });
      await refreshShelf();
      setShowPicker(false);
    } catch {
      setActionError('上架失败');
    }
  }, [api, scope, scopeKey, refreshShelf]);

  const pinnedUuids = useMemo(() => new Set(items.map((it) => it.message_uuid)), [items]);
  const pickCandidates = useMemo(
    () => cardMessages.filter((m) => !pinnedUuids.has(m.uuid)),
    [cardMessages, pinnedUuids],
  );

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="shelf-card-overlay"
          initial={{ opacity: 0, y: -8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.98 }}
          transition={{ duration: 0.15 }}
          style={{ position: 'fixed', top: anchor.top, left: anchor.left, width: anchor.width }}
          role="dialog"
          aria-label="顶置功能区"
        >
          <div className="shelf-card-overlay-header">
            <span className="shelf-card-overlay-title">顶置功能区</span>
            {canManage && (
              <button type="button" className="shelf-manage-btn" onClick={() => setShowPicker((v) => !v)}>
                {showPicker ? '完成' : '上架'}
              </button>
            )}
            <button type="button" className="shelf-card-overlay-close" onClick={onClose} aria-label="收起">×</button>
          </div>

          {actionError && <div className="shelf-card-overlay-error">{actionError}</div>}

          {canManage && showPicker && (
            <div className="shelf-picker">
              {pickCandidates.length === 0 ? (
                <div className="shelf-picker-empty">无可上架的卡片消息</div>
              ) : (
                pickCandidates.map((m) => (
                  <button key={m.uuid} type="button" className="shelf-picker-item" onClick={() => handlePin(m.uuid)}>
                    <CardRenderer messageContent={m.content} messageUuid={m.uuid} sourceType={sourceType} audience="product" />
                    <span className="shelf-picker-pin">上架</span>
                  </button>
                ))
              )}
            </div>
          )}

          {items.length === 0 ? (
            <div className="shelf-card-overlay-empty">暂无顶置内容</div>
          ) : (
            items.map((item, i) => {
              const content = contentMap.get(item.message_uuid) ?? '';
              return (
                <div className="shelf-card-item" key={item.item_id}>
                  {item.note && <div className="shelf-card-note">{item.note}</div>}
                  {content ? (
                    <CardRenderer messageContent={content} messageUuid={item.message_uuid} sourceType={sourceType} audience="owner" />
                  ) : (
                    <div className="shelf-card-unavailable">卡片内容不在本地缓存（滚动会话加载后可见）</div>
                  )}
                  {canManage && (
                    <div className="shelf-card-actions">
                      <button type="button" onClick={() => handleReorder(i, -1)} disabled={i === 0} aria-label="上移">↑</button>
                      <button type="button" onClick={() => handleReorder(i, 1)} disabled={i === items.length - 1} aria-label="下移">↓</button>
                      <button type="button" className="shelf-unpin-btn" onClick={() => handleUnpin(item.item_id)}>取消上架</button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
