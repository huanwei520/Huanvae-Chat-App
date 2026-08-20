/**
 * JoinPolicyForm 测试（群设置面板「入群与可见性」视图，仅群主）
 *
 * ## 这里**不** mock `src/api/groups`
 *
 * 只把 `useApi()` 换成一个 `get/put` 是 vi.fn 的假客户端，`getGroupDetail` /
 * `updateJoinPolicy` 走**真实实现** ⇒ 断言落在真正发出去的 URL 与 body 上。
 * 若 mock 掉 api 层，"只发被改的那一个键"这条就变成在断言测试自己写的 mock 调用参数，
 * 而真实的 body 构造（那才是会出错的地方）一行都没被覆盖。
 *
 * ## 每组用例防的是哪一种写错法
 *
 * | 用例 | 防的写错法 |
 * |------|-----------|
 * | 打 `/api/groups/{id}`（反向断言不含 `/public`） | 图省事复用 `getPublicGroupInfo` ⇒ 设置面板读的是无成员门控的公开信息 |
 * | 后端缺字段时按 `JOIN_POLICY_DEFAULTS` 显示 | 缺字段时渲染成 `undefined` ⇒ 开关变成"未选中"，用户以为审核是关着的 |
 * | 改一项 ⇒ 恰好一次 PUT，body 只含那一个键 | 把当前显示的五值整体 PUT 出去 ⇒ 用户改一项，另外四项被本地默认值覆写到服务端 |
 * | 响应五值**整体**回填 | 只回填自己改的那一项 ⇒ 服务端同时调整的其它项在 UI 上不显示，下一次改动又把旧值发回去 |
 * | 在途期间 UI 不变（不乐观更新） | 先切 UI 再发请求 ⇒ 失败后 UI 停在"已生效"的样子，用户以为设置成了 |
 * | 400 / 403 / 404 / 网络失败四种文案互不相同 | 合成一句「操作失败」⇒ 用户对着"你不是群主"这种改不了的事一直重试 |
 * | GET 的 403 与 PUT 的 403 文案不同 | 两个端点共用一张错误映射 ⇒ 同一状态码在两件不同的事上说同一句话，其中必有一句是错的 |
 * | `search_scope` 的 `owner_only` 标签含「别人搜不到」 | 照抄成员版文案 ⇒ 方向写反（这一档的动作方是群外的人），用户把"别人搜不到"读成"只有群主能搜别人" |
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';

const mockApi = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));
vi.mock('../../src/contexts/SessionContext', () => ({ useApi: () => mockApi }));

import {
  JoinPolicyForm,
  applyJoinPolicyDefaults,
  describeJoinPolicyUpdateError,
  describeGroupDetailError,
} from '../../src/chat/shared/menu/JoinPolicyForm';
import { ApiError } from '../../src/api/client';
import { JOIN_POLICY_DEFAULTS, type JoinPolicy } from '../../src/api/groups';

/** `GET /api/groups/{id}` 的最小响应；不传入群策略字段 ⇒ 走默认回落 */
function groupDetail(overrides: Record<string, unknown> = {}) {
  return {
    group_id: 'g1',
    group_name: '测试群',
    group_avatar_url: null,
    group_description: null,
    creator_id: 'owner1',
    created_at: '2026-01-01T00:00:00Z',
    status: 'active',
    member_count: 3,
    ...overrides,
  };
}

const ALL_FIVE_KEYS = [
  'join_approval_required',
  'admin_can_approve',
  'card_share_scope',
  'qr_show_scope',
  'search_scope',
] as const;

function renderForm(onBack = vi.fn()) {
  render(<JoinPolicyForm groupId="g1" onBack={onBack} />);
  return { onBack };
}

/** 等首屏加载完（两个开关都在） */
async function waitLoaded() {
  await waitFor(() => expect(screen.getByLabelText('需要入群审核')).toBeInTheDocument());
}

function approvalCheckbox(): HTMLInputElement {
  return screen.getByLabelText('需要入群审核') as HTMLInputElement;
}

function adminApproveCheckbox(): HTMLInputElement {
  return screen.getByLabelText('允许管理员参与审核') as HTMLInputElement;
}

/** 取某一组三档里当前 aria-pressed=true 的那个按钮的文案 */
function pickedLabel(groupLabel: string): string {
  const group = screen.getByRole('group', { name: groupLabel });
  const pressed = within(group)
    .getAllByRole('button')
    .filter((b) => b.getAttribute('aria-pressed') === 'true');
  expect(pressed).toHaveLength(1);
  return pressed[0].textContent ?? '';
}

function clickScope(groupLabel: string, optionLabel: string) {
  const group = screen.getByRole('group', { name: groupLabel });
  fireEvent.click(within(group).getByRole('button', { name: optionLabel }));
}

describe('JoinPolicyForm', () => {
  beforeEach(() => {
    cleanup();
    mockApi.get.mockReset();
    mockApi.put.mockReset();
  });

  // ---------------- 加载 ----------------

  describe('加载当前值', () => {
    it('打 /api/groups/{id} 本体，不是 /public', async () => {
      mockApi.get.mockResolvedValue(groupDetail());
      renderForm();
      await waitLoaded();

      expect(mockApi.get).toHaveBeenCalledWith('/api/groups/g1');
      expect(mockApi.get).not.toHaveBeenCalledWith('/api/groups/g1/public');
      expect(String(mockApi.get.mock.calls[0][0])).not.toContain('/public');
    });

    it('渲染两个开关 + 三组三档（每组三个选项、恰好一个选中）', async () => {
      mockApi.get.mockResolvedValue(groupDetail());
      renderForm();
      await waitLoaded();

      expect(adminApproveCheckbox()).toBeInTheDocument();

      for (const label of ['谁能分享群名片', '谁能展示群二维码', '谁搜得到这个群']) {
        const group = screen.getByRole('group', { name: label });
        expect(within(group).getAllByRole('button')).toHaveLength(3);
        expect(
          within(group)
            .getAllByRole('button')
            .filter((b) => b.getAttribute('aria-pressed') === 'true'),
        ).toHaveLength(1);
      }
    });

    it('后端未返回这五个字段时，按 JOIN_POLICY_DEFAULTS 显示（不是显示成未选中）', async () => {
      mockApi.get.mockResolvedValue(groupDetail());
      renderForm();
      await waitLoaded();

      expect(approvalCheckbox().checked).toBe(JOIN_POLICY_DEFAULTS.join_approval_required);
      expect(adminApproveCheckbox().checked).toBe(JOIN_POLICY_DEFAULTS.admin_can_approve);
      // 默认三档均 all_members
      expect(pickedLabel('谁能分享群名片')).toBe('全体成员');
      expect(pickedLabel('谁能展示群二维码')).toBe('全体成员');
      expect(pickedLabel('谁搜得到这个群')).toBe('任何人');
    });

    it('后端返回了字段时以返回值为准（默认值不许盖掉真值）', async () => {
      mockApi.get.mockResolvedValue(
        groupDetail({
          join_approval_required: false,
          admin_can_approve: false,
          card_share_scope: 'owner_only',
          qr_show_scope: 'admins',
          search_scope: 'owner_only',
        }),
      );
      renderForm();
      await waitLoaded();

      expect(approvalCheckbox().checked).toBe(false);
      expect(adminApproveCheckbox().checked).toBe(false);
      expect(pickedLabel('谁能分享群名片')).toBe('仅群主');
      expect(pickedLabel('谁能展示群二维码')).toBe('群主和管理员');
      expect(pickedLabel('谁搜得到这个群')).toBe('仅群主（别人搜不到）');
    });

    it('加载失败（403）给的是「不是本群成员」，与 PUT 的 403 文案不同', async () => {
      mockApi.get.mockRejectedValue(new ApiError(403, 'forbidden'));
      renderForm();

      await waitFor(() =>
        expect(screen.getByText('你已不是本群成员，无法查看群设置')).toBeInTheDocument(),
      );
      // 加载失败时不渲染任何控件（没有"可以改但改不了"的假面板）
      expect(screen.queryByLabelText('需要入群审核')).toBeNull();
      expect(screen.queryByText('只有群主可以修改这些设置')).toBeNull();
    });
  });

  // ---------------- 只发被改的键 ----------------

  describe('改一项', () => {
    it('点三档里的一档 ⇒ 恰好一次 PUT，body 只含 card_share_scope', async () => {
      mockApi.get.mockResolvedValue(groupDetail());
      mockApi.put.mockResolvedValue({
        ...JOIN_POLICY_DEFAULTS,
        card_share_scope: 'admins',
      } satisfies JoinPolicy);
      renderForm();
      await waitLoaded();

      clickScope('谁能分享群名片', '群主和管理员');

      await waitFor(() => expect(mockApi.put).toHaveBeenCalledTimes(1));
      const [url, body] = mockApi.put.mock.calls[0] as [string, Record<string, unknown>];
      expect(url).toBe('/api/groups/g1/join-policy');
      expect(body).toEqual({ card_share_scope: 'admins' });
      // 反向断言：其余四键一个都不许出现（只断言"含目标键"挡不住整体 PUT）
      expect(Object.keys(body)).toEqual(['card_share_scope']);
      for (const key of ALL_FIVE_KEYS) {
        if (key !== 'card_share_scope') {
          expect(body).not.toHaveProperty(key);
        }
      }
    });

    it('关掉「需要入群审核」⇒ body 是 {join_approval_required:false}（false 必须发出去）', async () => {
      mockApi.get.mockResolvedValue(groupDetail({ join_approval_required: true }));
      mockApi.put.mockResolvedValue({
        ...JOIN_POLICY_DEFAULTS,
        join_approval_required: false,
      } satisfies JoinPolicy);
      renderForm();
      await waitLoaded();

      fireEvent.click(approvalCheckbox());

      await waitFor(() => expect(mockApi.put).toHaveBeenCalledTimes(1));
      const body = mockApi.put.mock.calls[0][1] as Record<string, unknown>;
      expect(body).toEqual({ join_approval_required: false });
      expect(body.join_approval_required).toBe(false);
    });

    it('关掉「允许管理员参与审核」⇒ body 只含 admin_can_approve:false', async () => {
      mockApi.get.mockResolvedValue(groupDetail({ admin_can_approve: true }));
      mockApi.put.mockResolvedValue({
        ...JOIN_POLICY_DEFAULTS,
        admin_can_approve: false,
      } satisfies JoinPolicy);
      renderForm();
      await waitLoaded();

      fireEvent.click(adminApproveCheckbox());

      await waitFor(() => expect(mockApi.put).toHaveBeenCalledTimes(1));
      expect(mockApi.put.mock.calls[0][1]).toEqual({ admin_can_approve: false });
    });

    it('响应的五值整体回填（服务端同时改动的其它项也要显示出来）', async () => {
      mockApi.get.mockResolvedValue(groupDetail());
      // 只改了 search_scope，但响应里另外四项与本地显示值全不相同
      mockApi.put.mockResolvedValue({
        join_approval_required: false,
        admin_can_approve: false,
        card_share_scope: 'owner_only',
        qr_show_scope: 'admins',
        search_scope: 'admins',
      } satisfies JoinPolicy);
      renderForm();
      await waitLoaded();

      clickScope('谁搜得到这个群', '仅群主和管理员');

      await waitFor(() => expect(pickedLabel('谁搜得到这个群')).toBe('仅群主和管理员'));
      expect(approvalCheckbox().checked).toBe(false);
      expect(adminApproveCheckbox().checked).toBe(false);
      expect(pickedLabel('谁能分享群名片')).toBe('仅群主');
      expect(pickedLabel('谁能展示群二维码')).toBe('群主和管理员');
    });

    it('请求在途期间 UI 不先切过去（不做乐观更新），且控件禁用', async () => {
      mockApi.get.mockResolvedValue(groupDetail());
      let resolvePut!: (v: JoinPolicy) => void;
      mockApi.put.mockReturnValue(
        new Promise<JoinPolicy>((res) => {
          resolvePut = res;
        }),
      );
      renderForm();
      await waitLoaded();

      clickScope('谁能展示群二维码', '仅群主');

      await waitFor(() => expect(screen.getByText('保存中...')).toBeInTheDocument());
      // 关键：响应还没回来 ⇒ 选中态仍是旧值
      expect(pickedLabel('谁能展示群二维码')).toBe('全体成员');
      expect(approvalCheckbox()).toBeDisabled();
      const qrGroup = screen.getByRole('group', { name: '谁能展示群二维码' });
      within(qrGroup)
        .getAllByRole('button')
        .forEach((b) => expect(b).toBeDisabled());

      resolvePut({ ...JOIN_POLICY_DEFAULTS, qr_show_scope: 'owner_only' });
      await waitFor(() => expect(pickedLabel('谁能展示群二维码')).toBe('仅群主'));
      expect(screen.queryByText('保存中...')).toBeNull();
    });
  });

  // ---------------- 错误分档 ----------------

  describe('错误分档（四种互不相同）', () => {
    const CASES: ReadonlyArray<[string, unknown, string]> = [
      ['403（不是群主）', new ApiError(403, 'forbidden'), '只有群主可以修改这些设置'],
      ['400（取值不在白名单）', new ApiError(400, 'bad'), '设置值不被服务器接受（客户端版本可能过旧）'],
      ['404（群不存在）', new ApiError(404, 'gone'), '该群聊不存在或已解散'],
      ['网络失败（拿不到状态码）', new Error('network down'), 'network down'],
    ];

    it.each(CASES)('%s ⇒ 专属文案，且 UI 值不变', async (_name, err, expected) => {
      mockApi.get.mockResolvedValue(groupDetail());
      mockApi.put.mockRejectedValue(err);
      renderForm();
      await waitLoaded();

      clickScope('谁能分享群名片', '仅群主');

      await waitFor(() => expect(screen.getByText(expected)).toBeInTheDocument());
      // 失败后不许留在"已生效"的样子
      expect(pickedLabel('谁能分享群名片')).toBe('全体成员');
      // 且没被合成成一句通用文案
      expect(screen.queryByText('操作失败')).toBeNull();
    });

    it('重试成功后错误文案消失', async () => {
      mockApi.get.mockResolvedValue(groupDetail());
      mockApi.put.mockRejectedValueOnce(new ApiError(403, 'forbidden'));
      renderForm();
      await waitLoaded();

      clickScope('谁能分享群名片', '仅群主');
      await waitFor(() =>
        expect(screen.getByText('只有群主可以修改这些设置')).toBeInTheDocument(),
      );

      mockApi.put.mockResolvedValue({
        ...JOIN_POLICY_DEFAULTS,
        card_share_scope: 'owner_only',
      } satisfies JoinPolicy);
      clickScope('谁能分享群名片', '仅群主');

      await waitFor(() => expect(pickedLabel('谁能分享群名片')).toBe('仅群主'));
      expect(screen.queryByText('只有群主可以修改这些设置')).toBeNull();
    });
  });

  // ---------------- 返回 ----------------

  it('点 ← 调 onBack', async () => {
    mockApi.get.mockResolvedValue(groupDetail());
    const { onBack } = renderForm();
    await waitLoaded();

    fireEvent.click(screen.getByRole('button', { name: '←' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  // ---------------- 纯函数 ----------------

  describe('applyJoinPolicyDefaults', () => {
    it('全缺 ⇒ 逐值等于 JOIN_POLICY_DEFAULTS（回落只有这一个来源）', () => {
      expect(applyJoinPolicyDefaults({})).toEqual(JOIN_POLICY_DEFAULTS);
    });

    it('false 不被当成"缺失"（?? 而不是 ||）', () => {
      const out = applyJoinPolicyDefaults({ join_approval_required: false, admin_can_approve: false });
      expect(out.join_approval_required).toBe(false);
      expect(out.admin_can_approve).toBe(false);
    });

    it('部分给值 ⇒ 给了的保留、没给的回落', () => {
      const out = applyJoinPolicyDefaults({ search_scope: 'owner_only' });
      expect(out.search_scope).toBe('owner_only');
      expect(out.card_share_scope).toBe(JOIN_POLICY_DEFAULTS.card_share_scope);
      expect(out.qr_show_scope).toBe(JOIN_POLICY_DEFAULTS.qr_show_scope);
    });
  });

  describe('错误映射纯函数', () => {
    it('PUT：三档各自一句，null 回落原文（不猜成三档之一）', () => {
      expect(describeJoinPolicyUpdateError(403, 'raw')).toBe('只有群主可以修改这些设置');
      expect(describeJoinPolicyUpdateError(400, 'raw')).toBe(
        '设置值不被服务器接受（客户端版本可能过旧）',
      );
      expect(describeJoinPolicyUpdateError(404, 'raw')).toBe('该群聊不存在或已解散');
      expect(describeJoinPolicyUpdateError(null, 'raw')).toBe('raw');
      expect(describeJoinPolicyUpdateError(500, 'raw')).toBe('raw');
    });

    it('GET 与 PUT 的 403 文案不同（同一状态码在两个端点上是两件事）', () => {
      expect(describeGroupDetailError(403, 'raw')).toBe('你已不是本群成员，无法查看群设置');
      expect(describeGroupDetailError(403, 'raw')).not.toBe(describeJoinPolicyUpdateError(403, 'raw'));
      expect(describeGroupDetailError(404, 'raw')).toBe('该群聊不存在或已解散');
      expect(describeGroupDetailError(null, 'raw')).toBe('raw');
    });
  });

  // ---------------- search_scope 方向（契约单独标红那条） ----------------

  it('search_scope 三档文案按"群外的人"讲，owner_only 明说别人搜不到', async () => {
    mockApi.get.mockResolvedValue(groupDetail());
    renderForm();
    await waitLoaded();

    const group = screen.getByRole('group', { name: '谁搜得到这个群' });
    const labels = within(group)
      .getAllByRole('button')
      .map((b) => b.textContent ?? '');

    expect(labels).toEqual(['任何人', '仅群主和管理员', '仅群主（别人搜不到）']);
    // 反向：不许照抄成员版的「全体成员」（那会把"任何登录用户"读成"本群全体成员"）
    expect(labels).not.toContain('全体成员');
    // 说明文案要点明它管的是"能不能被搜到"，不是"能不能进来"
    expect(screen.getByText(/不影响已经知道/)).toBeInTheDocument();
  });

  // ---------------- search_scope 改名的双向对账（防"全局替换误伤"） ----------------

  /**
   * 🔴 文案相同、取值不同 —— 三组选择器的最松档在界面上都是一个按钮，
   * 但发出去的**值**必须是两套：card / qr 发 `all_members`，search 发 `everyone`。
   *
   * 只断言「search 发了 everyone」与「三列被全局替换成 everyone」输出**同形**，
   * 所以这里三组都断，并各配一条反向断言（不许出现对方那一档的取值）。
   * 这条守的是最难发现的一类错：全局 sed 改错的那两列**不报错**，只在运行时被后端 400。
   */
  it('🔴 三组最松档发出去的取值是两套：card/qr=all_members，search=everyone', async () => {
    const CASES: ReadonlyArray<[string, string, string, string, string]> = [
      // [三档组名, 最松档按钮文案, 期望的 body 键, 期望的值, 不许出现的值]
      ['谁能分享群名片', '全体成员', 'card_share_scope', 'all_members', 'everyone'],
      ['谁能展示群二维码', '全体成员', 'qr_show_scope', 'all_members', 'everyone'],
      ['谁搜得到这个群', '任何人', 'search_scope', 'everyone', 'all_members'],
    ];

    for (const [groupLabel, optionLabel, key, expected, forbidden] of CASES) {
      cleanup();
      mockApi.get.mockReset();
      mockApi.put.mockReset();
      mockApi.get.mockResolvedValue(groupDetail());
      mockApi.put.mockResolvedValue({ ...JOIN_POLICY_DEFAULTS } satisfies JoinPolicy);
      renderForm();
      await waitLoaded();

      clickScope(groupLabel, optionLabel);

      await waitFor(() => expect(mockApi.put).toHaveBeenCalledTimes(1));
      const body = mockApi.put.mock.calls[0][1] as Record<string, unknown>;
      expect(body).toEqual({ [key]: expected });
      expect(body[key]).toBe(expected);
      // 反向：这一列绝不许发出另一套命名的取值
      expect(body[key]).not.toBe(forbidden);
    }
  });
});
