/**
 * 群聊「回复」在消息气泡侧的行为测试
 *
 * 覆盖：
 * - 右键菜单出现「回复」项 → 点击回传本条 message（Telegram 风格触发入口，复用既有 MessageContextMenu）
 * - 发送中的消息不给「回复」项（还没有服务端 UUID，拿它当 reply_to 会被后端拒）
 * - 引用块渲染被回复者 + 原消息摘要；点击回传 reply_to 走定位通路
 * - 原消息不在已加载窗口时渲染占位文案，且**仍可点击**（点击才会去拉历史/给降级提示）
 * - 定位命中后的高亮 class 由 isHighlighted 驱动
 *
 * 这里刻意**不 mock** MessageContextMenu —— 「回复」项是否真的出现在真实菜单里正是要验的东西。
 * 气泡本身是纯 props 驱动（store 接线在 GroupChatMessages），所以 store mock 保持既有骨架即可。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { GroupMessage } from '../../src/api/groupMessages';

vi.mock('../../src/chat/shared/FileMessageContent', () => ({ FileMessageContent: () => null }));
vi.mock('../../src/chat/shared/MeetingInviteCard', () => ({ MeetingInviteCard: () => null }));
vi.mock('../../src/components/common/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}));
vi.mock('../../src/chat/shared/MobileMessageFullPreview', () => ({ MobileMessageFullPreview: () => null }));
vi.mock('../../src/chat/group/GroupRemarkInputModal', () => ({ GroupRemarkInputModal: () => null }));
vi.mock('../../src/services/fileCache', () => ({ getCachedFilePath: vi.fn().mockResolvedValue(null) }));
vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }),
}));
vi.mock('../../src/utils/platform', () => ({ isMobile: () => false }));
vi.mock('../../src/utils/saveToGallery', () => ({ saveToGallery: vi.fn() }));
vi.mock('../../src/hooks/useFileCache', () => ({ useFileCache: () => ({ localPath: null, isLocal: false }) }));

const mockChatState = vi.hoisted(() => ({
  friends: [] as unknown[],
  setChatTarget: () => {},
  groupMessageBlocks: {} as Record<string, string[]>,
  setGroupMemberBlocked: () => {},
  groupSpecialCares: {} as Record<string, string[]>,
  setGroupMemberSpecialCare: () => {},
  groupMemberRemarks: {} as Record<string, Record<string, string>>,
  setGroupMemberRemark: () => {},
  friendBlacklistTimes: {} as Record<string, string>,
}));
vi.mock('../../src/stores', () => ({
  useChatStore: (selector: (s: typeof mockChatState) => unknown) => selector(mockChatState),
  useProfileViewStore: (selector: (s: { open: () => void }) => unknown) => selector({ open: () => {} }),
}));

import { GroupMessageBubble } from '../../src/chat/group/GroupMessageBubble';
import { REPLY_UNRESOLVED_TEXT } from '../../src/chat/shared/replyPreview';

function makeMessage(overrides: Partial<GroupMessage> = {}): GroupMessage {
  return {
    message_uuid: 'uuid-1',
    group_id: 'g-1',
    sender_id: 'user-2',
    sender_nickname: 'Alice',
    sender_avatar_url: '',
    message_content: 'hello',
    message_type: 'text',
    file_uuid: null,
    file_url: null,
    file_size: null,
    image_width: null,
    image_height: null,
    reply_to: null,
    send_time: '2026-01-01T00:00:00Z',
    is_recalled: false,
    seq: 1,
    ...overrides,
  };
}

/** 右键气泡打开真实 MessageContextMenu */
function openContextMenu() {
  const bubble = document.querySelector('.message-bubble');
  expect(bubble).not.toBeNull();
  fireEvent.contextMenu(bubble!);
}

describe('GroupMessageBubble — 回复触发入口（右键菜单）', () => {
  beforeEach(() => {
    mockChatState.groupMessageBlocks = {};
    mockChatState.friendBlacklistTimes = {};
  });

  it('传了 onReply：菜单出现「回复」项，点击回传本条 message', () => {
    const onReply = vi.fn();
    const message = makeMessage();
    render(<GroupMessageBubble message={message} isOwn={false} groupId="g-1" onReply={onReply} />);

    openContextMenu();
    const replyItem = screen.getByText('回复');
    fireEvent.click(replyItem);

    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onReply).toHaveBeenCalledWith(message);
  });

  it('未传 onReply（列表层未接线）：菜单里没有「回复」项', () => {
    render(<GroupMessageBubble message={makeMessage()} isOwn={false} groupId="g-1" />);

    openContextMenu();
    expect(screen.queryByText('回复')).not.toBeInTheDocument();
    // 防空断言：菜单确实打开了（其它项在）
    expect(screen.getByText('删除')).toBeInTheDocument();
  });

  it('发送中的消息不给「回复」项（没有服务端 UUID，不能当 reply_to）', () => {
    render(
      <GroupMessageBubble
        message={makeMessage({ sendStatus: 'sending' })}
        isOwn
        groupId="g-1"
        onReply={vi.fn()}
      />,
    );

    openContextMenu();
    expect(screen.queryByText('回复')).not.toBeInTheDocument();
    expect(screen.getByText('删除')).toBeInTheDocument();
  });

  it('系统消息不给「回复」项', () => {
    render(
      <GroupMessageBubble
        message={makeMessage({ message_type: 'system' })}
        isOwn={false}
        groupId="g-1"
        onReply={vi.fn()}
      />,
    );

    openContextMenu();
    expect(screen.queryByText('回复')).not.toBeInTheDocument();
    expect(screen.getByText('删除')).toBeInTheDocument();
  });
});

describe('GroupMessageBubble — 气泡内引用块', () => {
  beforeEach(() => {
    mockChatState.groupMessageBlocks = {};
    mockChatState.friendBlacklistTimes = {};
  });

  it('命中原消息：显示被回复者与摘要；点击回传 reply_to（走定位通路）', () => {
    const onQuoteClick = vi.fn();
    render(
      <GroupMessageBubble
        message={makeMessage({ reply_to: 'origin-uuid', message_content: '我的回复正文' })}
        isOwn={false}
        groupId="g-1"
        replyQuote={{ senderName: 'Bob', text: '被引用的原文', resolved: true }}
        onQuoteClick={onQuoteClick}
      />,
    );

    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('被引用的原文')).toBeInTheDocument();
    // 本条自己的正文仍然渲染（引用块不吃掉正文）
    expect(screen.getByTestId('md')).toHaveTextContent('我的回复正文');

    fireEvent.click(screen.getByRole('button', { name: '定位到 Bob 的原消息' }));
    expect(onQuoteClick).toHaveBeenCalledTimes(1);
    expect(onQuoteClick).toHaveBeenCalledWith('origin-uuid');
  });

  it('非回复消息不渲染引用块', () => {
    render(
      <GroupMessageBubble
        message={makeMessage({ reply_to: null })}
        isOwn={false}
        groupId="g-1"
        replyQuote={null}
        onQuoteClick={vi.fn()}
      />,
    );

    expect(document.querySelector('.reply-quote')).toBeNull();
  });

  it('原消息不在已加载窗口：渲染占位文案且仍可点击（点击才会去拉历史 / 给降级提示）', () => {
    const onQuoteClick = vi.fn();
    render(
      <GroupMessageBubble
        message={makeMessage({ reply_to: 'far-away-uuid' })}
        isOwn={false}
        groupId="g-1"
        replyQuote={{ senderName: null, text: REPLY_UNRESOLVED_TEXT, resolved: false }}
        onQuoteClick={onQuoteClick}
      />,
    );

    const quote = document.querySelector('.reply-quote');
    expect(quote).not.toBeNull();
    expect(quote).toHaveClass('reply-quote--unresolved');
    expect(screen.getByText(REPLY_UNRESOLVED_TEXT)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '定位到原消息' }));
    expect(onQuoteClick).toHaveBeenCalledWith('far-away-uuid');
  });

  it('点击引用块不会冒泡触发气泡自身的多选切换', () => {
    const onToggleSelect = vi.fn();
    render(
      <GroupMessageBubble
        message={makeMessage({ reply_to: 'origin-uuid' })}
        isOwn={false}
        groupId="g-1"
        isMultiSelectMode
        onToggleSelect={onToggleSelect}
        replyQuote={{ senderName: 'Bob', text: '原文', resolved: true }}
        onQuoteClick={vi.fn()}
      />,
    );

    onToggleSelect.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '定位到 Bob 的原消息' }));
    expect(onToggleSelect).not.toHaveBeenCalled();
  });
});

describe('GroupMessageBubble — 定位命中高亮', () => {
  beforeEach(() => {
    mockChatState.groupMessageBlocks = {};
    mockChatState.friendBlacklistTimes = {};
  });

  it('isHighlighted=true 时气泡带高亮 class，默认不带', () => {
    const { rerender } = render(
      <GroupMessageBubble message={makeMessage()} isOwn={false} groupId="g-1" />,
    );
    expect(document.querySelector('.message-bubble')).not.toHaveClass('message-bubble--highlight');

    rerender(<GroupMessageBubble message={makeMessage()} isOwn={false} groupId="g-1" isHighlighted />);
    expect(document.querySelector('.message-bubble')).toHaveClass('message-bubble--highlight');
  });
});
