/**
 * 群成员头像网格（侧边设置面板的第一屏内容，微信群聊那个样子）
 *
 * 头像成网格铺开、昵称在头像下方；点某个成员 → 打开他的资料页。
 * 取代原来「查看成员」这个**只是个入口**的菜单项 —— 成员现在一进面板就看得见。
 *
 * ## 默认只渲染 COLLAPSED_COUNT 个，超出的**不进 DOM**
 *
 * 群可以有几百上千人，「先全渲染再 CSS 隐藏」在大群里会白白造上千个节点。所以折叠态是
 * **真的只 map 前 N 个**，点「查看更多」才展开全部（有测试断言渲染数量，别改成 CSS 隐藏）。
 *
 * N = 10 = 每行 5 个 × 2 行：面板宽 `min(400px, 100vw - 56px)`，减去左右 20px 内边距后
 * 每格 ≥ 64px 时一行正好放得下 5 个（`repeat(5, 1fr)`），两端同宽故取值一致；两行是微信
 * 群资料页的观感基线，既够"一眼看到都有谁"，又不至于把下面的分组全顶走。
 *
 * ## 点头像 = 看资料，这是它的正常功能
 *
 * ⚠️ 别跟「会话列表卡片上的头像」搞混 —— 那三处（UnifiedList / MobileChatList /
 * MobileContacts）是**点头像进会话、不跳资料页**。成员网格里点头像看资料是本来就该有的。
 */

import { useState } from 'react';
import { useKbdFocusRing } from '../../../hooks/useKbdFocusRing';
import { resolveServerAvatarUrl } from '../../../utils/avatar';
import { AvatarPlaceholder } from '../../../components/common/AvatarPlaceholder';
import { groupMemberDisplayName } from '../../../utils/groupRemark';
import type { GroupMember } from '../../../api/groups';

/** 折叠态渲染的成员数（5 列 × 2 行，见文件头） */
export const MEMBER_GRID_COLLAPSED_COUNT = 10;

interface MemberGridProps {
  members: GroupMember[];
  loading: boolean;
  /** D7 群内私有备注：本群「我设的备注」映射（user_id → 备注名）；展示名优先用备注 */
  remarks?: Record<string, string>;
  /** 当前用户 ID（自己那格标「我」） */
  currentUserId?: string;
  /** 点某个成员 → 打开其资料 */
  onSelect: (member: GroupMember) => void;
}

export function MemberGrid({
  members,
  loading,
  remarks,
  currentUserId,
  onSelect,
}: MemberGridProps) {
  const [expanded, setExpanded] = useState(false);
  const memberKbd = useKbdFocusRing();

  const overflow = members.length > MEMBER_GRID_COLLAPSED_COUNT;
  // 折叠时**只取前 N 个**：超出的压根不渲染，不是渲染完再藏
  const visible = expanded || !overflow
    ? members
    : members.slice(0, MEMBER_GRID_COLLAPSED_COUNT);

  return (
    <section className="menu-group member-grid-group">
      <h3 className="menu-group-title">群成员{members.length > 0 ? ` (${members.length})` : ''}</h3>

      {loading && members.length === 0 && <div className="menu-loading">加载中...</div>}
      {!loading && members.length === 0 && <div className="menu-empty">暂无成员</div>}

      {members.length > 0 && (
        <div className="member-grid">
          {visible.map((member) => {
            // 显示名：备注优先 → 群昵称 → 用户昵称（与成员列表同口径）
            const displayName = groupMemberDisplayName(
              remarks?.[member.user_id],
              member.group_nickname || member.user_nickname,
            );
            const handlers = memberKbd.handlersFor(member.user_id);
            const kbdFocused = memberKbd.isKbdFocused(member.user_id);
            return (
              <button
                key={member.user_id}
                type="button"
                className={`member-grid-item${kbdFocused ? ' a11y-kbd-focus' : ''}`}
                onClick={() => onSelect(member)}
                aria-label={`查看${displayName}资料`}
                onPointerDown={handlers.onPointerDown}
                onFocus={handlers.onFocus}
                onBlur={handlers.onBlur}
              >
                <span className="member-grid-avatar">
                  {member.user_avatar_url ? (
                    <img src={resolveServerAvatarUrl(member.user_avatar_url) || ''} alt="" />
                  ) : (
                    <AvatarPlaceholder name={displayName} fontSize={14} />
                  )}
                </span>
                <span className="member-grid-name">
                  {displayName}
                  {member.user_id === currentUserId && ' (我)'}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {overflow && !expanded && (
        <button
          type="button"
          className="member-grid-more"
          onClick={() => setExpanded(true)}
        >
          查看更多（{members.length - MEMBER_GRID_COLLAPSED_COUNT}）
        </button>
      )}
    </section>
  );
}
