/**
 * 群聊 API 封装单元测试（src/api/groups.ts）
 *
 * 用假 ApiClient（get/post/put/delete 为 vi.fn）验证每个函数：
 *   - 正常：以精确 URL/HTTP 方法/请求体调用 api.*，返回值原样透传；
 *   - 默认参数/归一化分支：message||''、reason||''、nickname||null、options||{} 等
 *     必须反映在实际请求体上（默认值被改会失败）；
 *   - 异常：api 抛错时函数原样向上抛（薄封装不 try/catch 不兜底）。
 *
 * 覆盖 26 个函数；message-blocks / special-care / member-remarks 三组共 9 个函数
 * 已由 tests/unit/groupMessageBlocks.test.ts 等覆盖，此处不重复。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApiClient } from '../../src/api/client';
import * as groups from '../../src/api/groups';

// uploadGroupAvatar 不走 ApiClient 方法，而是直接调 ./upload 的 uploadWithProgress，
// 用模块级 mock 拦截并断言其入参（baseUrl 拼接 / token / file / fieldName / onProgress）。
const uploadWithProgressMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/api/upload', () => ({
  uploadWithProgress: uploadWithProgressMock,
}));

function makeApi() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    getBaseUrl: vi.fn(() => 'https://api.example.cn'),
    getAccessToken: vi.fn(() => 'tok-1'),
    refreshAccessToken: vi.fn(),
  } as unknown as ApiClient & {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
}

type Api = ReturnType<typeof makeApi>;

describe('群聊 API 封装 (api/groups)', () => {
  let api: Api;

  beforeEach(() => {
    api = makeApi();
    uploadWithProgressMock.mockReset();
  });

  // ---- 群列表 / 创建 / 详情类 ----

  it('getMyGroups 正常：GET /api/groups/my，返回数组透传', async () => {
    const list = [{ group_id: 'g1', group_name: '群一' }];
    api.get.mockResolvedValue(list);
    const out = await groups.getMyGroups(api);
    expect(api.get).toHaveBeenCalledWith('/api/groups/my');
    expect(out).toEqual(list);
  });

  it('createGroup 正常：POST /api/groups，body 原样透传，返回透传', async () => {
    const created = { group_id: 'g9', group_name: '新群', created_at: '2026-07-17T00:00:00Z' };
    api.post.mockResolvedValue(created);
    const data = {
      group_name: '新群',
      group_description: '描述',
      join_mode: 'approval_required' as const,
    };
    const out = await groups.createGroup(api, data);
    expect(api.post).toHaveBeenCalledWith('/api/groups', data);
    expect(out).toEqual(created);
  });

  it('getGroupMembers 正常：GET members', async () => {
    api.get.mockResolvedValue({ members: [], total: 0 });
    const out = await groups.getGroupMembers(api, 'g1');
    expect(api.get).toHaveBeenCalledWith('/api/groups/g1/members');
    expect(out).toEqual({ members: [], total: 0 });
  });

  it('getGroupReadPositions 正常：GET read-positions，返回透传', async () => {
    const resp = { positions: [{ user_id: 'u1', last_read_seq: 5 }], member_count: 3 };
    api.get.mockResolvedValue(resp);
    const out = await groups.getGroupReadPositions(api, 'g1');
    expect(api.get).toHaveBeenCalledWith('/api/groups/g1/read-positions');
    expect(out).toEqual(resp);
  });

  it('updateGroup 正常：PUT /api/groups/{id}，body 原样透传', async () => {
    api.put.mockResolvedValue({ success: true });
    const data = { group_name: '改名', group_description: '新描述', group_avatar_url: '/a.png' };
    const out = await groups.updateGroup(api, 'g1', data);
    expect(api.put).toHaveBeenCalledWith('/api/groups/g1', data);
    expect(out).toEqual({ success: true });
  });

  // ---- 邀请 / 昵称 / 退群（含默认值归一化分支）----

  it('inviteToGroup 正常：带 message 时原样传', async () => {
    api.post.mockResolvedValue({ success: true });
    await groups.inviteToGroup(api, 'g1', ['u2', 'u3'], '来玩');
    expect(api.post).toHaveBeenCalledWith('/api/groups/g1/invite', {
      user_ids: ['u2', 'u3'],
      message: '来玩',
    });
  });

  it('inviteToGroup 默认：省略 message 时归一化为空字符串', async () => {
    api.post.mockResolvedValue({ success: true });
    await groups.inviteToGroup(api, 'g1', ['u2']);
    expect(api.post).toHaveBeenCalledWith('/api/groups/g1/invite', {
      user_ids: ['u2'],
      message: '',
    });
  });

  it('updateGroupNickname 正常：非空字符串昵称原样传', async () => {
    api.put.mockResolvedValue({ success: true, message: 'ok' });
    const out = await groups.updateGroupNickname(api, 'g1', '小明');
    expect(api.put).toHaveBeenCalledWith('/api/groups/g1/nickname', { nickname: '小明' });
    expect(out).toEqual({ success: true, message: 'ok' });
  });

  it("updateGroupNickname 归一化：'' 传给后端为 null（清除昵称）", async () => {
    api.put.mockResolvedValue({ success: true, message: 'cleared' });
    await groups.updateGroupNickname(api, 'g1', '');
    expect(api.put).toHaveBeenCalledWith('/api/groups/g1/nickname', { nickname: null });
  });

  it('updateGroupNickname 归一化：null 保持 null', async () => {
    api.put.mockResolvedValue({ success: true, message: 'cleared' });
    await groups.updateGroupNickname(api, 'g1', null);
    expect(api.put).toHaveBeenCalledWith('/api/groups/g1/nickname', { nickname: null });
  });

  it('leaveGroup 正常：带 reason 时原样传', async () => {
    api.post.mockResolvedValue({ success: true, message: 'left' });
    const out = await groups.leaveGroup(api, 'g1', '太吵了');
    expect(api.post).toHaveBeenCalledWith('/api/groups/g1/leave', { reason: '太吵了' });
    expect(out).toEqual({ success: true, message: 'left' });
  });

  it('leaveGroup 默认：省略 reason 时归一化为空字符串', async () => {
    api.post.mockResolvedValue({ success: true, message: 'left' });
    await groups.leaveGroup(api, 'g1');
    expect(api.post).toHaveBeenCalledWith('/api/groups/g1/leave', { reason: '' });
  });

  // ---- 群邀请（收到的）----

  it('getGroupInvitations 正常：GET /api/groups/invitations，返回透传', async () => {
    const resp = { invitations: [{ request_id: 'r1' }] };
    api.get.mockResolvedValue(resp);
    const out = await groups.getGroupInvitations(api);
    expect(api.get).toHaveBeenCalledWith('/api/groups/invitations');
    expect(out).toEqual(resp);
  });

  it('acceptGroupInvitation 正常：POST accept 且不带 body（api.post 仅收到 path 一个参数）', async () => {
    api.post.mockResolvedValue({ success: true, message: 'joined' });
    const out = await groups.acceptGroupInvitation(api, 'r1');
    // toHaveBeenCalledWith 按参数个数精确匹配：源码 api.post(path) 不传第二参
    expect(api.post).toHaveBeenCalledWith('/api/groups/invitations/r1/accept');
    expect(out).toEqual({ success: true, message: 'joined' });
  });

  it('declineGroupInvitation 正常：POST decline 且不带 body', async () => {
    api.post.mockResolvedValue({ success: true });
    await groups.declineGroupInvitation(api, 'r1');
    expect(api.post).toHaveBeenCalledWith('/api/groups/invitations/r1/decline');
  });

  it('joinGroupByCode 正常：POST join_by_code，body 为 {code}', async () => {
    api.post.mockResolvedValue({ success: true, message: 'joined' });
    const out = await groups.joinGroupByCode(api, 'ABC123');
    expect(api.post).toHaveBeenCalledWith('/api/groups/join_by_code', { code: 'ABC123' });
    expect(out).toEqual({ success: true, message: 'joined' });
  });

  // ---- 群头像上传（经 uploadWithProgress，不走 api.get/post）----

  it('uploadGroupAvatar 正常：拼 baseUrl+路径，透传 token/file/字段名/进度回调，返回透传', async () => {
    const resp = { success: true, data: { avatar_url: '/avatars/g1.png' } };
    uploadWithProgressMock.mockResolvedValue(resp);
    const file = new File(['x'], 'avatar.png', { type: 'image/png' });
    const onProgress = vi.fn();

    const out = await groups.uploadGroupAvatar(api, 'g1', file, onProgress);

    expect(uploadWithProgressMock).toHaveBeenCalledWith(
      'https://api.example.cn/api/groups/g1/avatar',
      'tok-1',
      file,
      'avatar',
      onProgress,
    );
    expect(out).toEqual(resp);
  });

  it('uploadGroupAvatar 异常：uploadWithProgress 抛错时原样向上抛', async () => {
    uploadWithProgressMock.mockRejectedValue(new Error('upload-fail'));
    const file = new File(['x'], 'avatar.png', { type: 'image/png' });
    await expect(groups.uploadGroupAvatar(api, 'g1', file)).rejects.toThrow('upload-fail');
  });

  // ---- 成员管理 ----

  it('setAdmin 正常：POST admins，body {user_id}', async () => {
    api.post.mockResolvedValue({ success: true, message: 'ok' });
    await groups.setAdmin(api, 'g1', 'u2');
    expect(api.post).toHaveBeenCalledWith('/api/groups/g1/admins', { user_id: 'u2' });
  });

  it('transferOwner 正常：POST transfer，body {new_owner_id}', async () => {
    api.post.mockResolvedValue({ success: true, message: 'ok' });
    const out = await groups.transferOwner(api, 'g1', 'u2');
    expect(api.post).toHaveBeenCalledWith('/api/groups/g1/transfer', { new_owner_id: 'u2' });
    expect(out).toEqual({ success: true, message: 'ok' });
  });

  it('muteMember 正常：POST mute，body {user_id, duration_minutes}，返回透传', async () => {
    const resp = { success: true, message: 'muted', muted_until: '2026-07-18T00:00:00Z' };
    api.post.mockResolvedValue(resp);
    const out = await groups.muteMember(api, 'g1', 'u2', 30);
    expect(api.post).toHaveBeenCalledWith('/api/groups/g1/mute', {
      user_id: 'u2',
      duration_minutes: 30,
    });
    expect(out).toEqual(resp);
  });

  // ---- DELETE 形态（同形函数，it.each 收敛；URL 逐函数精确断言）----

  const DELETE_CASES: ReadonlyArray<[string, (a: Api) => Promise<unknown>, string]> = [
    ['removeMember', (a) => groups.removeMember(a, 'g1', 'u2'), '/api/groups/g1/members/u2'],
    ['removeAdmin', (a) => groups.removeAdmin(a, 'g1', 'u2'), '/api/groups/g1/admins/u2'],
    ['unmuteMember', (a) => groups.unmuteMember(a, 'g1', 'u2'), '/api/groups/g1/mute/u2'],
    ['disbandGroup', (a) => groups.disbandGroup(a, 'g1'), '/api/groups/g1'],
    ['deleteGroupNotice', (a) => groups.deleteGroupNotice(a, 'g1', 'n1'), '/api/groups/g1/notices/n1'],
    ['revokeInviteCode', (a) => groups.revokeInviteCode(a, 'g1', 'c1'), '/api/groups/g1/invite_codes/c1'],
  ];

  it.each(DELETE_CASES)('%s 正常：DELETE URL 精确匹配 + 返回透传', async (_name, invoke, expectedUrl) => {
    api.delete.mockResolvedValue({ success: true });
    const out = await invoke(api);
    expect(api.delete).toHaveBeenCalledWith(expectedUrl);
    expect(out).toEqual({ success: true });
  });

  // ---- 群公告 ----

  it('getGroupNotices 正常：GET notices，返回透传', async () => {
    const resp = { notices: [{ id: 'n1', title: '公告' }] };
    api.get.mockResolvedValue(resp);
    const out = await groups.getGroupNotices(api, 'g1');
    expect(api.get).toHaveBeenCalledWith('/api/groups/g1/notices');
    expect(out).toEqual(resp);
  });

  it('createGroupNotice 正常：POST notices，body 原样透传（含 is_pinned）', async () => {
    const resp = { success: true, data: { id: 'n1', published_at: '2026-07-17T00:00:00Z' } };
    api.post.mockResolvedValue(resp);
    const data = { title: '置顶公告', content: '内容', is_pinned: true };
    const out = await groups.createGroupNotice(api, 'g1', data);
    expect(api.post).toHaveBeenCalledWith('/api/groups/g1/notices', data);
    expect(out).toEqual(resp);
  });

  // ---- 邀请码管理 ----
  // ⚠️ 契约点：邀请码路由是下划线 invite_codes（非连字符 invite-codes），易回归，此处精确断言。

  it('generateInviteCode 正常：POST invite_codes，options 原样透传，返回透传', async () => {
    const resp = { id: 'c1', code: 'XYZ', code_type: 'direct', expires_at: '2026-07-18T00:00:00Z' };
    api.post.mockResolvedValue(resp);
    const options = { max_uses: 10, expires_in_hours: 24 };
    const out = await groups.generateInviteCode(api, 'g1', options);
    expect(api.post).toHaveBeenCalledWith('/api/groups/g1/invite_codes', options);
    expect(out).toEqual(resp);
  });

  it('generateInviteCode 默认：省略 options 时 body 归一化为空对象', async () => {
    api.post.mockResolvedValue({ id: 'c2', code: 'ABC', code_type: 'normal', expires_at: '' });
    await groups.generateInviteCode(api, 'g1');
    expect(api.post).toHaveBeenCalledWith('/api/groups/g1/invite_codes', {});
  });

  it('getInviteCodes 正常：GET invite_codes，返回透传', async () => {
    const resp = { codes: [{ id: 'c1', code: 'XYZ' }] };
    api.get.mockResolvedValue(resp);
    const out = await groups.getInviteCodes(api, 'g1');
    expect(api.get).toHaveBeenCalledWith('/api/groups/g1/invite_codes');
    expect(out).toEqual(resp);
  });

  // ---- 异常路径：api 抛错时原样向上抛（薄封装无 try/catch 兜底）----
  // 同形错误透传用 it.each 收敛；四个 HTTP 方法一并 mockRejectedValue，
  // 函数走哪个方法就命中哪个 mock。

  const ERROR_CASES: ReadonlyArray<[string, (a: Api) => Promise<unknown>]> = [
    ['getMyGroups', (a) => groups.getMyGroups(a)],
    ['createGroup', (a) => groups.createGroup(a, { group_name: 'x' })],
    ['getGroupMembers', (a) => groups.getGroupMembers(a, 'g1')],
    ['getGroupReadPositions', (a) => groups.getGroupReadPositions(a, 'g1')],
    ['updateGroup', (a) => groups.updateGroup(a, 'g1', { group_name: 'x' })],
    ['inviteToGroup', (a) => groups.inviteToGroup(a, 'g1', ['u2'])],
    ['updateGroupNickname', (a) => groups.updateGroupNickname(a, 'g1', 'x')],
    ['leaveGroup', (a) => groups.leaveGroup(a, 'g1')],
    ['getGroupInvitations', (a) => groups.getGroupInvitations(a)],
    ['acceptGroupInvitation', (a) => groups.acceptGroupInvitation(a, 'r1')],
    ['declineGroupInvitation', (a) => groups.declineGroupInvitation(a, 'r1')],
    ['joinGroupByCode', (a) => groups.joinGroupByCode(a, 'ABC')],
    ['removeMember', (a) => groups.removeMember(a, 'g1', 'u2')],
    ['setAdmin', (a) => groups.setAdmin(a, 'g1', 'u2')],
    ['removeAdmin', (a) => groups.removeAdmin(a, 'g1', 'u2')],
    ['transferOwner', (a) => groups.transferOwner(a, 'g1', 'u2')],
    ['muteMember', (a) => groups.muteMember(a, 'g1', 'u2', 10)],
    ['unmuteMember', (a) => groups.unmuteMember(a, 'g1', 'u2')],
    ['disbandGroup', (a) => groups.disbandGroup(a, 'g1')],
    ['getGroupNotices', (a) => groups.getGroupNotices(a, 'g1')],
    ['createGroupNotice', (a) => groups.createGroupNotice(a, 'g1', { title: 't', content: 'c' })],
    ['deleteGroupNotice', (a) => groups.deleteGroupNotice(a, 'g1', 'n1')],
    ['generateInviteCode', (a) => groups.generateInviteCode(a, 'g1')],
    ['getInviteCodes', (a) => groups.getInviteCodes(a, 'g1')],
    ['revokeInviteCode', (a) => groups.revokeInviteCode(a, 'g1', 'c1')],
  ];

  it.each(ERROR_CASES)('%s 异常：api 抛错时原样向上抛', async (_name, invoke) => {
    const err = new Error('boom');
    api.get.mockRejectedValue(err);
    api.post.mockRejectedValue(err);
    api.put.mockRejectedValue(err);
    api.delete.mockRejectedValue(err);
    await expect(invoke(api)).rejects.toThrow('boom');
  });
});
