/**
 * buildPendingItems 纯逻辑测试（req-24 合并待通过列表的核心）
 *
 * 覆盖 SUT（src/components/unified/pendingRequests.ts）真实执行的：
 * - 四类（收到好友申请 / 收到群邀请 / 发出好友申请 / 发出加群申请）合并成单一列表
 * - 按各自时间字段倒序（新→旧）
 * - 每类的 name/avatarPath/message/label/direction/kind 映射（含昵称回退 user_id）
 * - 时间相等/无效时「收到的」在前
 *
 * 断言直接比对 SUT 的输出（非重写 SUT 逻辑），故非 tautology。
 */

import { describe, it, expect } from 'vitest';
import { buildPendingItems } from '../../src/components/unified/pendingRequests';
import type { PendingRequest, SentFriendRequest } from '../../src/api/friends';
import type { GroupInvitation, SentJoinRequestInfo } from '../../src/api/groups';

const friendReq: PendingRequest = {
  request_id: 'fr1',
  request_user_id: 'u_alice',
  request_message: '交个朋友',
  request_time: '2026-01-04T00:00:00Z',
  requester_nickname: 'Alice',
  requester_avatar_url: 'avatars/alice.png',
};

const friendReqNoNick: PendingRequest = {
  request_id: 'fr2',
  request_user_id: 'u_bob',
  request_message: null,
  request_time: '2026-01-01T00:00:00Z',
  requester_nickname: null,
  requester_avatar_url: null,
};

const groupInv: GroupInvitation = {
  request_id: 'gi1',
  group_id: 'g_tech',
  group_name: '技术群',
  group_avatar_url: 'avatars/tech.png',
  inviter_id: 'u_zoe',
  inviter_nickname: 'Zoe',
  inviter_avatar_url: null,
  message: '来玩',
  created_at: '2026-01-03T00:00:00Z',
  expires_at: '2026-02-01T00:00:00Z',
};

const sentFriend: SentFriendRequest = {
  request_id: 'sf1',
  sent_to_user_id: 'u_carol',
  sent_message: null,
  sent_time: '2026-01-02T00:00:00Z',
  sent_to_nickname: 'Carol',
  sent_to_avatar_url: 'avatars/carol.png',
};

const sentJoin: SentJoinRequestInfo = {
  request_id: 'sj1',
  group_id: 'g_game',
  group_name: '游戏群',
  group_avatar_url: null,
  message: '想加入',
  status: 'pending',
  created_at: '2026-01-05T00:00:00Z',
};

describe('buildPendingItems', () => {
  it('四类合并 + 按时间倒序（新→旧）', () => {
    const items = buildPendingItems({
      friendRequests: [friendReq, friendReqNoNick],
      groupInvites: [groupInv],
      sentFriendReqs: [sentFriend],
      sentJoinReqs: [sentJoin],
    });
    // 时间：sj1(01-05) > fr1(01-04) > gi1(01-03) > sf1(01-02) > fr2(01-01)
    expect(items.map((i) => i.key)).toEqual(['sj-sj1', 'rf-fr1', 'rg-gi1', 'sf-sf1', 'rf-fr2']);
  });

  it('收到好友申请 → kind/direction/name/label/avatar/message 映射正确', () => {
    const [item] = buildPendingItems({
      friendRequests: [friendReq],
      groupInvites: [],
      sentFriendReqs: [],
      sentJoinReqs: [],
    });
    expect(item).toMatchObject({
      key: 'rf-fr1',
      kind: 'received-friend',
      direction: 'received',
      name: 'Alice',
      avatarPath: 'avatars/alice.png',
      message: '交个朋友',
      label: '向你发起的好友申请',
      time: '2026-01-04T00:00:00Z',
    });
    expect(item.raw).toBe(friendReq);
  });

  it('收到好友申请无昵称 → name 回退 request_user_id', () => {
    const [item] = buildPendingItems({
      friendRequests: [friendReqNoNick],
      groupInvites: [],
      sentFriendReqs: [],
      sentJoinReqs: [],
    });
    expect(item.name).toBe('u_bob');
    expect(item.avatarPath).toBeNull();
  });

  it('收到群邀请 → label 带邀请人昵称，name 为群名', () => {
    const [item] = buildPendingItems({
      friendRequests: [],
      groupInvites: [groupInv],
      sentFriendReqs: [],
      sentJoinReqs: [],
    });
    expect(item).toMatchObject({
      kind: 'received-group',
      direction: 'received',
      name: '技术群',
      label: 'Zoe 邀请你加入群聊',
      message: '来玩',
    });
  });

  it('发出好友申请 → direction=sent，label 固定「你发出的好友申请」，name 回退 user_id', () => {
    const item = buildPendingItems({
      friendRequests: [],
      groupInvites: [],
      sentFriendReqs: [{ ...sentFriend, sent_to_nickname: null }],
      sentJoinReqs: [],
    })[0];
    expect(item).toMatchObject({
      kind: 'sent-friend',
      direction: 'sent',
      name: 'u_carol',
      label: '你发出的好友申请',
    });
  });

  it('发出加群申请 → direction=sent，label 固定「你发出的群聊申请」，name 为群名', () => {
    const [item] = buildPendingItems({
      friendRequests: [],
      groupInvites: [],
      sentFriendReqs: [],
      sentJoinReqs: [sentJoin],
    });
    expect(item).toMatchObject({
      kind: 'sent-join',
      direction: 'sent',
      name: '游戏群',
      label: '你发出的群聊申请',
      avatarPath: null,
    });
  });

  it('时间相等时「收到的」排在「发出的」之前', () => {
    const sameTime = '2026-01-01T00:00:00Z';
    const items = buildPendingItems({
      friendRequests: [{ ...friendReq, request_time: sameTime }],
      groupInvites: [],
      sentFriendReqs: [{ ...sentFriend, sent_time: sameTime }],
      sentJoinReqs: [],
    });
    expect(items.map((i) => i.direction)).toEqual(['received', 'sent']);
  });

  it('时间字段无效（无法解析）时不抛错，仍返回全部项', () => {
    const items = buildPendingItems({
      friendRequests: [{ ...friendReq, request_time: 'not-a-date' }],
      groupInvites: [],
      sentFriendReqs: [{ ...sentFriend, sent_time: '2026-01-02T00:00:00Z' }],
      sentJoinReqs: [],
    });
    expect(items).toHaveLength(2);
    // 有效时间(sf, 01-02) 视为较新排前；无效时间视为 0（最旧）排后
    expect(items.map((i) => i.key)).toEqual(['sf-sf1', 'rf-fr1']);
  });

  it('全空输入 → 空数组', () => {
    expect(
      buildPendingItems({ friendRequests: [], groupInvites: [], sentFriendReqs: [], sentJoinReqs: [] }),
    ).toEqual([]);
  });
});
