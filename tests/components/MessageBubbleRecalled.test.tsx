/**
 * MessageBubble (好友聊天) 撤回渲染测试
 *
 * 与 GroupMessageBubbleRecalled.test.tsx 镜像。锁定的契约：
 * 当 message.is_recalled === true 时，气泡 **统一渲染** "消息已撤回" 占位文本，
 * 与 message_type 无关（text / image / video / file / meeting_invite 全部走相同分支）。
 *
 * 这是好友侧 useLocalFriendMessages.handleMessageRecalled 修复 + 自撤回路径切到
 * markMessageRecalled 的 UI 端契约屏障：只要 hook / DB 把 is_recalled 翻为 true，
 * 气泡必定渲染撤回占位，不会再"依旧显示文件内容"。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { Message, Friend } from '../../src/types/chat';
import type { SessionInfo } from '../../src/components/common/Avatar';

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

vi.mock('../../src/chat/shared/UserProfilePopup', () => ({
  UserProfilePopup: () => null,
}));

vi.mock('../../src/chat/shared/MobileMessageFullPreview', () => ({
  MobileMessageFullPreview: () => null,
}));

vi.mock('../../src/services/fileCache', () => ({
  getCachedFilePath: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/utils/platform', () => ({
  isMobile: () => false,
}));

vi.mock('../../src/utils/saveToGallery', () => ({
  saveToGallery: vi.fn(),
}));

vi.mock('../../src/components/common/Avatar', () => ({
  UserAvatar: () => <div data-testid="user-avatar" />,
  FriendAvatar: () => <div data-testid="friend-avatar" />,
}));

vi.mock('../../src/hooks/useFileCache', () => ({
  useFileCache: () => ({
    localPath: null,
    isLocal: false,
  }),
}));

import { MessageBubble } from '../../src/chat/friend/MessageBubble';

const session: SessionInfo & { userId: string } = {
  serverUrl: 'http://test',
  userId: 'me',
  accessToken: 't',
  refreshToken: 'r',
  profile: {
    user_id: 'me',
    user_nickname: 'Me',
    user_email: null,
    user_signature: null,
    user_avatar_url: null,
    admin: 'false',
    created_at: '',
    updated_at: '',
  },
  avatarPath: null,
} as never;

const friend: Friend = {
  friend_id: 'them',
  friend_nickname: 'Them',
  friend_email: null,
  friend_signature: null,
  friend_avatar_url: null,
  add_time: '2026-01-01T00:00:00Z',
} as never;

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    message_uuid: 'uuid-1',
    sender_id: 'them',
    receiver_id: 'me',
    message_content: 'hello',
    message_type: 'text',
    file_uuid: null,
    file_url: null,
    file_size: null,
    file_hash: null,
    image_width: null,
    image_height: null,
    send_time: '2026-01-01T00:00:00Z',
    seq: 1,
    is_recalled: false,
    ...overrides,
  };
}

describe('MessageBubble (好友) — 撤回状态优先于消息类型分支', () => {
  beforeEach(() => {
    cleanup();
  });

  it('文本消息 + is_recalled=true → 渲染「消息已撤回」，不渲染 markdown', () => {
    const msg = makeMessage({ message_type: 'text', is_recalled: true });
    render(<MessageBubble message={msg} isOwn={false} session={session} friend={friend} />);

    expect(document.querySelector('.recalled-message')).toBeInTheDocument();
    expect(document.querySelector('.recalled-message')!.textContent).toContain('消息已撤回');
    expect(document.querySelector('[data-testid="markdown"]')).not.toBeInTheDocument();
  });

  it('Telegram 风格契约：is_recalled=true → 走 .recall-system-row 独立 DOM 分支，不渲染头像/普通气泡容器，但保留时间戳', () => {
    const msg = makeMessage({ message_type: 'text', is_recalled: true });
    render(<MessageBubble message={msg} isOwn={false} session={session} friend={friend} />);

    // 居中系统消息行存在（独立 DOM，不嵌入 .message-bubble）
    expect(document.querySelector('.recall-system-row')).toBeInTheDocument();
    expect(document.querySelector('.recall-system-bubble')).toBeInTheDocument();
    // 不渲染普通气泡容器（无 own/other 对齐 + 无右键菜单 hook）
    expect(document.querySelector('.message-bubble')).not.toBeInTheDocument();
    // 不渲染头像
    expect(document.querySelector('[data-testid="user-avatar"]')).not.toBeInTheDocument();
    expect(document.querySelector('[data-testid="friend-avatar"]')).not.toBeInTheDocument();
    expect(document.querySelector('.bubble-avatar')).not.toBeInTheDocument();
    // 但保留时间戳
    expect(document.querySelector('.recall-system-time')).toBeInTheDocument();
  });

  it('文件消息 + is_recalled=true → 渲染「消息已撤回」，不渲染 FileMessageContent（这就是 bug 修复点）', () => {
    const msg = makeMessage({
      message_type: 'file',
      is_recalled: true,
      file_uuid: 'f-1',
      file_size: 1234,
      file_hash: 'h-1',
    });
    render(<MessageBubble message={msg} isOwn={false} session={session} friend={friend} />);

    expect(document.querySelector('.recalled-message')).toBeInTheDocument();
    expect(document.querySelector('[data-testid="file-content"]')).not.toBeInTheDocument();
  });

  it('图片消息 + is_recalled=true → 渲染「消息已撤回」', () => {
    const msg = makeMessage({
      message_type: 'image',
      is_recalled: true,
      file_uuid: 'img-1',
    });
    render(<MessageBubble message={msg} isOwn={false} session={session} friend={friend} />);

    expect(document.querySelector('.recalled-message')).toBeInTheDocument();
    expect(document.querySelector('[data-testid="file-content"]')).not.toBeInTheDocument();
  });

  it('视频消息 + is_recalled=true → 渲染「消息已撤回」', () => {
    const msg = makeMessage({
      message_type: 'video',
      is_recalled: true,
      file_uuid: 'v-1',
    });
    render(<MessageBubble message={msg} isOwn={false} session={session} friend={friend} />);

    expect(document.querySelector('.recalled-message')).toBeInTheDocument();
    expect(document.querySelector('[data-testid="file-content"]')).not.toBeInTheDocument();
  });

  it('反向断言：文件消息 + is_recalled=false → 仍然渲染 FileMessageContent', () => {
    const msg = makeMessage({
      message_type: 'file',
      is_recalled: false,
      file_uuid: 'f-2',
    });
    render(<MessageBubble message={msg} isOwn={false} session={session} friend={friend} />);

    expect(document.querySelector('.recalled-message')).not.toBeInTheDocument();
    expect(document.querySelector('[data-testid="file-content"]')).toBeInTheDocument();
    expect(document.querySelector('[data-testid="file-content"]')!.getAttribute('data-type')).toBe('file');
  });
});
