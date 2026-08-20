/**
 * GroupMessageBubble 撤回渲染测试
 *
 * 锁定的契约：当 message.is_recalled === true 时，气泡 **统一渲染** "消息已撤回"
 * 占位文本，与 message_type 无关（text / image / video / file / meeting_invite 全部
 * 走相同分支）。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { GroupMessage } from '../../src/api/groupMessages';

// ============== Mock 重型依赖 ==============
vi.mock('../../src/chat/shared/MessageContextMenu', () => ({
  MessageContextMenu: () => null,
}));

vi.mock('../../src/chat/shared/FileMessageContent', () => ({
  FileMessageContent: ({ messageType }: { messageType: string }) => (
    <div data-testid="file-content" data-type={messageType}>FileContent</div>
  ),
}));

vi.mock('../../src/chat/shared/MeetingInviteCard', () => ({
  MeetingInviteCard: () => <div data-testid="meeting-card">MeetingCard</div>,
}));

vi.mock('../../src/components/common/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown">{content}</div>
  ),
}));

vi.mock('../../src/chat/shared/MobileMessageFullPreview', () => ({
  MobileMessageFullPreview: () => null,
}));

vi.mock('../../src/services/fileCache', () => ({
  getCachedFilePath: vi.fn().mockResolvedValue(null),
}));

// selector-aware mock：让 GroupMessageBubble 的 useChatStore 选择器（friends /
// setChatTarget / groupMessageBlocks / setGroupMemberBlocked）拿到合理空值——
// 关键是 groupMessageBlocks 为空使 isSenderBlocked=false，不误走 D6 屏蔽占位分支。
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
  useProfileViewStore: () => vi.fn(),
}));

// D6：GroupMessageBubble 现在用 useApi 取 ApiClient（右键屏蔽/取消屏蔽），需 mock 掉
vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }),
}));

vi.mock('../../src/utils/platform', () => ({
  isMobile: () => false,
}));

vi.mock('../../src/utils/saveToGallery', () => ({
  saveToGallery: vi.fn(),
}));

vi.mock('../../src/hooks/useFileCache', () => ({
  useFileCache: () => ({
    localPath: null,
    isLocal: false,
  }),
}));

import { GroupMessageBubble } from '../../src/chat/group/GroupMessageBubble';

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

describe('GroupMessageBubble — 撤回状态优先于消息类型分支', () => {
  beforeEach(() => {
    cleanup();
  });

  it('文本消息 + is_recalled=true → 渲染「消息已撤回」', () => {
    const msg = makeMessage({ message_type: 'text', is_recalled: true });
    render(<GroupMessageBubble message={msg} isOwn={false} />);

    expect(document.querySelector('.recalled-message')).toBeInTheDocument();
    expect(document.querySelector('.recalled-message')!.textContent).toContain('消息已撤回');
    expect(document.querySelector('[data-testid="markdown"]')).not.toBeInTheDocument();
  });

  it('Telegram 风格契约：is_recalled=true → 走 .recall-system-row 独立 DOM 分支，不渲染普通气泡/头像，但保留时间戳', () => {
    const msg = makeMessage({ message_type: 'text', is_recalled: true });
    render(<GroupMessageBubble message={msg} isOwn={false} />);

    // 居中系统消息行存在
    expect(document.querySelector('.recall-system-row')).toBeInTheDocument();
    expect(document.querySelector('.recall-system-bubble')).toBeInTheDocument();
    // 不渲染普通气泡容器
    expect(document.querySelector('.message-bubble')).not.toBeInTheDocument();
    // 撤回态不渲染昵称：撤回走的是 .recall-system-row 这条独立分支，整块 .message-bubble
    // 都不存在，昵称自然也不在里面。这条断言在撤回态下不是恒真的——同一份 message 只要
    // is_recalled=false 就会渲染出昵称（见 GroupMessageBubbleSenderName.test.tsx）。
    expect(document.querySelector('.bubble-sender-name')).not.toBeInTheDocument();
    // 不渲染头像
    expect(document.querySelector('.bubble-avatar')).not.toBeInTheDocument();
    // 但保留时间戳
    expect(document.querySelector('.recall-system-time')).toBeInTheDocument();
  });

  it('文件消息 + is_recalled=true → 渲染「消息已撤回」（bug 修复点）', () => {
    const msg = makeMessage({
      message_type: 'file',
      is_recalled: true,
      file_uuid: 'f-1',
      file_size: 1234,
    });
    render(<GroupMessageBubble message={msg} isOwn={false} />);

    expect(document.querySelector('.recalled-message')).toBeInTheDocument();
    expect(document.querySelector('[data-testid="file-content"]')).not.toBeInTheDocument();
  });

  it('图片消息 + is_recalled=true → 渲染「消息已撤回」', () => {
    const msg = makeMessage({
      message_type: 'image',
      is_recalled: true,
      file_uuid: 'img-1',
    });
    render(<GroupMessageBubble message={msg} isOwn={false} />);

    expect(document.querySelector('.recalled-message')).toBeInTheDocument();
    expect(document.querySelector('[data-testid="file-content"]')).not.toBeInTheDocument();
  });

  it('视频消息 + is_recalled=true → 渲染「消息已撤回」', () => {
    const msg = makeMessage({
      message_type: 'video',
      is_recalled: true,
      file_uuid: 'v-1',
    });
    render(<GroupMessageBubble message={msg} isOwn={false} />);

    expect(document.querySelector('.recalled-message')).toBeInTheDocument();
    expect(document.querySelector('[data-testid="file-content"]')).not.toBeInTheDocument();
  });

  it('反向断言：文件消息 + is_recalled=false → 仍然渲染 FileMessageContent', () => {
    const msg = makeMessage({
      message_type: 'file',
      is_recalled: false,
      file_uuid: 'f-2',
    });
    render(<GroupMessageBubble message={msg} isOwn={false} />);

    expect(document.querySelector('.recalled-message')).not.toBeInTheDocument();
    expect(document.querySelector('[data-testid="file-content"]')).toBeInTheDocument();
    expect(document.querySelector('[data-testid="file-content"]')!.getAttribute('data-type')).toBe('file');
  });
});
