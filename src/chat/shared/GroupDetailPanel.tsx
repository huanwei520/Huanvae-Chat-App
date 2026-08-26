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
 * - 操作：多态主按钮（进入群聊 / 加入群聊 / 申请加群 / 待通过 / 这条路被群主关了）
 *         🔴 **「这条路被群主关了」不是旧五档入群模式那个「不可加入」的复活**：那三个档管的是
 *         「谁也进不来」，已随后端 migration 043 整套删除；本态管的是**本次这条来源**
 *         （扫码 / 搜索群 ID / 好友推荐）被群主单独关掉 —— 换一条还开着的路仍然进得来，
 *         所以文案必须说清**关的是哪一条**，不能写成笼统的「不可加入」。
 *         + 「分享该群」（仅群成员可见 —— 分享群名片是「群内的人把群拿出去」的动作，
 *           非成员发一定 403，给一个必然失败的按钮不如不给）
 *
 * 数据：进入时拉 GET /api/groups/{id}/public（未加入群的公开信息）。成员身份读 chatStore.groups；
 * 非成员时拉 GET /api/groups/requests/sent 判断是否已有 pending 申请（据此把按钮翻成"待通过"）。
 *
 * ## 加群三开关（后端 migration 045）
 *
 * `POST /{id}/apply` 的 `source` **必填**，取值就是「这个群是怎么被我看到的」——
 * 由打开本面板的那个入口经 groupDetailStore 传进来（本面板自己看不出来）。服务端按 source
 * 挑对应的 `allow_join_via_*` 开关，关 ⇒ **403**。
 *
 * 🔴 客户端做**两层**：
 * 1. **预渲染**（`/public` 已下发这三个开关）——开关为 `false` 时按钮直接禁用并说明是哪条路关了，
 *    省掉一次必然失败的请求；
 * 2. **403 兜真值**（服务端才是唯一权威）——设置可能在两次请求之间被群主改掉，
 *    所以点下去之后仍要按状态码给同一句话。缺了第 2 层，"开关刚被关掉"会显示成一句无法解释的失败。
 *
 * 🔴 **第 1 层只在读到显式 `false` 时才拦**：字段是 `?:`（后端尚未上线时是 `undefined`），
 * 写成 `!info.allow_join_via_x` 会因 `!undefined === true` 把"我还不知道"误判成"关了"——
 * 那会在后端上线前把三条路**全部**堵死。不知道时放行、让服务端说了算，是保守方向。
 *
 * 🔴 「分享该群」**不按 card_share_scope 三档预判**（那是服务端强制的策略，客户端复刻一份
 * 只会漂移；且 `/public` 的该字段本仓 GroupInfo 类型尚未镜像，见交付里的契约缺口记账）。
 * 档位不够时由服务端返 403，文案在 ShareGroupCardModal 里说清是「你在该群的权限不够」。
 */

import { useEffect, useState } from 'react';
import { useChatStore } from '../../stores';
import { useApi } from '../../contexts/SessionContext';
import { apiErrorStatus } from '../../api/client';
import {
  getPublicGroupInfo,
  applyToJoinGroup,
  getSentJoinRequests,
  JOIN_SOURCE_LABELS,
  type GroupInfo,
  type GroupJoinSource,
} from '../../api/groups';
import { AppButton } from '../../components/common/AppButton';
import { AvatarPlaceholder } from '../../components/common/AvatarPlaceholder';
import { resolveServerAvatarUrl } from '../../utils/avatar';
import { formatDate } from '../../utils/time';
import type { Group } from '../../types/chat';
import { ShareGroupCardModal } from './ShareGroupCardModal';
import '../../styles/components/profile-sections.css';

interface GroupDetailPanelProps {
  /** 被查看的群 id */
  groupId: string;
  /**
   * 本次是从哪条加群路径打开的 —— `POST /{id}/apply` 的必填 `source`。
   *
   * 由 groupDetailStore 从打开入口带下来（发现搜索 ⇒ `search`、群名片 ⇒ `referral`、
   * 群二维码 ⇒ `qr`）。**本面板自己推断不出来**：同一个群从搜索结果和从好友转来的群名片
   * 点进来，界面完全一样，而服务端要据此挑不同的开关。
   *
   * `null` = 成员入口（群聊顶栏点进来），**不是从任何一条加群路径来的**。
   * 服务端要的那个 `source` 在这种情形下不存在 ⇒ 本面板**不提供加群按钮**。
   * 这不是兜底：编不出一个诚实的 `source` 时，唯一正确的动作就是不发这次请求
   * （随便挑一档 = 让服务端去查一个用户根本没走过的门）。
   */
  source: GroupJoinSource | null;
  /** 关闭详情弹窗 */
  onClose: () => void;
  /** 「进入群聊」直达会话（容器注入） */
  onEnterGroup?: (group: Group) => void;
  /** 加入/申请成功后刷新群列表（容器注入 refreshGroups） */
  onRefreshGroups?: () => void;
}

/**
 * 入群方式文案（审批开关两态）
 *
 * `undefined` 返回空串 ⇒ [`InfoRow`] 整行不渲染。后端整批尚未上线的窗口期里这个字段读到的
 * 就是 `undefined`，此时"不知道"比猜一个值更诚实。
 */
function joinPolicyLabel(needApproval: boolean | undefined): string {
  if (needApproval === undefined) { return ''; }
  return needApproval ? '需审批' : '允许直接加入';
}

/**
 * 本群对**某一条来源**开不开（加群三开关，migration 045）。
 *
 * 返回 `undefined` = **不知道**（后端尚未下发该字段）。🔴 调用方只许在读到显式 `false` 时才拦，
 * 绝不能写 `!isJoinSourceAllowed(...)`：那会把 `undefined` 一并当成"关了"，
 * 在后端上线前把三条路全部堵死（激进方向）。不知道时放行、由服务端 403 兜底。
 */
export function isJoinSourceAllowed(
  info: GroupInfo | null,
  source: GroupJoinSource | null,
): boolean | undefined {
  if (!info || !source) { return undefined; }
  if (source === 'qr') { return info.allow_join_via_qr; }
  if (source === 'search') { return info.allow_join_via_search; }
  return info.allow_join_via_referral;
}

/**
 * 「本群开放的加群方式」资料行文案。
 *
 * 三个字段全 `undefined`（后端未下发）⇒ 返回空串 ⇒ [`InfoRow`] 整行不渲染
 * （"不知道"比猜一个值诚实）。三条全关 ⇒ 明说全关，不要显示成空。
 */
export function joinSourcesLabel(info: GroupInfo | null): string {
  if (!info) { return ''; }
  const entries: ReadonlyArray<[GroupJoinSource, boolean | undefined]> = [
    ['qr', info.allow_join_via_qr],
    ['search', info.allow_join_via_search],
    ['referral', info.allow_join_via_referral],
  ];
  if (entries.every(([, v]) => v === undefined)) { return ''; }
  const open = entries.filter(([, v]) => v === true).map(([k]) => JOIN_SOURCE_LABELS[k]);
  return open.length > 0 ? open.join(' · ') : '均已关闭';
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

export function GroupDetailPanel({ groupId, source, onClose, onEnterGroup, onRefreshGroups }: GroupDetailPanelProps) {
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
  // 分享群名片面板：按需挂载（ShareTargetPicker 内部会查一次本地会话表，不能常驻）
  const [shareOpen, setShareOpen] = useState(false);

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
      .catch(() => { /* 拉取失败：按钮回落到审批开关分支，用户仍可发起申请 */ });
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
    // source 为 null 时按钮压根不渲染；这里再守一次是因为 `applyToJoinGroup` 的签名要求非空，
    // 而"编一个 source 传上去"正是本条设计要避免的事。
    if (!info || !source || applying || pendingSent) { return; }
    setApplying(true);
    setActionError(null);
    setActionNote(null);
    try {
      const res = await applyToJoinGroup(api, groupId, source);
      // 🔴 判据是**本次操作的真实结果**（响应 `status`），不是拿 info 里的开关预判 ——
      // 群设置可能在两次请求之间被群主改掉，预判会跟真实结果打架。
      // 必须写 `=== 'joined'`：后端未上线时 `status` 是 `undefined`，落 pending 分支
      // （保守、可恢复）；写成 `!== 'pending'` 会把没入群的判成已入群。
      if (res.status === 'joined') {
        // 直接入群成功：刷新群列表，按钮据 isMember 翻成「进入群聊」
        onRefreshGroups?.();
      } else {
        // 落了一条待审申请：按钮翻「待通过」
        setPendingSent(true);
      }
      setActionNote(res.message);
    } catch (err) {
      // 🔴 403 在本端点只有一个成因：本次这条来源被群主关了（群不存在是 404、已是成员是 400，
      // 见契约「错误响应」）⇒ 可以直接翻译成"关的是哪一条"。这一层不能省：`/public` 里的
      // 开关是**上一次**读到的值，群主可能刚刚改掉，预渲染那层拦不住。
      if (apiErrorStatus(err) === 403) {
        setActionError(`群主已关闭「${JOIN_SOURCE_LABELS[source]}」，请换一种方式加入`);
      } else {
        setActionError(err instanceof Error ? err.message : '操作失败');
      }
    } finally {
      setApplying(false);
    }
  };

  // 本次这条来源开不开（undefined = 后端还没下发这三个字段，不预判）
  const sourceAllowed = isJoinSourceAllowed(info, source);

  // 关系状态文案
  const relationText = isMember && memberGroup ? `已加入 · ${roleLabel(memberGroup.role)}` : '未加入';

  // 多态主按钮：进入群聊 / 加入群聊 / 申请加群 / 待通过 / 加载中
  // 🔴 最后一支是**无条件 else**（不是"需审批"专属分支）：审批开关读到 `undefined`
  // （后端未上线的窗口期）时落在这里，用户仍能点、仍能发起申请 —— 保守方向。
  // 绝不能写成 `!info.join_approval_required`：`!undefined === true` 会把"我还不知道"
  // 误判成"免审核"，那是激进方向。
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
  } else if (!source) {
    // 成员入口打开的面板，但看的人不是成员 —— 这次打开没有"来源"可言，
    // 编一档传上去就是让服务端查一个用户没走过的门 ⇒ 不给按钮，由 hint 说明。
    actionLabel = '';
  } else if (pendingSent) {
    actionLabel = '待通过';
    actionDisabled = true;
  } else if (sourceAllowed === false) {
    // 加群三开关：本次这条来源被群主关掉 ⇒ 按钮禁用并说清关的是哪一条。
    // 🔴 判据写 `=== false` 而不是 `!sourceAllowed`：后者会把 `undefined`（后端未下发）
    // 一并判成"关了"，在后端上线前把三条路全部堵死。
    actionLabel = `已关闭${JOIN_SOURCE_LABELS[source]}`;
    actionDisabled = true;
  } else if (info.join_approval_required === false) {
    actionLabel = applying ? '加入中...' : '加入群聊';
    actionDisabled = applying;
    actionHandler = handleApply;
  } else {
    actionLabel = applying ? '提交中...' : '申请加群';
    actionDisabled = applying;
    actionHandler = handleApply;
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
            <InfoRow label="入群方式" value={joinPolicyLabel(info?.join_approval_required)} />
            <InfoRow label="开放的加群方式" value={joinSourcesLabel(info)} />
          </div>

          {/* 关系 */}
          <div className="profile-section">
            <div className="profile-section-title">关系</div>
            <InfoRow label="状态" value={relationText} />
          </div>

          {/* 操作区 */}
          <div className="other-profile-actions">
            {actionError && <div className="other-profile-error">{actionError}</div>}
            {!isMember && !source && !loadError && info && (
              <div className="other-profile-hint">
                这里看不到加入入口，请从群搜索结果、好友分享的群名片或群二维码进入
              </div>
            )}
            {!isMember && source && sourceAllowed === false && !actionError && (
              <div className="other-profile-hint">
                {`群主已关闭「${JOIN_SOURCE_LABELS[source]}」，请换一种方式加入`}
              </div>
            )}
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
            {/* 分享群名片：只给群成员（非成员发一定 403，见文件头）。
                群资料还没拉回来时不给 —— 预览区要拿群名/头像/人数，没有 info 就没得预览。 */}
            {isMember && info && (
              <AppButton
                variant="secondary"
                block
                onClick={() => setShareOpen(true)}
              >
                分享该群
              </AppButton>
            )}
          </div>
        </div>
      </div>

      {shareOpen && info && (
        <ShareGroupCardModal group={info} onClose={() => setShareOpen(false)} />
      )}
    </div>
  );
}
