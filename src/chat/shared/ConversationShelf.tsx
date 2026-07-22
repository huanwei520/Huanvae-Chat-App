/**
 * 顶置功能区（常驻窄条 + 点弹浮层卡）。
 * 挂 header 与消息列表之间；条目 = 对真实卡片消息的引用，复用 CardRenderer。
 * 三档权限（判定全在服务端，前端入口显隐仅 UX）：
 *  - bot 会话：用户只看/交互，不上架（上架是 bot 的能力）→ canManage=false
 *  - 群：仅群主可上架/排列 → canManage=(role==='owner')
 *  - 好友 1:1 非 bot / AI：无架（return null，不占位）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatTarget } from '../../types/chat';
import { useApi, useSession } from '../../contexts/SessionContext';
import { useShelfStore, shelfKey } from '../../stores/shelfStore';
import { getShelf, type ShelfScope, type ShelfItem } from '../../api/shelf';
import { getFriendConversationId } from '../../utils/conversationId';
import { ShelfCardOverlay } from './ShelfCardOverlay';
import './ConversationShelf.css';

const EMPTY_ITEMS: ShelfItem[] = [];

interface ResolvedShelf {
  scope: ShelfScope;
  scopeKey: string;
  conversationId: string;
  sourceType: 'friend' | 'group';
  canManage: boolean;
}

function resolveShelf(target: ChatTarget, userId: string): ResolvedShelf | null {
  if (target.type === 'bot') {
    const botUserId = target.data.friend_id;
    return {
      scope: 'bot',
      scopeKey: `${userId}:${botUserId}`,
      conversationId: getFriendConversationId(userId, botUserId),
      sourceType: 'friend',
      canManage: false,
    };
  }
  if (target.type === 'group') {
    return {
      scope: 'group',
      scopeKey: target.data.group_id,
      conversationId: target.data.group_id,
      sourceType: 'group',
      canManage: target.data.role === 'owner',
    };
  }
  return null;
}

export function ConversationShelf({ chatTarget }: { chatTarget: ChatTarget }) {
  const api = useApi();
  const { session } = useSession();
  const userId = session?.userId ?? '';

  const resolved = useMemo(
    () => (userId ? resolveShelf(chatTarget, userId) : null),
    [chatTarget, userId],
  );

  const key = resolved ? shelfKey(resolved.scope, resolved.scopeKey) : '';
  const items = useShelfStore((s) => (key ? s.itemsByConv[key] : undefined)) ?? EMPTY_ITEMS;

  const [overlayOpen, setOverlayOpen] = useState(false);
  const barRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState({ top: 0, left: 0, width: 0 });

  // 进会话拉快照；404 同形（无架/无权）→ 留空不占位
  useEffect(() => {
    if (!resolved) { return; }
    let cancelled = false;
    getShelf(api, resolved.scope, resolved.scopeKey)
      .then((res) => {
        if (!cancelled) {
          useShelfStore.getState().setItems(resolved.scope, resolved.scopeKey, res.items);
        }
      })
      .catch(() => { /* 404 同形：无架/无权，留空 */ });
    return () => { cancelled = true; };
  }, [api, resolved]);

  // 切会话关闭浮层
  useEffect(() => { setOverlayOpen(false); }, [key]);

  const toggleOverlay = useCallback(() => {
    if (barRef.current) {
      const r = barRef.current.getBoundingClientRect();
      setAnchor({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 320) });
    }
    setOverlayOpen((v) => !v);
  }, []);

  if (!resolved) { return null; }
  const hasContent = items.length > 0 || resolved.canManage;
  if (!hasContent) { return null; }

  return (
    <>
      <button
        ref={barRef}
        type="button"
        className="conversation-shelf-bar"
        aria-expanded={overlayOpen}
        onClick={toggleOverlay}
      >
        <span className="conversation-shelf-title">顶置</span>
        <span className="conversation-shelf-count">{items.length}</span>
        <span className={`conversation-shelf-chevron${overlayOpen ? ' expanded' : ''}`}>▾</span>
      </button>
      <ShelfCardOverlay
        open={overlayOpen}
        onClose={() => setOverlayOpen(false)}
        items={items}
        scope={resolved.scope}
        scopeKey={resolved.scopeKey}
        conversationId={resolved.conversationId}
        sourceType={resolved.sourceType}
        canManage={resolved.canManage}
        anchor={anchor}
      />
    </>
  );
}
