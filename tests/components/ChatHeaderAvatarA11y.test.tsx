/**
 * 聊天顶栏标题区 a11y 测试（可点击头像容器 a11y 修复，点 4 + 点 5）
 *
 * 锁定契约：
 * - 桌面 ChatPanel `.chat-header-info` / 移动 MobileChatView `.mobile-chat-title`
 *   仅在「私聊」时挂 role=button / tabIndex=0 / aria-label=`查看${标题}资料` +
 *   onKeyDown(Enter/Space)=openProfile(friendId) + 键盘焦点环
 * - 群聊 / AI 聊天顶栏无任何 a11y 交互属性（反向断言）
 *
 * 两组件都是重组件（拉入消息列表 / 语音 / 菜单子树），统一把子树 mock 成 null，
 * 只保留顶栏结构；stores 用真实 store 并 spy profileViewStore.open。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import type { ComponentProps } from 'react';
import type { Session } from '../../src/types/session';
import type { ChatTarget, Friend, Group } from '../../src/types/chat';

// ============== Mock 重型子树（只留顶栏结构） ==============
vi.mock('../../src/chat/friend/ChatMessages', () => ({ ChatMessages: () => null }));
vi.mock('../../src/chat/group/GroupChatMessages', () => ({ GroupChatMessages: () => null }));
vi.mock('../../src/chat/ai/AIChatMessages', () => ({ AIChatMessages: () => null }));
vi.mock('../../src/chat/ai/AIHistoryPanel', () => ({ AIHistoryPanel: () => null }));
vi.mock('../../src/chat/ai/voice/VoiceCallView', () => ({ VoiceCallView: () => null }));
vi.mock('../../src/chat/ai/voice/VoiceProfileManager', () => ({ VoiceProfileManager: () => null }));
vi.mock('../../src/chat/shared/ChatMenu', () => ({ ChatMenuButton: () => null }));
vi.mock('../../src/chat/shared/MultiSelectActionBar', () => ({ MultiSelectActionBar: () => null }));
vi.mock('../../src/chat/shared/ChatInputArea', () => ({ ChatInputArea: () => null }));
// ConversationShelf 用 useApi()（会话上下文）；本测试只验顶栏结构、不挂 SessionProvider，
// 与上方重型子树同样 mock 成 null（顶置架自身逻辑另有 ConversationShelf.test.tsx 覆盖）。
vi.mock('../../src/chat/shared/ConversationShelf', () => ({ ConversationShelf: () => null }));

import { ChatPanel } from '../../src/chat/shared/ChatPanel';
import { MobileChatView } from '../../src/pages/mobile/MobileChatView';
import { useProfileViewStore } from '../../src/stores/profileViewStore';

const session = {
  serverUrl: 'https://api.test', userId: 'me', accessToken: 't', refreshToken: 'r',
  profile: {
    user_id: 'me', user_nickname: 'Me', user_email: null, user_signature: null,
    user_avatar_url: null, admin: 'false', created_at: '', updated_at: '',
  },
  avatarPath: null,
} as Session;

const friend: Friend = {
  friend_id: 'them', friend_nickname: 'Them', friend_avatar_url: null,
  add_time: '2026-01-01T00:00:00Z', approve_reason: null, friend_remark: null,
  is_blacklisted: false, is_special_care: false,
};
const group: Group = {
  group_id: 'g1', group_name: '群一', group_avatar_url: '', role: 'member',
  unread_count: 0, last_message_content: null, last_message_time: null,
};

const friendTarget: ChatTarget = { type: 'friend', data: friend };
const groupTarget: ChatTarget = { type: 'group', data: group };
const aiTarget: ChatTarget = { type: 'ai' };

function baseChatPanelProps(chatTarget: ChatTarget): ComponentProps<typeof ChatPanel> {
  return {
    session,
    chatTarget,
    friendMessages: [],
    groupMessages: [],
    isLoading: false,
    totalMessageCount: 0,
    hasMore: false,
    loadingMore: false,
    onLoadMore: vi.fn(),
    messageInput: '',
    onMessageChange: vi.fn(),
    onSendMessage: vi.fn(),
    isMultiSelectMode: false,
    selectedMessages: new Set<string>(),
    canBatchRecall: false,
    onToggleSelect: vi.fn(),
    onEnterMultiSelect: vi.fn(),
    onExitMultiSelect: vi.fn(),
    onSelectAll: vi.fn(),
    onDeselectAll: vi.fn(),
    onBatchDelete: vi.fn(),
    onBatchRecall: vi.fn(),
    onRecallMessage: vi.fn(),
    onDeleteMessage: vi.fn(),
    onFriendRemoved: vi.fn(),
    onGroupUpdated: vi.fn(),
    onGroupLeft: vi.fn(),
  };
}

function baseMobileChatViewProps(chatTarget: ChatTarget): ComponentProps<typeof MobileChatView> {
  return {
    session,
    chatTarget,
    friendMessages: [],
    groupMessages: [],
    isLoading: false,
    hasMore: false,
    loadingMore: false,
    onLoadMore: vi.fn(),
    messageInput: '',
    onMessageChange: vi.fn(),
    onSendMessage: vi.fn(),
    isMultiSelectMode: false,
    selectedMessages: new Set<string>(),
    canBatchRecall: false,
    onToggleSelect: vi.fn(),
    onEnterMultiSelect: vi.fn(),
    onExitMultiSelect: vi.fn(),
    onSelectAll: vi.fn(),
    onDeselectAll: vi.fn(),
    onBatchDelete: vi.fn(),
    onBatchRecall: vi.fn(),
    onRecallMessage: vi.fn(),
    onDeleteMessage: vi.fn(),
    onFriendRemoved: vi.fn(),
    onGroupUpdated: vi.fn(),
    onGroupLeft: vi.fn(),
    onBack: vi.fn(),
  };
}

describe('ChatPanel 顶栏 .chat-header-info a11y（仅私聊）', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    cleanup();
    useProfileViewStore.setState({ userId: null });
    openSpy = vi.spyOn(useProfileViewStore.getState(), 'open');
  });

  function headerEl(container: HTMLElement): HTMLElement {
    const el = container.querySelector('.chat-header-info');
    expect(el).not.toBeNull();
    return el as HTMLElement;
  }

  it('私聊顶栏具备 role=button / tabIndex=0 / aria-label=查看${对方名}资料', () => {
    const { container } = render(<ChatPanel {...baseChatPanelProps(friendTarget)} />);
    const header = headerEl(container);
    expect(header).toHaveAttribute('role', 'button');
    expect(header).toHaveAttribute('tabindex', '0');
    expect(header).toHaveAttribute('aria-label', '查看Them资料');
  });

  /**
   * 头像**落点**的正面守卫。
   *
   * 17e1c5a 把 1:1 的气泡头像整块搬到顶栏，随手删掉了 MessageBubbleRecalled.test.tsx 里
   * 「撤回态不渲染头像」那三条（改版后对任何私聊消息恒真 = 假测试，删得对），
   * 但它留下的注释把接管者写成 `tests/components/ChatHeaderAvatar.test.tsx`
   * —— **那个文件从来不存在**，现查全仓 `.chat-header-avatar` 在 tests/ 里零命中，
   * 即「头像搬到了顶栏」这件事此前根本没有任何测试守着（与 GroupBubbleRunMerge
   * 那条假接管者同一族）。这两条把它真正接管起来，那边的注释同步改指到这里。
   */
  it('私聊 / 群聊顶栏都渲染 .chat-header-avatar（头像的新落点）', () => {
    const friendRender = render(<ChatPanel {...baseChatPanelProps(friendTarget)} />);
    expect(friendRender.container.querySelector('.chat-header-avatar')).not.toBeNull();
    cleanup();

    const groupRender = render(<ChatPanel {...baseChatPanelProps(groupTarget)} />);
    expect(groupRender.container.querySelector('.chat-header-avatar')).not.toBeNull();
  });

  it('AI 顶栏不渲染 .chat-header-avatar（反向断言：不是谁都有头像）', () => {
    const { container } = render(<ChatPanel {...baseChatPanelProps(aiTarget)} />);
    expect(container.querySelector('.chat-header-avatar')).toBeNull();
  });

  /**
   * 鼠标单击这一路的接管者。
   *
   * 17e1c5a 把 1:1 的气泡头像整块搬去顶栏，同一笔删掉了
   * tests/components/MessageBubbleAvatarClick.test.tsx（167 行 / 9 个 it），其中
   * 「点他人头像 → openProfileView」是**鼠标单击**语义。本文件此前只覆盖了键盘
   * （Enter / Space / 无关键）与属性，**单击那一路在 1:1 侧一直没有接管者** ——
   * 补上这条，改名的键盘处理器与 onClick 是两个独立 prop，删掉一个另一个照绿。
   */
  it('私聊顶栏鼠标单击 → openProfile(friendId)', () => {
    const { container } = render(<ChatPanel {...baseChatPanelProps(friendTarget)} />);
    fireEvent.click(headerEl(container));
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('them');
  });

  it('群聊顶栏鼠标单击不触发 openProfile（反向断言：不是谁点都开）', () => {
    const { container } = render(<ChatPanel {...baseChatPanelProps(groupTarget)} />);
    fireEvent.click(headerEl(container));
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('私聊顶栏 Enter → openProfile(friendId)', () => {
    const { container } = render(<ChatPanel {...baseChatPanelProps(friendTarget)} />);
    fireEvent.keyDown(headerEl(container), { key: 'Enter' });
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('them');
  });

  it('私聊顶栏 Space → openProfile(friendId)', () => {
    const { container } = render(<ChatPanel {...baseChatPanelProps(friendTarget)} />);
    fireEvent.keyDown(headerEl(container), { key: ' ' });
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('them');
  });

  it('私聊顶栏无关键（如 a）不触发 openProfile', () => {
    const { container } = render(<ChatPanel {...baseChatPanelProps(friendTarget)} />);
    fireEvent.keyDown(headerEl(container), { key: 'a' });
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('群聊顶栏无 role/tabIndex/aria-label（反向断言）', () => {
    const { container } = render(<ChatPanel {...baseChatPanelProps(groupTarget)} />);
    const header = headerEl(container);
    expect(header).not.toHaveAttribute('role');
    expect(header).not.toHaveAttribute('tabindex');
    expect(header).not.toHaveAttribute('aria-label');
  });

  it('AI 聊天顶栏无 role/tabIndex/aria-label（反向断言）', () => {
    const { container } = render(<ChatPanel {...baseChatPanelProps(aiTarget)} />);
    const header = headerEl(container);
    expect(header).not.toHaveAttribute('role');
    expect(header).not.toHaveAttribute('tabindex');
    expect(header).not.toHaveAttribute('aria-label');
  });

  it('私聊顶栏键盘聚焦显示焦点环类；pointerdown 后聚焦不显示', () => {
    const { container } = render(<ChatPanel {...baseChatPanelProps(friendTarget)} />);
    const header = headerEl(container);
    fireEvent.focus(header);
    expect(header.classList.contains('a11y-kbd-focus')).toBe(true);
    fireEvent.blur(header);
    expect(header.classList.contains('a11y-kbd-focus')).toBe(false);
    fireEvent.pointerDown(header);
    fireEvent.focus(header);
    expect(header.classList.contains('a11y-kbd-focus')).toBe(false);
  });
});

describe('MobileChatView 顶栏 .mobile-chat-title a11y（仅私聊）', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    cleanup();
    useProfileViewStore.setState({ userId: null });
    openSpy = vi.spyOn(useProfileViewStore.getState(), 'open');
  });

  function titleEl(container: HTMLElement): HTMLElement {
    const el = container.querySelector('.mobile-chat-title');
    expect(el).not.toBeNull();
    return el as HTMLElement;
  }

  it('私聊标题具备 role=button / tabIndex=0 / aria-label=查看${对方名}资料', () => {
    const { container } = render(<MobileChatView {...baseMobileChatViewProps(friendTarget)} />);
    const title = titleEl(container);
    expect(title).toHaveAttribute('role', 'button');
    expect(title).toHaveAttribute('tabindex', '0');
    expect(title).toHaveAttribute('aria-label', '查看Them资料');
  });

  /** 移动端同一路的接管者，理由见桌面侧同名用例上的注释 */
  it('私聊标题鼠标单击 → openProfile(friendId)', () => {
    const { container } = render(<MobileChatView {...baseMobileChatViewProps(friendTarget)} />);
    fireEvent.click(titleEl(container));
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('them');
  });

  it('群聊标题鼠标单击不触发 openProfile（反向断言）', () => {
    const { container } = render(<MobileChatView {...baseMobileChatViewProps(groupTarget)} />);
    fireEvent.click(titleEl(container));
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('私聊标题 Enter → openProfile(friendId)', () => {
    const { container } = render(<MobileChatView {...baseMobileChatViewProps(friendTarget)} />);
    fireEvent.keyDown(titleEl(container), { key: 'Enter' });
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('them');
  });

  it('私聊标题 Space → openProfile(friendId)', () => {
    const { container } = render(<MobileChatView {...baseMobileChatViewProps(friendTarget)} />);
    fireEvent.keyDown(titleEl(container), { key: ' ' });
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('them');
  });

  it('群聊标题无 role/tabIndex/aria-label（反向断言）', () => {
    const { container } = render(<MobileChatView {...baseMobileChatViewProps(groupTarget)} />);
    const title = titleEl(container);
    expect(title).not.toHaveAttribute('role');
    expect(title).not.toHaveAttribute('tabindex');
    expect(title).not.toHaveAttribute('aria-label');
  });

  it('AI 标题无 role/tabIndex/aria-label（反向断言）', () => {
    const { container } = render(<MobileChatView {...baseMobileChatViewProps(aiTarget)} />);
    const title = titleEl(container);
    expect(title).not.toHaveAttribute('role');
    expect(title).not.toHaveAttribute('tabindex');
    expect(title).not.toHaveAttribute('aria-label');
  });

  it('私聊标题键盘聚焦显示焦点环类；pointerdown 后聚焦不显示', () => {
    const { container } = render(<MobileChatView {...baseMobileChatViewProps(friendTarget)} />);
    const title = titleEl(container);
    fireEvent.focus(title);
    expect(title.classList.contains('a11y-kbd-focus')).toBe(true);
    fireEvent.blur(title);
    expect(title.classList.contains('a11y-kbd-focus')).toBe(false);
    fireEvent.pointerDown(title);
    fireEvent.focus(title);
    expect(title.classList.contains('a11y-kbd-focus')).toBe(false);
  });
});
