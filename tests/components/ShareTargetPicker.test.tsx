/**
 * ShareTargetPicker（A 版快捷卡的「发给谁」那一半）
 *
 * 覆盖 A 版规格里能在 jsdom 里被证伪的那几条：
 * ② 三段合并成一条列表、**没有 tab**
 * ③ 已选浮成 chip、chip 可单独撤销、与列表行勾选态双向一致
 * ④ 一个搜索框同时过滤三段
 * ⑤ 底部「已选 N 个会话」+ 未选中时发送不可点
 *
 * 布局/动画不在这里断（jsdom 无布局引擎、skipAnimations 跳帧），由真机截图承担。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ShareTargetPicker, type ShareTarget } from '../../src/components/share/ShareTargetPicker';

const store = vi.hoisted(() => ({
  friends: [
    {
      friend_id: 'u-lin', friend_nickname: '林知遥', friend_avatar_url: null,
      add_time: '2026-01-01T00:00:00Z', approve_reason: null, friend_remark: null,
      is_blacklisted: false, is_special_care: false,
    },
    {
      friend_id: 'u-su', friend_nickname: '苏晚', friend_avatar_url: null,
      add_time: '2026-01-01T00:00:00Z', approve_reason: null, friend_remark: null,
      is_blacklisted: false, is_special_care: false,
    },
  ],
  groups: [
    {
      group_id: 'g-week', group_name: '前端周会', group_avatar_url: '',
      role: 'owner' as const, unread_count: 0,
      last_message_content: null, last_message_time: null,
    },
    {
      group_id: 'g-alpha', group_name: '项目 Alpha 讨论组', group_avatar_url: '',
      role: 'member' as const, unread_count: 0,
      last_message_content: null, last_message_time: null,
    },
  ],
}));

vi.mock('../../src/stores/chatStore', () => ({
  useChatStore: (selector: (s: typeof store) => unknown) => selector(store),
}));

// 「最近聊天」的取数依据：本地会话表。这里只让 林知遥 / 前端周会 有本地会话行，
// 于是「最近聊天」应当只出现这两个，另两个落到「好友」「群组」段。
const localConversations = vi.hoisted(() => {
  const friendPreviews = new Map<string, unknown>([
    ['u-lin', {
      conversationId: 'conv-lin', lastMessage: '明天的评审挪到 15:00',
      lastMessageTime: '2026-08-17T09:42:00Z', lastSeq: 3, isPinned: false,
    }],
  ]);
  const groupPreviews = new Map<string, unknown>([
    ['g-week', {
      conversationId: 'g-week', lastMessage: '陈默: 那我把接口文档同步到下一版',
      lastMessageTime: '2026-08-17T09:51:00Z', lastSeq: 8, isPinned: false,
    }],
  ]);
  return {
    getFriendPreview: (id: string) => friendPreviews.get(id),
    getGroupPreview: (id: string) => groupPreviews.get(id),
  };
});

vi.mock('../../src/hooks/useLocalConversations', () => ({
  useLocalConversations: () => localConversations,
}));

/** 段标签文本（顺序即渲染顺序） */
function sectionLabels(): string[] {
  return Array.from(document.querySelectorAll('.share-picker-section-label'))
    .map((el) => el.textContent ?? '');
}

/** 列表行的可见名字（去掉 [群聊] 标签与副标题） */
function rowNames(): string[] {
  return Array.from(document.querySelectorAll('.share-picker-row .share-picker-row-name'))
    .map((el) => (el.firstChild?.textContent ?? '').trim());
}

function chipNames(): string[] {
  return Array.from(document.querySelectorAll('.share-picker-chip-name'))
    .map((el) => el.textContent ?? '');
}

function rowByName(name: string): HTMLElement {
  const hit = Array.from(document.querySelectorAll<HTMLElement>('.share-picker-row'))
    .find((el) => el.querySelector('.share-picker-row-name')?.textContent?.includes(name));
  if (!hit) { throw new Error(`没有找到列表行：${name}`); }
  return hit;
}

describe('ShareTargetPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染：三段合并成一条列表（最近聊天 / 好友 / 群组），且没有 tab', () => {
    render(<ShareTargetPicker title="转发到" onConfirm={vi.fn()} onClose={vi.fn()} />);

    expect(sectionLabels()).toEqual(['最近聊天', '好友', '群组']);
    // 最近段来自本地会话表：只有这两个有本地会话行
    expect(rowNames().slice(0, 2)).toEqual(['前端周会', '林知遥']);
    // 已在「最近」出现的不再重复出现在下面两段
    expect(rowNames()).toEqual(['前端周会', '林知遥', '苏晚', '项目 Alpha 讨论组']);
    // A 版规格②：不再有 tab 切换
    expect(document.querySelectorAll('.share-meeting-tab').length).toBe(0);
    expect(screen.queryByRole('button', { name: /^好友 \(/ })).toBeNull();
  });

  it('渲染：顶部预览 slot 由调用方注入，未选中时发送不可点、计数为 0', () => {
    render(
      <ShareTargetPicker
        title="转发到"
        preview={<div data-testid="preview-slot">这是要发出去的内容</div>}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByTestId('preview-slot')).toBeInTheDocument();
    expect(screen.getByText('这是要发出去的内容')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled();
    expect(document.querySelector('.share-picker-count')?.textContent).toBe('已选 0 个会话');
  });

  it('交互：点行选中 → 浮出 chip、计数变 1、发送可点；行的 aria-pressed 同步', () => {
    render(<ShareTargetPicker title="转发到" onConfirm={vi.fn()} onClose={vi.fn()} />);

    const row = rowByName('林知遥');
    expect(row).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(row);

    expect(chipNames()).toEqual(['林知遥']);
    expect(document.querySelector('.share-picker-count')?.textContent).toBe('已选 1 个会话');
    expect(screen.getByRole('button', { name: '发送' })).toBeEnabled();
    expect(rowByName('林知遥')).toHaveAttribute('aria-pressed', 'true');
  });

  it('交互：chip 上的 ✕ 单独撤销，列表行的勾选态同步回落', () => {
    render(<ShareTargetPicker title="转发到" onConfirm={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(rowByName('林知遥'));
    fireEvent.click(rowByName('前端周会'));
    expect(chipNames()).toEqual(['林知遥', '前端周会']);

    fireEvent.click(screen.getByRole('button', { name: '取消选择 林知遥' }));

    expect(chipNames()).toEqual(['前端周会']);
    expect(rowByName('林知遥')).toHaveAttribute('aria-pressed', 'false');
    expect(rowByName('前端周会')).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('.share-picker-count')?.textContent).toBe('已选 1 个会话');
  });

  it('交互：一个搜索框同时过滤三段（好友名 + 群名）', () => {
    render(<ShareTargetPicker title="转发到" onConfirm={vi.fn()} onClose={vi.fn()} />);

    const box = screen.getByLabelText('搜索好友、群组');

    fireEvent.change(box, { target: { value: '林' } });
    expect(rowNames()).toEqual(['林知遥']);
    expect(sectionLabels()).toEqual(['最近聊天']);

    fireEvent.change(box, { target: { value: '组' } });
    expect(rowNames()).toEqual(['项目 Alpha 讨论组']);
    expect(sectionLabels()).toEqual(['群组']);

    fireEvent.change(box, { target: { value: '不存在的名字' } });
    expect(rowNames()).toEqual([]);
    expect(screen.getByText('没有匹配的会话')).toBeInTheDocument();
  });

  it('交互：点发送把选中的会话原样交给 onConfirm（好友 + 群各一）', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(<ShareTargetPicker title="转发到" onConfirm={onConfirm} onClose={vi.fn()} />);

    fireEvent.click(rowByName('林知遥'));
    fireEvent.click(rowByName('前端周会'));
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const targets = onConfirm.mock.calls[0][0] as ShareTarget[];
    expect(targets).toEqual([
      { type: 'friend', id: 'u-lin', name: '林知遥', avatarUrl: null },
      { type: 'group', id: 'g-week', name: '前端周会', avatarUrl: null },
    ]);
    await waitFor(() => expect(screen.getByRole('button', { name: '已发送' })).toBeInTheDocument());
  });

  it('交互：发送失败时把错误摆出来，面板不关、已选不清空（可直接重试）', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('网络不可达'));
    const onClose = vi.fn();
    render(<ShareTargetPicker title="转发到" onConfirm={onConfirm} onClose={onClose} />);

    fireEvent.click(rowByName('林知遥'));
    fireEvent.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('网络不可达'));
    expect(onClose).not.toHaveBeenCalled();
    expect(chipNames()).toEqual(['林知遥']);
    expect(screen.getByRole('button', { name: '发送' })).toBeEnabled();
  });

  it('交互：点关闭走退场后回调 onClose（调用方据此卸载）', async () => {
    const onClose = vi.fn();
    render(<ShareTargetPicker title="转发到" onConfirm={vi.fn()} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: '关闭' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
