/**
 * InviteForm：邀请成员从「手输 user ID」改为「从好友列表选人」
 *
 * 被测：src/chat/shared/menu/InviteForm.tsx（复用 components/share/ShareTargetPicker）
 *
 * 三件事各有独立断言，缺一都会漏掉一半：
 * ① **手输框真的没了**（反向断言 + 同文件正对照：附言框仍在）
 *    —— 只断言「选择器能用」不能证明旧路已删，两条路并存正是本轮要消灭的形态。
 * ② 选择器**只列好友**：好友出现（正对照）+ 群不出现（负对照）+ 搜索框文案随之收窄。
 *    正负两侧形状不同 ⇒ 判据有区分力（同一份 store 里两类都塞了数据，
 *    群不出现不是因为「store 里本来就没群」）。
 * ③ 多选 → `onInvite` 收到的是**数组**且含全部选中项（契约 `inviteToGroup` 第三参本就是数组，
 *    一次可邀多人；只断言长度 1 就把这条契约放过去了）。
 *
 * mock 边界：`useLocalConversations` 会经 db_* 查本地会话表（jsdom 里没有），
 * 且它只影响「最近聊天」分段的排序，与本文件三条断言无关 ⇒ 打成空实现。
 * 好友/群数据用真实 useChatStore.setState 注入（与 GroupDetailPanel.test.tsx 同套路）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('../../src/hooks/useLocalConversations', () => ({
  useLocalConversations: () => ({
    previews: { friends: new Map(), groups: new Map() },
    loading: false,
    initialized: true,
    refresh: vi.fn(),
    getFriendPreview: () => undefined,
    getGroupPreview: () => undefined,
  }),
}));

import { InviteForm } from '../../src/chat/shared/menu/InviteForm';
import { useChatStore } from '../../src/stores';
import type { Friend, Group } from '../../src/types/chat';

const friend = (id: string, nickname: string): Friend => ({
  friend_id: id,
  friend_nickname: nickname,
  friend_avatar_url: null,
  add_time: '2026-01-01T00:00:00Z',
  approve_reason: null,
  friend_remark: null,
  is_blacklisted: false,
  is_special_care: false,
});

const group = (id: string, name: string): Group => ({
  group_id: id,
  group_name: name,
  group_avatar_url: '',
  role: 'member',
  unread_count: 0,
  last_message_content: null,
  last_message_time: null,
});

function renderForm(overrides: Partial<Parameters<typeof InviteForm>[0]> = {}) {
  const props = {
    message: '',
    loading: false,
    onMessageChange: vi.fn(),
    onInvite: vi.fn().mockResolvedValue(undefined),
    onBack: vi.fn(),
    ...overrides,
  };
  render(<InviteForm {...props} />);
  return props;
}

describe('InviteForm 好友选择器', () => {
  beforeEach(() => {
    useChatStore.setState({
      friends: [friend('f1', '张三'), friend('f2', '李四')],
      groups: [group('g1', '产品讨论群')],
    });
  });

  afterEach(() => {
    cleanup();
    useChatStore.setState({ friends: [], groups: [] });
  });

  it('① 手输 user ID 的框已整块删除（反向断言），附言框仍在（同文件正对照）', () => {
    renderForm();

    // 反向：旧的手输框（唯一识别物是它的 placeholder）不存在
    expect(screen.queryByPlaceholderText('输入用户 ID')).toBeNull();
    // 正对照：附言框在 —— 证明组件确实渲染出来了，上面那个 null 不是「整个组件没渲染」
    expect(screen.getByPlaceholderText('邀请消息（可选）')).toBeInTheDocument();
    // 入口按钮就位
    expect(screen.getByRole('button', { name: '从好友列表选择' })).toBeInTheDocument();
  });

  it('② 选择器只列好友：好友在（正）· 群不在（负）· 搜索框文案收窄到「搜索好友」', () => {
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: '从好友列表选择' }));

    expect(screen.getByRole('dialog', { name: '邀请好友入群' })).toBeInTheDocument();
    // 正对照：两个好友都在
    expect(screen.getByText('张三')).toBeInTheDocument();
    expect(screen.getByText('李四')).toBeInTheDocument();
    // 负对照：同一份 store 里的群不出现（形状与正对照不同 ⇒ 判据有区分力）
    expect(screen.queryByText('产品讨论群')).toBeNull();
    // 文案随可选类型收窄（默认那档是「搜索好友、群组」）
    expect(screen.getByLabelText('搜索好友')).toBeInTheDocument();
    expect(screen.queryByLabelText('搜索好友、群组')).toBeNull();
    // 底部计数量词也跟着走：选的是人，不是会话（默认那档是「个会话」）
    expect(screen.getByText(/位好友/)).toBeInTheDocument();
    expect(screen.queryByText(/个会话/)).toBeNull();
  });

  it('③ 多选两个好友 → onInvite 收到含两个 id 的数组（一次邀多人）', async () => {
    const props = renderForm();
    fireEvent.click(screen.getByRole('button', { name: '从好友列表选择' }));

    fireEvent.click(screen.getByText('张三').closest('button') as HTMLElement);
    fireEvent.click(screen.getByText('李四').closest('button') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: '邀请' }));

    await waitFor(() => expect(props.onInvite).toHaveBeenCalledTimes(1));
    expect(props.onInvite).toHaveBeenCalledWith(['f1', 'f2']);
  });

  it('④ onInvite 抛错 → 错误文案落在选择器里、选择器不关、已选不清空（可直接重试）', async () => {
    const props = renderForm({ onInvite: vi.fn().mockRejectedValue(new Error('你没有邀请权限')) });
    fireEvent.click(screen.getByRole('button', { name: '从好友列表选择' }));

    fireEvent.click(screen.getByText('张三').closest('button') as HTMLElement);
    fireEvent.click(screen.getByRole('button', { name: '邀请' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('你没有邀请权限'));
    // 面板还在、计数还在 1（不清空 ⇒ 用户可直接重试）
    expect(screen.getByRole('dialog', { name: '邀请好友入群' })).toBeInTheDocument();
    expect(props.onInvite).toHaveBeenCalledTimes(1);
  });
});
