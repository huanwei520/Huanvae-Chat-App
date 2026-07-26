/**
 * 待通过申请：合并 + 排序 + 方向标签的纯逻辑（桌面 PendingRequestsPanel / 移动 MobileAddPage 共用）
 *
 * 把「收到的好友申请 / 收到的群邀请 / 我发出的好友申请 / 我发出的加群申请」四类合并成
 * 单一列表（像历史记录一样按时间倒序排在一起），并给每条生成「方向 + 类型」的小字标签。
 * 纯函数 + 数据加载，无 React / Tauri UI 依赖 —— 两端共用，可单测。
 */

import {
  getPendingRequests,
  getSentFriendRequests,
  type PendingRequest,
  type SentFriendRequest,
} from '../../api/friends';
import {
  getGroupInvitations,
  getSentJoinRequests,
  type GroupInvitation,
  type SentJoinRequestInfo,
} from '../../api/groups';
import type { ApiClient } from '../../api/client';

/** 四类待通过项的判别式 */
export type PendingKind = 'received-friend' | 'received-group' | 'sent-friend' | 'sent-join';

/** 合并后的统一待通过项（显示 + 动作都以 kind 判别） */
export interface PendingItem {
  /** 稳定唯一 key（kind 前缀 + request_id，避免跨类 request_id 撞车） */
  key: string;
  kind: PendingKind;
  /** 方向：收到的（需处理）/ 发出的（等待对方） */
  direction: 'received' | 'sent';
  /** 主标题：好友类=对方昵称（回退 user_id），群类=群名 */
  name: string;
  /** 头像相对路径（未解析；显示点经 resolveServerAvatarUrl 收口） */
  avatarPath: string | null;
  /** 申请附言（无则 null） */
  message: string | null;
  /** 小字「方向 + 类型」标签（一目了然是什么申请 + 谁发起） */
  label: string;
  /** 排序时间（ISO 字符串；取各类型各自的时间字段） */
  time: string;
  /** 原始数据（动作处理时按 kind 收窄使用） */
  raw: PendingRequest | GroupInvitation | SentFriendRequest | SentJoinRequestInfo;
}

/** 四类原始列表 */
export interface PendingSources {
  friendRequests: PendingRequest[];
  groupInvites: GroupInvitation[];
  sentFriendReqs: SentFriendRequest[];
  sentJoinReqs: SentJoinRequestInfo[];
}

/**
 * 合并四类为单一列表，按时间倒序（新→旧）；时间相等/无效时「收到的」在前。
 */
export function buildPendingItems(sources: PendingSources): PendingItem[] {
  const items: PendingItem[] = [];

  for (const r of sources.friendRequests) {
    items.push({
      key: `rf-${r.request_id}`,
      kind: 'received-friend',
      direction: 'received',
      name: r.requester_nickname ?? r.request_user_id,
      avatarPath: r.requester_avatar_url,
      message: r.request_message,
      label: '向你发起的好友申请',
      time: r.request_time,
      raw: r,
    });
  }
  for (const inv of sources.groupInvites) {
    items.push({
      key: `rg-${inv.request_id}`,
      kind: 'received-group',
      direction: 'received',
      name: inv.group_name,
      avatarPath: inv.group_avatar_url,
      message: inv.message,
      label: `${inv.inviter_nickname} 邀请你加入群聊`,
      time: inv.created_at,
      raw: inv,
    });
  }
  for (const sr of sources.sentFriendReqs) {
    items.push({
      key: `sf-${sr.request_id}`,
      kind: 'sent-friend',
      direction: 'sent',
      name: sr.sent_to_nickname ?? sr.sent_to_user_id,
      avatarPath: sr.sent_to_avatar_url,
      message: sr.sent_message,
      label: '你发出的好友申请',
      time: sr.sent_time,
      raw: sr,
    });
  }
  for (const sj of sources.sentJoinReqs) {
    items.push({
      key: `sj-${sj.request_id}`,
      kind: 'sent-join',
      direction: 'sent',
      name: sj.group_name,
      avatarPath: sj.group_avatar_url,
      message: sj.message,
      label: '你发出的群聊申请',
      time: sj.created_at,
      raw: sj,
    });
  }

  items.sort((a, b) => {
    const ta = Date.parse(a.time);
    const tb = Date.parse(b.time);
    const va = Number.isNaN(ta) ? 0 : ta;
    const vb = Number.isNaN(tb) ? 0 : tb;
    if (vb !== va) {
      return vb - va; // 时间倒序（新→旧）
    }
    if (a.direction !== b.direction) {
      return a.direction === 'received' ? -1 : 1; // 收到的在前
    }
    return 0;
  });

  return items;
}

/**
 * 并行加载四类待通过列表；每类独立 try/catch 降级为空数组（一类失败不拖累其余）。
 * 桌面 PendingRequestsPanel / 移动 MobileAddPage 共用。
 */
export async function loadPendingSources(api: ApiClient): Promise<PendingSources> {
  const [fr, gi, sfr, sjr] = await Promise.all([
    getPendingRequests(api).catch((): PendingRequest[] => []),
    getGroupInvitations(api).then((r) => r.invitations || []).catch((): GroupInvitation[] => []),
    getSentFriendRequests(api).catch((): SentFriendRequest[] => []),
    getSentJoinRequests(api).then((r) => r.requests || []).catch((): SentJoinRequestInfo[] => []),
  ]);
  return {
    friendRequests: Array.isArray(fr) ? fr : [],
    groupInvites: gi,
    sentFriendReqs: Array.isArray(sfr) ? sfr : [],
    sentJoinReqs: sjr,
  };
}
