/**
 * 分享目标选择器（「发给谁」那一半）
 *
 * @module components/share
 * @location src/components/share/ShareTargetPicker.tsx
 *
 * A 版（快捷卡）落地件。**内容无关**：本组件只负责「选中了哪些会话」，
 * 要发什么、怎么发全部由调用方注入：
 * - `preview`   —— 顶部固定内容预览区的 slot（ReactNode；转发给消息预览条、
 *                  会议分享给会议信息、群名片给群卡片，三种内容各自渲染自己那份）
 * - `onConfirm` —— 发送动作（拿到 ShareTarget[]，自己决定调哪个 API）
 * - `targetTypes` —— 可选中的类型（省略 = 好友 + 群组；「邀请好友入群」传 `['friend']`）
 *
 * 之所以切在这条缝上：三种内容唯一共享的是「一个可搜索、可多选、按最近排序的
 * 会话列表 + 已选 chip + 底部计数/发送」，而**发送语义各不相同**
 * （转发要逐条重发媒体、会议邀请是一条 meeting_invite、群名片是 group_card）。
 * 把发送留在调用方，本组件就不需要知道任何业务类型，也不必为第 4 种内容再改一次。
 *
 * 挂载语义：**只在要显示时挂载**（调用方 `{open && <ShareTargetPicker …/>}`）。
 * 关闭走内部 `visible=false` → AnimatePresence 退场完成后再回调 `onClose`，
 * 所以进/出场动画都在，且不会在每个消息气泡上常驻一个会查本地库的组件。
 *
 * 动画所有权：overlay 的 opacity、卡片的 opacity/transform 由 framer-motion 逐帧接管，
 * CSS 侧一律不得声明这两个属性的 transition（见 ShareTargetPicker.css 与
 * tests/animation-conflict.test.ts 的 `.share-picker-overlay` / `.share-picker-card` 登记）。
 */

import { useState, useMemo, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useChatStore } from '../../stores/chatStore';
import { useLocalConversations } from '../../hooks/useLocalConversations';
import { comparePinnedThenTime } from '../unified/conversationSort';
import { friendDisplayName } from '../../utils/friendName';
import { formatMessageTime } from '../../utils/time';
import { AvatarPlaceholder } from '../common/AvatarPlaceholder';
import type { Friend, Group } from '../../types/chat';
import './ShareTargetPicker.css';

/** 被选中的一个会话（好友或群） */
export interface ShareTarget {
  type: 'friend' | 'group';
  id: string;
  name: string;
  avatarUrl: string | null;
}

/** 列表里的一行（ShareTarget + 排序/副标题所需的会话预览信息） */
interface TargetRow extends ShareTarget {
  /** `${type}-${id}`，同时用作 React key 与选中态比对键 */
  uniqueKey: string;
  lastMessage: string | null;
  lastMessageTime: string | null;
  isPinned: boolean;
}

interface ShareTargetPickerProps {
  /** 卡片标题（转发到 / 分享会议邀请 / …） */
  title: string;
  /** 顶部固定内容预览区；不给则不渲染该区（列表直接顶到搜索框） */
  preview?: ReactNode;
  /**
   * 可选中的目标类型。**省略 = 好友 + 群组**（三个分享场景的既有行为，一字未改）。
   *
   * 传 `['friend']` 时群组整段不出现（含「最近聊天」里的群），搜索框文案随之收窄 ——
   * 「邀请好友入群」就是这一档：把群列出来毫无意义，选了也没有可调的接口。
   * 过滤在**数据源**上做而不是只藏 UI：藏起来的行仍会进「最近聊天」的排序与 RECENT_LIMIT
   * 名额，用户会看到一个莫名少于 8 条的最近列表。
   */
  targetTypes?: ReadonlyArray<'friend' | 'group'>;
  /** 发送动作。抛错由调用方自己处理，本组件只负责把按钮从「发送中」放回可点 */
  onConfirm: (targets: ShareTarget[]) => Promise<void> | void;
  /** 退场动画播完后触发（调用方在此卸载本组件） */
  onClose: () => void;
  /** 发送按钮文案 */
  confirmLabel?: string;
  /** 发送成功后的短暂文案 */
  sentLabel?: string;
  /**
   * 底部计数的量词 + 名词（默认 `'个会话'` ⇒「已选 N 个会话」，三个分享场景一字未改）。
   * 只选好友时传 `'位好友'` —— 邀请好友入群的场合说「会话」是错的（选的是人，不是会话）。
   */
  countUnit?: string;
}

/** 「最近聊天」段最多显示几条 —— 再多就该用搜索了，A 版的取舍是「一屏完事」 */
const RECENT_LIMIT = 8;

/** `targetTypes` 的默认值。提到模块级是为了引用稳定 —— 写成默认参数字面量会让
 *  下面那个 useMemo 的依赖每次 render 都换新引用，等于 memo 失效。 */
const ALL_TARGET_TYPES: ReadonlyArray<'friend' | 'group'> = ['friend', 'group'];

/** 发送成功后停留多久再关闭（让用户看见「已发送」） */
const SENT_CLOSE_DELAY_MS = 900;

/** 圆形头像：有 URL 用 URL（store 里的 URL 已在数据边界经 resolveServerAvatarUrl 解析），否则首字母占位 */
function TargetAvatar({ name, avatarUrl, size }: { name: string; avatarUrl: string | null; size: number }) {
  const style = { width: size, height: size };
  if (avatarUrl) {
    return <img className="share-picker-avatar" style={style} src={avatarUrl} alt="" />;
  }
  return (
    <span className="share-picker-avatar" style={style}>
      <AvatarPlaceholder name={name} fontSize={Math.round(size * 0.42)} />
    </span>
  );
}

export function ShareTargetPicker({
  title,
  preview,
  targetTypes = ALL_TARGET_TYPES,
  onConfirm,
  onClose,
  confirmLabel = '发送',
  sentLabel = '已发送',
  countUnit = '个会话',
}: ShareTargetPickerProps) {
  const friends = useChatStore((s) => s.friends);
  const groups = useChatStore((s) => s.groups);
  const { getFriendPreview, getGroupPreview } = useLocalConversations();

  const [visible, setVisible] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ShareTarget[]>([]);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- 三段数据 ----------------------------------------------------------
  // 「最近聊天」的取数依据：本地会话表（useLocalConversations → db_get_conversation_previews），
  // 与桌面会话列表 UnifiedList 用的是同一份数据、同一个比较器（comparePinnedThenTime），
  // 所以这里的顺序与用户在会话列表里看到的顺序一致。没聊过的会话没有本地行 ⇒ 不进「最近」。
  const friendRows = useMemo((): TargetRow[] => (friends || []).map((f: Friend) => {
    const p = getFriendPreview(f.friend_id);
    return {
      type: 'friend',
      id: f.friend_id,
      name: friendDisplayName(f),
      avatarUrl: f.friend_avatar_url,
      uniqueKey: `friend-${f.friend_id}`,
      lastMessage: p?.lastMessage ?? null,
      lastMessageTime: p?.lastMessageTime ?? null,
      isPinned: p?.isPinned ?? false,
    };
  }), [friends, getFriendPreview]);

  const groupRows = useMemo((): TargetRow[] => (groups || []).map((g: Group) => {
    const p = getGroupPreview(g.group_id);
    return {
      type: 'group',
      id: g.group_id,
      name: g.group_name,
      avatarUrl: g.group_avatar_url || null,
      uniqueKey: `group-${g.group_id}`,
      lastMessage: p?.lastMessage ?? g.last_message_content ?? null,
      lastMessageTime: p?.lastMessageTime ?? g.last_message_time ?? null,
      isPinned: p?.isPinned ?? false,
    };
  }), [groups, getGroupPreview]);

  const allowFriends = targetTypes.includes('friend');
  const allowGroups = targetTypes.includes('group');

  const sections = useMemo(() => {
    // 先按 targetTypes 收窄数据源，再排「最近聊天」—— 顺序反了的话被排除的类型
    // 仍会占掉 RECENT_LIMIT 的名额（见 targetTypes 的 prop 注释）
    const pickableFriends = allowFriends ? friendRows : [];
    const pickableGroups = allowGroups ? groupRows : [];

    const recent = [...pickableFriends, ...pickableGroups]
      .filter((r) => r.lastMessageTime !== null)
      .sort((a, b) => comparePinnedThenTime(
        { ...a, unreadCount: 0 },
        { ...b, unreadCount: 0 },
      ))
      .slice(0, RECENT_LIMIT);
    const recentKeys = new Set(recent.map((r) => r.uniqueKey));

    const q = search.trim().toLowerCase();
    const match = (rows: TargetRow[]) => (q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows);

    return [
      { label: '最近聊天', rows: match(recent) },
      { label: '好友', rows: match(pickableFriends.filter((r) => !recentKeys.has(r.uniqueKey))) },
      { label: '群组', rows: match(pickableGroups.filter((r) => !recentKeys.has(r.uniqueKey))) },
    ].filter((s) => s.rows.length > 0);
  }, [friendRows, groupRows, search, allowFriends, allowGroups]);

  /** 搜索框文案跟着可选类型走 —— 只能选好友时还写「搜索好友、群组」是在骗用户 */
  const searchHint = (() => {
    if (allowFriends && allowGroups) { return '搜索好友、群组'; }
    return allowFriends ? '搜索好友' : '搜索群组';
  })();

  const totalVisible = sections.reduce((n, s) => n + s.rows.length, 0);

  // ---- 选中态 ------------------------------------------------------------
  const isSelected = useCallback(
    (type: 'friend' | 'group', id: string) => selected.some((s) => s.type === type && s.id === id),
    [selected],
  );

  const toggleSelect = useCallback((item: ShareTarget) => {
    setSelected((prev) => (prev.some((s) => s.type === item.type && s.id === item.id)
      ? prev.filter((s) => !(s.type === item.type && s.id === item.id))
      : [...prev, item]));
  }, []);

  const removeSelected = useCallback((type: 'friend' | 'group', id: string) => {
    setSelected((prev) => prev.filter((s) => !(s.type === type && s.id === id)));
  }, []);

  // ---- 关闭 / 发送 -------------------------------------------------------
  const requestClose = useCallback(() => {
    if (sending) { return; }
    setVisible(false);
  }, [sending]);

  const handleSend = useCallback(async () => {
    if (selected.length === 0 || sending) { return; }
    setSending(true);
    setError(null);
    try {
      await onConfirm(selected);
      setSent(true);
      setTimeout(() => setVisible(false), SENT_CLOSE_DELAY_MS);
    } catch (err) {
      // 发送失败必须让用户看见（面板留在原地、已选不清空，可直接重试）
      setError(err instanceof Error ? err.message : '发送失败，请重试');
    } finally {
      setSending(false);
    }
  }, [selected, sending, onConfirm]);

  return createPortal(
    <AnimatePresence onExitComplete={onClose}>
      {visible && (
        <motion.div
          className="share-picker-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={requestClose}
        >
          <motion.div
            className="share-picker-card"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={title}
          >
            <div className="share-picker-head">
              <h3>{title}</h3>
              <button type="button" className="share-picker-close" onClick={requestClose} aria-label="关闭">&times;</button>
            </div>

            {preview && <div className="share-picker-preview">{preview}</div>}

            <input
              className="share-picker-search"
              type="text"
              placeholder={searchHint}
              aria-label={searchHint}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />

            {selected.length > 0 && (
              <div className="share-picker-chips">
                {selected.map((s) => (
                  <span className="share-picker-chip" key={`${s.type}-${s.id}`}>
                    <TargetAvatar name={s.name} avatarUrl={s.avatarUrl} size={20} />
                    <span className="share-picker-chip-name">{s.name}</span>
                    <button
                      type="button"
                      className="share-picker-chip-x"
                      aria-label={`取消选择 ${s.name}`}
                      onClick={() => removeSelected(s.type, s.id)}
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="share-picker-list">
              {totalVisible === 0 && <div className="share-picker-empty">没有匹配的会话</div>}
              {sections.map((section) => (
                <div key={section.label}>
                  <div className="share-picker-section-label">{section.label}</div>
                  {section.rows.map((row) => {
                    const on = isSelected(row.type, row.id);
                    return (
                      <button
                        type="button"
                        key={row.uniqueKey}
                        className={`share-picker-row ${on ? 'on' : ''}`}
                        aria-pressed={on}
                        onClick={() => toggleSelect({
                          type: row.type, id: row.id, name: row.name, avatarUrl: row.avatarUrl,
                        })}
                      >
                        <span className={`share-picker-tick ${on ? 'on' : ''}`}>
                          {on && (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M4 12.5l5.2 5.2L20 6.8" />
                            </svg>
                          )}
                        </span>
                        <TargetAvatar name={row.name} avatarUrl={row.avatarUrl} size={38} />
                        <span className="share-picker-row-mid">
                          <span className="share-picker-row-name">
                            {row.name}
                            {row.type === 'group' && <span className="share-picker-row-tag">[群聊]</span>}
                          </span>
                          {row.lastMessage && <span className="share-picker-row-sub">{row.lastMessage}</span>}
                        </span>
                        {row.lastMessageTime && (
                          <span className="share-picker-row-time">{formatMessageTime(row.lastMessageTime)}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {error && <div className="share-picker-error" role="alert">{error}</div>}

            <div className="share-picker-foot">
              <span className="share-picker-count">已选 <b>{selected.length}</b> {countUnit}</span>
              <button
                type="button"
                className="share-picker-send"
                onClick={handleSend}
                disabled={selected.length === 0 || sending || sent}
              >
                {(() => {
                  if (sent) { return sentLabel; }
                  if (sending) { return '发送中...'; }
                  return confirmLabel;
                })()}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
