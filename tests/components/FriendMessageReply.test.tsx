/**
 * 私聊「回复」在消息气泡侧的行为测试（migration 036 起后端支持私聊 reply_to）
 *
 * 与群聊同一套 shared/replyPreview + shared/ReplyQuote，故覆盖点与 GroupMessageReply.test.tsx 对齐：
 * - 右键菜单出现「回复」项 → 点击回传本条 message
 * - 发送中/失败的消息不给「回复」项（还没有服务端 UUID，拿它当 reply_to 会被后端 400）
 * - 引用块渲染被回复者 + 原消息摘要；点击回传 reply_to 走定位通路
 * - 原消息不在已加载窗口时渲染占位文案，且**仍可点击**
 * - 定位命中后的高亮 class 由 isHighlighted 驱动
 *
 * 这里刻意**不 mock** MessageContextMenu —— 「回复」项是否真的出现在真实菜单里正是要验的东西。
 * 气泡是纯 props 驱动（store 接线在 ChatMessages），所以 store mock 保持骨架即可。
 *
 * ⚠️ 这条链路此前是不存在的：私聊 friend-messages 表原本无 reply-to 列，
 * 气泡从来不传 onReply。本文件锁住「私聊也能回复」这件事，防止哪天被顺手改回去。
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Friend, Message } from '../../src/types/chat';

vi.mock('../../src/chat/shared/FileMessageContent', () => ({ FileMessageContent: () => null }));
vi.mock('../../src/chat/shared/MeetingInviteCard', () => ({ MeetingInviteCard: () => null }));
vi.mock('../../src/chat/shared/CardRenderer', () => ({ CardRenderer: () => null }));
vi.mock('../../src/components/common/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}));
vi.mock('../../src/chat/shared/MobileMessageFullPreview', () => ({ MobileMessageFullPreview: () => null }));
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
  friendBlacklistTimes: {} as Record<string, string>,
}));
vi.mock('../../src/stores', () => ({
  useChatStore: (selector: (s: typeof mockChatState) => unknown) => selector(mockChatState),
  useProfileViewStore: (selector: (s: { open: () => void }) => unknown) => selector({ open: () => {} }),
}));

import { MessageBubble } from '../../src/chat/friend/MessageBubble';
import { REPLY_UNRESOLVED_TEXT } from '../../src/chat/shared/replyPreview';

const SESSION = {
  userId: 'me',
  profile: { user_nickname: '我', user_avatar_url: '' },
} as unknown as Parameters<typeof MessageBubble>[0]['session'];

const FRIEND = {
  friend_id: 'peer',
  friend_nickname: 'Alice',
  friend_avatar_url: '',
} as unknown as Friend;

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    message_uuid: 'uuid-1',
    sender_id: 'peer',
    receiver_id: 'me',
    message_content: 'hello',
    message_type: 'text',
    file_uuid: null,
    file_url: null,
    file_size: null,
    file_hash: null,
    reply_to: null,
    send_time: '2026-01-01T00:00:00Z',
    is_recalled: false,
    ...overrides,
  };
}

function renderBubble(props: Partial<Parameters<typeof MessageBubble>[0]> = {}) {
  return render(
    <MessageBubble
      message={makeMessage()}
      isOwn={false}
      session={SESSION}
      friend={FRIEND}
      {...props}
    />,
  );
}

/** 右键气泡打开真实 MessageContextMenu */
function openContextMenu() {
  const bubble = document.querySelector('.message-bubble');
  expect(bubble).not.toBeNull();
  fireEvent.contextMenu(bubble!);
}

describe('MessageBubble（私聊）— 回复触发入口（右键菜单）', () => {
  it('传了 onReply：菜单出现「回复」项，点击回传本条 message', () => {
    const onReply = vi.fn();
    const message = makeMessage();
    renderBubble({ message, onReply });

    openContextMenu();
    fireEvent.click(screen.getByText('回复'));

    expect(onReply).toHaveBeenCalledTimes(1);
    expect(onReply).toHaveBeenCalledWith(message);
  });

  it('未传 onReply：菜单里没有「回复」项', () => {
    renderBubble();

    openContextMenu();
    expect(screen.queryByText('回复')).not.toBeInTheDocument();
    // 防空断言：菜单确实打开了（其它项在）
    expect(screen.getByText('删除')).toBeInTheDocument();
  });

  it('发送中的消息不给「回复」项（没有服务端 UUID，不能当 reply_to）', () => {
    renderBubble({
      message: makeMessage({ sender_id: 'me', sendStatus: 'sending' }),
      isOwn: true,
      onReply: vi.fn(),
    });

    openContextMenu();
    expect(screen.queryByText('回复')).not.toBeInTheDocument();
    expect(screen.getByText('删除')).toBeInTheDocument();
  });

  it('发送失败的消息不给「回复」项', () => {
    renderBubble({
      message: makeMessage({ sender_id: 'me', sendStatus: 'failed' }),
      isOwn: true,
      onReply: vi.fn(),
    });

    openContextMenu();
    expect(screen.queryByText('回复')).not.toBeInTheDocument();
    expect(screen.getByText('删除')).toBeInTheDocument();
  });
});

describe('MessageBubble（私聊）— 气泡内引用块', () => {
  it('命中原消息：显示被回复者与摘要；点击回传 reply_to（走定位通路）', () => {
    const onQuoteClick = vi.fn();
    renderBubble({
      message: makeMessage({ reply_to: 'orig-uuid' }),
      replyQuote: { senderName: '我', text: '被引用的原文', resolved: true },
      onQuoteClick,
    });

    expect(screen.getByText('我')).toBeInTheDocument();
    expect(screen.getByText('被引用的原文')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '定位到 我 的原消息' }));
    expect(onQuoteClick).toHaveBeenCalledWith('orig-uuid');
  });

  it('非回复消息不渲染引用块', () => {
    renderBubble({ message: makeMessage({ reply_to: null }), replyQuote: null });

    expect(screen.queryByTitle('点击定位到原消息')).not.toBeInTheDocument();
    // 防空断言：气泡本身渲染了
    expect(screen.getByTestId('md')).toBeInTheDocument();
  });

  it('原消息不在已加载窗口：渲染占位文案且仍可点击', () => {
    const onQuoteClick = vi.fn();
    renderBubble({
      message: makeMessage({ reply_to: 'gone-uuid' }),
      replyQuote: { senderName: null, text: REPLY_UNRESOLVED_TEXT, resolved: false },
      onQuoteClick,
    });

    expect(screen.getByText(REPLY_UNRESOLVED_TEXT)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '定位到原消息' }));
    expect(onQuoteClick).toHaveBeenCalledWith('gone-uuid');
  });

  it('点击引用块不会冒泡触发气泡自身的多选切换', () => {
    const onToggleSelect = vi.fn();
    const onQuoteClick = vi.fn();
    renderBubble({
      message: makeMessage({ reply_to: 'orig-uuid' }),
      replyQuote: { senderName: '我', text: '原文', resolved: true },
      onQuoteClick,
      onToggleSelect,
      isMultiSelectMode: true,
    });

    fireEvent.click(screen.getByRole('button', { name: '定位到 我 的原消息' }));

    expect(onQuoteClick).toHaveBeenCalledTimes(1);
    expect(onToggleSelect).not.toHaveBeenCalled();
  });
});

describe('MessageBubble（私聊）— 定位命中高亮', () => {
  it('isHighlighted=true 时气泡带高亮 class，默认不带', () => {
    const { unmount } = renderBubble({ isHighlighted: true });
    expect(document.querySelector('.message-bubble--highlight')).not.toBeNull();
    unmount();

    renderBubble();
    expect(document.querySelector('.message-bubble--highlight')).toBeNull();
  });
});
