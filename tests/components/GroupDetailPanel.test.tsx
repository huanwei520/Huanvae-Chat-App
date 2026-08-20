/**
 * GroupDetailPanel 测试（群详情面板：多态主按钮 进入/加入/申请/待通过）
 *
 * mock：
 * - api/groups 的 getPublicGroupInfo / applyToJoinGroup / getSentJoinRequests（hoisted）
 * - useApi 返回稳定单例 mockApi
 * - resolveServerAvatarUrl 哨兵（本组件 info.group_avatar_url 为 null，仅避开真实 secureProxy/tauri）
 * - 成员身份读真实 useChatStore（用 setState 注入 groups）
 *
 * ## 本文件守的两条判据是**分开**的（这正是 2026-08-17 契约迁移改掉的东西）
 *
 * | 判据 | 由谁决定 | 影响什么 |
 * |------|---------|---------|
 * | 按钮显示「加入群聊」还是「申请加群」 | `info.join_approval_required`（**预判**） | 点之前的文案 |
 * | 点完之后刷新群列表还是翻「待通过」 | `apply` 响应的 `status`（**真实结果**） | 点之后的状态 |
 *
 * 旧实现两处都读 `info` 里那个已被后端删除的五档字段，于是字段变 `undefined` 后
 * **每个群都掉进"不可加入"死点分支**（界面正常、不报错、不崩 ⇒ 没有任何地方会告诉你它坏了）。
 *
 * 🔴 两处都必须是"保守方向"的写法，本文件各配一条 `undefined` 用例钉死：
 * - 预判写 `=== false`（不是 `!x`）：不知道时给「申请加群」，用户仍能点；
 * - 结果写 `=== 'joined'`（不是 `!== 'pending'`）：不知道时落 pending，不会把没入群的说成已入群。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

const mockApi = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('../../src/contexts/SessionContext', () => ({ useApi: () => mockApi }));

const groupsApiMock = vi.hoisted(() => ({
  getPublicGroupInfo: vi.fn(),
  applyToJoinGroup: vi.fn(),
  getSentJoinRequests: vi.fn(),
}));
vi.mock('../../src/api/groups', () => groupsApiMock);

vi.mock('../../src/utils/avatar', () => ({
  resolveServerAvatarUrl: (p: string | null | undefined) => (p ? `proxied://${p}` : null),
}));

import { GroupDetailPanel } from '../../src/chat/shared/GroupDetailPanel';
import { useChatStore } from '../../src/stores';

function groupInfo(overrides: Record<string, unknown> = {}) {
  return {
    group_id: 'grp1',
    group_name: '测试群',
    group_avatar_url: null,
    group_description: null,
    creator_id: 'owner1',
    created_at: '2026-01-01T00:00:00Z',
    join_approval_required: false,
    status: 'active',
    member_count: 10,
    ...overrides,
  };
}

/**
 * 审批开关**整个键都不存在**的响应 —— 后端整批上线前的真实形态。
 * 不能用 `{ join_approval_required: undefined }` 代替：那样 `'x' in obj` 仍为真，
 * 与真实的"没有这个键"不同形，测不到 JSON 里压根没有该字段的那条路径。
 */
function groupInfoWithoutPolicy(overrides: Record<string, unknown> = {}) {
  const base = groupInfo(overrides) as Record<string, unknown>;
  delete base.join_approval_required;
  return base;
}

/** 面板里当前那个主按钮的文案（操作区只渲染一个 AppButton primary） */
async function mainButton(name: string) {
  return screen.findByRole('button', { name });
}

describe('GroupDetailPanel', () => {
  beforeEach(() => {
    cleanup();
    Object.values(groupsApiMock).forEach((m) => m.mockReset());
    groupsApiMock.getSentJoinRequests.mockResolvedValue({ requests: [] });
    // 中性默认：落待审申请。需要"直接入群"的用例各自覆写成 status:'joined'
    groupsApiMock.applyToJoinGroup.mockResolvedValue({ status: 'pending', message: 'ok' });
    useChatStore.setState({ groups: [] });
  });

  // ---------------- 按钮预判：读 info.join_approval_required ----------------

  describe('主按钮文案（预判，读 join_approval_required）', () => {
    it('非成员 + join_approval_required=false（免审核）→「加入群聊」', async () => {
      groupsApiMock.getPublicGroupInfo.mockResolvedValue(
        groupInfo({ group_id: 'grp1', join_approval_required: false }),
      );
      render(<GroupDetailPanel groupId="grp1" onClose={vi.fn()} />);

      expect(await mainButton('加入群聊')).toBeEnabled();
      expect(screen.queryByRole('button', { name: '申请加群' })).toBeNull();
    });

    it('非成员 + join_approval_required=true（需审核）→「申请加群」', async () => {
      groupsApiMock.getPublicGroupInfo.mockResolvedValue(
        groupInfo({ group_id: 'grp2', join_approval_required: true }),
      );
      render(<GroupDetailPanel groupId="grp2" onClose={vi.fn()} />);

      expect(await mainButton('申请加群')).toBeEnabled();
      expect(screen.queryByRole('button', { name: '加入群聊' })).toBeNull();
    });

    it('🔴 非成员 + 字段缺失（undefined）→「申请加群」，且面板里【任何地方】都不出现「不可加入」', async () => {
      groupsApiMock.getPublicGroupInfo.mockResolvedValue(groupInfoWithoutPolicy({ group_id: 'grp3' }));
      render(<GroupDetailPanel groupId="grp3" onClose={vi.fn()} />);

      // 保守方向：不知道要不要审核时仍然让用户能点（写成 `!info.x` 会误判成免审核 ⇒「加入群聊」）
      const btn = await mainButton('申请加群');
      expect(btn).toBeEnabled();
      expect(screen.queryByRole('button', { name: '加入群聊' })).toBeNull();

      // 🔴 反向断言：那个死点分支被整块删掉了，**任何情况下**都不该再出现。
      // 只断言"等于申请加群"不够 —— 它挡不住有人把 else 分支加回来后再多渲染一个禁用按钮。
      expect(screen.queryByRole('button', { name: '不可加入' })).toBeNull();
      expect(screen.queryByText('不可加入')).toBeNull();
      expect(document.body.textContent).not.toContain('不可加入');
    });

    it('已加入（chatStore.groups 含该群）：按钮「进入群聊」，点击回调 onEnterGroup + onClose', async () => {
      useChatStore.setState({
        groups: [
          {
            group_id: 'grp4',
            group_name: '我的群',
            group_avatar_url: '',
            role: 'member',
            unread_count: 0,
            last_message_content: null,
            last_message_time: null,
          },
        ],
      });
      groupsApiMock.getPublicGroupInfo.mockResolvedValue(groupInfo({ group_id: 'grp4' }));
      const onEnterGroup = vi.fn();
      const onClose = vi.fn();
      render(<GroupDetailPanel groupId="grp4" onClose={onClose} onEnterGroup={onEnterGroup} />);

      fireEvent.click(await mainButton('进入群聊'));

      expect(onEnterGroup).toHaveBeenCalledTimes(1);
      expect(onEnterGroup.mock.calls[0][0]).toMatchObject({ group_id: 'grp4', role: 'member' });
      expect(onClose).toHaveBeenCalledTimes(1);
      // 已加入不查询「我发出的加群申请」
      expect(groupsApiMock.getSentJoinRequests).not.toHaveBeenCalled();
    });

    it('未加入但「我发出的」已含该群：按钮「待通过」禁用，且不触发 applyToJoinGroup', async () => {
      // 免审核本应显示「加入群聊」；已有 pending 申请必须把它翻成「待通过」
      groupsApiMock.getPublicGroupInfo.mockResolvedValue(
        groupInfo({ group_id: 'grp5', join_approval_required: false }),
      );
      groupsApiMock.getSentJoinRequests.mockResolvedValue({
        requests: [
          {
            request_id: 'sj1',
            group_id: 'grp5',
            group_name: '测试群',
            group_avatar_url: null,
            message: null,
            status: 'pending',
            created_at: '2026-01-01T00:00:00Z',
          },
        ],
      });
      render(<GroupDetailPanel groupId="grp5" onClose={vi.fn()} />);

      const pendingBtn = await mainButton('待通过');
      expect(pendingBtn).toBeDisabled();
      expect(screen.queryByRole('button', { name: '加入群聊' })).toBeNull();
      expect(groupsApiMock.applyToJoinGroup).not.toHaveBeenCalled();
    });
  });

  // ---------------- 点完之后：读 apply 响应的 status，不是读 info ----------------

  describe('apply 之后的分流（读响应 status，不是预判）', () => {
    it("status:'joined' → 刷新群列表（不翻「待通过」）", async () => {
      groupsApiMock.getPublicGroupInfo.mockResolvedValue(
        groupInfo({ group_id: 'grp6', join_approval_required: false }),
      );
      groupsApiMock.applyToJoinGroup.mockResolvedValue({ status: 'joined', message: '已成功加入群聊' });
      const onRefreshGroups = vi.fn();
      render(<GroupDetailPanel groupId="grp6" onClose={vi.fn()} onRefreshGroups={onRefreshGroups} />);

      fireEvent.click(await mainButton('加入群聊'));

      await waitFor(() =>
        expect(groupsApiMock.applyToJoinGroup).toHaveBeenCalledWith(mockApi, 'grp6'),
      );
      await waitFor(() => expect(onRefreshGroups).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('button', { name: '待通过' })).toBeNull();
    });

    it("status:'pending' → 翻「待通过」禁用（不刷新群列表）", async () => {
      groupsApiMock.getPublicGroupInfo.mockResolvedValue(
        groupInfo({ group_id: 'grp7', join_approval_required: true }),
      );
      groupsApiMock.applyToJoinGroup.mockResolvedValue({
        status: 'pending',
        message: '申请已提交，等待管理员审核',
      });
      const onRefreshGroups = vi.fn();
      render(<GroupDetailPanel groupId="grp7" onClose={vi.fn()} onRefreshGroups={onRefreshGroups} />);

      fireEvent.click(await mainButton('申请加群'));

      const pendingBtn = await mainButton('待通过');
      expect(pendingBtn).toBeDisabled();
      expect(onRefreshGroups).not.toHaveBeenCalled();
    });

    it('🔴 status 整个键缺失（后端未上线窗口期）→ 走 pending 分支，不当成已入群', async () => {
      groupsApiMock.getPublicGroupInfo.mockResolvedValue(
        groupInfo({ group_id: 'grp8', join_approval_required: false }),
      );
      // 旧响应形态：只有 message，没有 status
      groupsApiMock.applyToJoinGroup.mockResolvedValue({ message: 'ok' });
      const onRefreshGroups = vi.fn();
      render(<GroupDetailPanel groupId="grp8" onClose={vi.fn()} onRefreshGroups={onRefreshGroups} />);

      fireEvent.click(await mainButton('加入群聊'));

      // 保守：落 pending。写成 `res.status !== 'pending'` 的话这里会刷新群列表，
      // 而用户其实**没有**入群 ⇒ 群列表里找不到它，按钮却已经翻成"已加入"语义。
      const pendingBtn = await mainButton('待通过');
      expect(pendingBtn).toBeDisabled();
      expect(onRefreshGroups).not.toHaveBeenCalled();
    });

    it('apply 抛错 → 显示错误文案，不翻「待通过」也不刷新', async () => {
      groupsApiMock.getPublicGroupInfo.mockResolvedValue(
        groupInfo({ group_id: 'grp9', join_approval_required: true }),
      );
      groupsApiMock.applyToJoinGroup.mockRejectedValue(new Error('已是该群成员'));
      const onRefreshGroups = vi.fn();
      render(<GroupDetailPanel groupId="grp9" onClose={vi.fn()} onRefreshGroups={onRefreshGroups} />);

      fireEvent.click(await mainButton('申请加群'));

      await waitFor(() => expect(screen.getByText('已是该群成员')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: '待通过' })).toBeNull();
      expect(onRefreshGroups).not.toHaveBeenCalled();
    });
  });

  // ---------------- 资料区「入群方式」两态文案 ----------------

  describe('「入群方式」资料行（两态 + 未知不渲染）', () => {
    it('false → 「允许直接加入」', async () => {
      groupsApiMock.getPublicGroupInfo.mockResolvedValue(
        groupInfo({ group_id: 'grpA', join_approval_required: false }),
      );
      render(<GroupDetailPanel groupId="grpA" onClose={vi.fn()} />);

      expect(await screen.findByText('允许直接加入')).toBeInTheDocument();
      expect(screen.queryByText('需审批')).toBeNull();
    });

    it('true → 「需审批」', async () => {
      groupsApiMock.getPublicGroupInfo.mockResolvedValue(
        groupInfo({ group_id: 'grpB', join_approval_required: true }),
      );
      render(<GroupDetailPanel groupId="grpB" onClose={vi.fn()} />);

      expect(await screen.findByText('需审批')).toBeInTheDocument();
      expect(screen.queryByText('允许直接加入')).toBeNull();
    });

    it('字段缺失 → 整行不渲染（不猜一个值显示给用户）', async () => {
      groupsApiMock.getPublicGroupInfo.mockResolvedValue(groupInfoWithoutPolicy({ group_id: 'grpC' }));
      render(<GroupDetailPanel groupId="grpC" onClose={vi.fn()} />);

      // 等资料区渲染出来（成员数那行一定在），再断言"入群方式"整行不存在
      expect(await screen.findByText('成员数')).toBeInTheDocument();
      expect(screen.queryByText('入群方式')).toBeNull();
      expect(screen.queryByText('需审批')).toBeNull();
      expect(screen.queryByText('允许直接加入')).toBeNull();
    });
  });
});
