/**
 * MessageBubble (好友) 拉黑未送达红叹号标记测试
 *
 * 锁定契约：我发出的消息若 seq=0（拉黑关系下被后端静默丢弃 D5），气泡左侧显示红叹号
 * （.bubble-undelivered）。仅 own + seq=0 + 非 sending/failed 才显示；对方消息、
 * 正常 seq>0、发送中、发送失败均不显示。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { Message, Friend } from '../../src/types/chat';
import type { SessionInfo } from '../../src/components/common/Avatar';

// ============== Mock 重型依赖 ==============
// （这块 mock 原是从 tests/components/MessageBubbleAvatarClick.test.tsx 抄来的，
//   那个文件已随 17e1c5a「1:1 头像移顶栏」整块删除 —— 别再照那个路径去找模板，
//   现存的同款样板在 tests/components/GroupMessageBubbleSenderName.test.tsx。）
vi.mock('../../src/chat/shared/MessageContextMenu', () => ({ MessageContextMenu: () => null }));
vi.mock('../../src/chat/shared/FileMessageContent', () => ({ FileMessageContent: () => null }));
vi.mock('../../src/chat/shared/MeetingInviteCard', () => ({ MeetingInviteCard: () => null }));
vi.mock('../../src/components/common/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock('../../src/chat/shared/MobileMessageFullPreview', () => ({ MobileMessageFullPreview: () => null }));
vi.mock('../../src/services/fileCache', () => ({ getCachedFilePath: vi.fn().mockResolvedValue(null) }));
vi.mock('../../src/utils/platform', () => ({ isMobile: () => false }));
vi.mock('../../src/utils/saveToGallery', () => ({ saveToGallery: vi.fn() }));
vi.mock('../../src/components/common/Avatar', () => ({
  UserAvatar: () => <div data-testid="user-avatar" />,
  FriendAvatar: () => <div data-testid="friend-avatar" />,
}));
vi.mock('../../src/hooks/useFileCache', () => ({ useFileCache: () => ({ localPath: null, isLocal: false }) }));

import { MessageBubble } from '../../src/chat/friend/MessageBubble';

const session: SessionInfo & { userId: string } = {
  serverUrl: 'http://test', userId: 'me', accessToken: 't', refreshToken: 'r',
  profile: {
    user_id: 'me', user_nickname: 'Me', user_email: null, user_signature: null,
    user_avatar_url: null, admin: 'false', created_at: '', updated_at: '',
  },
  avatarPath: null,
} as never;

const friend: Friend = {
  friend_id: 'them', friend_nickname: 'Them', friend_email: null, friend_signature: null,
  friend_avatar_url: null, add_time: '2026-01-01T00:00:00Z',
} as never;

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    message_uuid: 'uuid-1', sender_id: 'me', receiver_id: 'them', message_content: 'hello',
    message_type: 'text', file_uuid: null, file_url: null, file_size: null, image_width: null, image_height: null, send_time: '2026-01-01T00:00:00Z', seq: 5,
    is_recalled: false, ...overrides,
  };
}

function hasMark() {
  return document.querySelector('.bubble-undelivered') !== null;
}

describe('MessageBubble (好友) — 拉黑未送达红叹号', () => {
  beforeEach(() => cleanup());

  it('我发出 + seq=0（已发送态）→ 显示红叹号', () => {
    render(<MessageBubble message={makeMessage({ seq: 0 })} isOwn session={session} friend={friend} />);
    expect(hasMark()).toBe(true);
  });

  it('我发出 + seq>0（正常送达）→ 不显示', () => {
    render(<MessageBubble message={makeMessage({ seq: 7 })} isOwn session={session} friend={friend} />);
    expect(hasMark()).toBe(false);
  });

  it('我发出 + seq=undefined（WS 缺序号/未回写）→ 不显示（undefined≠未送达，仅 seq===0 才标）', () => {
    render(<MessageBubble message={makeMessage({ seq: undefined })} isOwn session={session} friend={friend} />);
    expect(hasMark()).toBe(false);
  });

  it('对方的消息 + seq=0 → 不显示（仅标自己发出的）', () => {
    render(<MessageBubble message={makeMessage({ seq: 0, sender_id: 'them', receiver_id: 'me' })} isOwn={false} session={session} friend={friend} />);
    expect(hasMark()).toBe(false);
  });

  it('我发出 + seq=0 + 发送中 → 不显示（发送中显示时钟）', () => {
    render(<MessageBubble message={makeMessage({ seq: 0, sendStatus: 'sending' })} isOwn session={session} friend={friend} />);
    expect(hasMark()).toBe(false);
  });

  it('我发出 + seq=0 + 发送失败 → 不显示（失败有独立失败图标）', () => {
    render(<MessageBubble message={makeMessage({ seq: 0, sendStatus: 'failed' })} isOwn session={session} friend={friend} />);
    expect(hasMark()).toBe(false);
  });
});
