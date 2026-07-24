/**
 * 群详情面板（群资料 + 关系状态 + 加入/进入操作区）
 *
 * @location src/chat/shared/GroupDetailPanel.tsx
 *
 * 由 GroupDetailView 在桌面右侧抽屉 / 移动整页内渲染。镜像 OtherProfilePanel 的 QQ 风格：
 * 通栏封面（用群头像做背景）+ 上叠圆角淡染卡 + 头像骑卡片左上角。分组展示：
 * - 身份：群头像、群名、@群ID（可复制）、群简介
 * - 资料：成员数 / 创建时间 / 入群方式
 * - 关系：已加入(+角色) / 未加入
 * - 操作：多态主按钮（进入群聊 / 加入群聊 / 申请加群 / 待通过 / 不可加入）
 *
 * 数据：进入时拉 GET /api/groups/{id}/public（未加入群的公开信息）。成员身份读 chatStore.groups；
 * 非成员时拉 GET /api/groups/requests/sent 判断是否已有 pending 申请（据此把按钮翻成"待通过"）。
 */

import { useEffect, useState } from 'react';
import { useChatStore } from '../../stores';
import { useApi } from '../../contexts/SessionContext';
import {
  getPublicGroupInfo,
  applyToJoinGroup,
  getSentJoinRequests,
  type GroupInfo,
} from '../../api/groups';
import { AppButton } from '../../components/common/AppButton';
import { AvatarPlaceholder } from '../../components/common/AvatarPlaceholder';
import { resolveServerAvatarUrl } from '../../utils/avatar';
import { formatDate } from '../../utils/time';
import type { Group } from '../../types/chat';
import '../../styles/components/profile-sections.css';

interface GroupDetailPanelProps {
  /** 被查看的群 id */
  groupId: string;
  /** 关闭详情弹窗 */
  onClose: () => void;
  /** 「进入群聊」直达会话（容器注入） */
  onEnterGroup?: (group: Group) => void;
  /** 加入/申请成功后刷新群列表（容器注入 refreshGroups） */
  onRefreshGroups?: () => void;
}

/** 入群方式文案 */
function joinModeLabel(mode: string | undefined): string {
  switch (mode) {
    case 'open':
      return '允许直接加入';
    case 'approval_required':
      return '需审批';
    case 'invite_only':
      return '仅邀请';
    case 'admin_invite_only':
      return '仅管理员邀请';
    case 'closed':
      return '不允许加入';
    default:
      return '';
  }
}

/** 群内角色文案 */
function roleLabel(role: Group['role']): string {
  if (role === 'owner') { return '群主'; }
  if (role === 'admin') { return '管理员'; }
  return '成员';
}

/** 一行「标签 : 值」；值空则不渲染 */
function InfoRow({ label, value }: { label: string; value: string }) {
  if (!value) { return null; }
  return (
    <div className="profile-info-row">
      <span className="profile-info-label">{label}</span>
      <span className="profile-info-value">{value}</span>
    </div>
  );
}

export function GroupDetailPanel({ groupId, onClose, onEnterGroup, onRefreshGroups }: GroupDetailPanelProps) {
  const api = useApi();
  const groups = useChatStore((s) => s.groups);
  const memberGroup = groups.find((g) => g.group_id === groupId);
  const isMember = !!memberGroup;

  const [info, setInfo] = useState<GroupInfo | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pendingSent, setPendingSent] = useState(false);
  const [applying, setApplying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNote, setActionNote] = useState<string | null>(null);

  // 拉群公开信息（切换群时重置各态，避免串台到新群）
  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    setLoadError(false);
    setPendingSent(false);
    setActionError(null);
    setActionNote(null);
    getPublicGroupInfo(api, groupId)
      .then((g) => { if (!cancelled) { setInfo(g); } })
      .catch(() => { if (!cancelled) { setLoadError(true); } });
    return () => { cancelled = true; };
  }, [api, groupId]);

  // 仅非成员时拉「我发出的加群申请」，判断是否已有该群的 pending 申请
  useEffect(() => {
    if (isMember) { return undefined; }
    let cancelled = false;
    getSentJoinRequests(api)
      .then((resp) => {
        if (!cancelled) { setPendingSent(resp.requests.some((r) => r.group_id === groupId)); }
      })
      .catch(() => { /* 拉取失败：按钮回落到 join_mode 分支，用户仍可发起申请 */ });
    return () => { cancelled = true; };
  }, [api, groupId, isMember]);

  const groupName = info?.group_name ?? '';
  // 头像/背景必须经显示收口点解析（webview 验不过私有 CA 自签证书，裸后端 URL 加载失败）。
  const avatarUrl = resolveServerAvatarUrl(info?.group_avatar_url);
  const backgroundUrl = resolveServerAvatarUrl(info?.group_avatar_url);
  const intro = info?.group_description ?? null;

  const handleCopyId = () => {
    navigator.clipboard?.writeText(groupId).catch(() => { /* 复制失败忽略 */ });
  };

  const handleEnterGroup = () => {
    if (!memberGroup) { return; }
    onEnterGroup?.(memberGroup);
    onClose();
  };

  const handleApply = async () => {
    if (!info || applying || pendingSent) { return; }
    setApplying(true);
    setActionError(null);
    setActionNote(null);
    try {
      const res = await applyToJoinGroup(api, groupId);
      if (info.join_mode === 'open') {
        // 直接入群成功：刷新群列表，按钮据 isMember 翻成「进入群聊」
        onRefreshGroups?.();
      } else {
        // approval_required：进入待审核，按钮翻「待通过」
        setPendingSent(true);
      }
      setActionNote(res.message);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setApplying(false);
    }
  };

  // 关系状态文案
  const relationText = isMember && memberGroup ? `已加入 · ${roleLabel(memberGroup.role)}` : '未加入';

  // 多态主按钮：进入群聊 / 加入群聊 / 申请加群 / 待通过 / 不可加入 / 加载中
  let actionLabel = '';
  let actionDisabled = false;
  let actionHandler: (() => void) | undefined;
  if (isMember) {
    actionLabel = '进入群聊';
    actionHandler = handleEnterGroup;
  } else if (loadError) {
    // 群信息加载失败：非成员无法决定入群方式，操作区仅由 hint 提示，不渲染按钮
    actionLabel = '';
  } else if (!info) {
    actionLabel = '加载中...';
    actionDisabled = true;
  } else if (pendingSent) {
    actionLabel = '待通过';
    actionDisabled = true;
  } else if (info.join_mode === 'open') {
    actionLabel = applying ? '加入中...' : '加入群聊';
    actionDisabled = applying;
    actionHandler = handleApply;
  } else if (info.join_mode === 'approval_required') {
    actionLabel = applying ? '提交中...' : '申请加群';
    actionDisabled = applying;
    actionHandler = handleApply;
  } else {
    // closed / invite_only / admin_invite_only
    actionLabel = '不可加入';
    actionDisabled = true;
  }

  return (
    <div className="other-profile-panel group-detail-panel">
      <div className="qq-hero qq-hero--panel">
        <div
          className="qq-hero-cover"
          style={backgroundUrl ? { backgroundImage: `url("${backgroundUrl}")` } : undefined}
        >
          <div className="qq-hero-actions">
            <button
              type="button"
              className="qq-hero-btn qq-hero-btn--icon"
              onClick={onClose}
              aria-label="关闭"
            >
              ×
            </button>
          </div>
        </div>

        <div className="qq-hero-card">
          {/* 身份 */}
          <div className="qq-hero-headrow">
            <div className="qq-hero-avatar">
              {avatarUrl ? (
                <img src={avatarUrl} alt={groupName} />
              ) : (
                <AvatarPlaceholder name={groupName} fontSize="calc(var(--qq-avatar-size) * 0.4)" />
              )}
            </div>
            <div className="qq-hero-namecol">
              <span className="qq-hero-name">{groupName}</span>
              <div>
                <button
                  type="button"
                  className="qq-hero-id"
                  onClick={handleCopyId}
                  title="点击复制 ID"
                >
                  @{groupId}
                </button>
              </div>
            </div>
          </div>

          {loadError && <div className="other-profile-hint">群信息加载失败</div>}
          {intro && <div className="qq-hero-signature">{intro}</div>}

          {/* 资料 */}
          <div className="profile-section">
            <div className="profile-section-title">资料</div>
            <InfoRow label="成员数" value={info ? String(info.member_count) : ''} />
            <InfoRow label="创建于" value={formatDate(info?.created_at)} />
            <InfoRow label="入群方式" value={joinModeLabel(info?.join_mode)} />
          </div>

          {/* 关系 */}
          <div className="profile-section">
            <div className="profile-section-title">关系</div>
            <InfoRow label="状态" value={relationText} />
          </div>

          {/* 操作区 */}
          <div className="other-profile-actions">
            {actionError && <div className="other-profile-error">{actionError}</div>}
            {actionNote && <div className="form-success">{actionNote}</div>}
            {actionLabel && (
              <AppButton
                variant="primary"
                block
                onClick={actionHandler}
                disabled={actionDisabled}
              >
                {actionLabel}
              </AppButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
