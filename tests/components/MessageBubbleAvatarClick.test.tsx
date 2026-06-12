/**
 * MessageBubble (好友) 头像点击测试（本次 UX 重构：私聊点头像看只读资料）
 *
 * 锁定契约：私聊气泡点击头像（非撤回态）统一打开公开资料只读页——
 * - 他人头像 → openProfileView(friend.friend_id)
 * - 自己头像 → openProfileView(session.userId)
 * 两端统一单击（不再有桌面浮窗分支）。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import type { Message, Friend } from '../../src/types/chat';
import type { SessionInfo } from '../../src/components/common/Avatar';
import { useProfileViewStore } from '../../src/stores/profileViewStore';

// ============== Mock 重型依赖 ==============
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
    message_uuid: 'uuid-1', sender_id: 'them', receiver_id: 'me', message_content: 'hello',
    message_type: 'text', file_uuid: null, file_url: null, file_size: null, file_hash: null,
    image_width: null, image_height: null, send_time: '2026-01-01T00:00:00Z', seq: 1,
    is_recalled: false, ...overrides,
  };
}

function clickAvatar() {
  const avatar = document.querySelector('.bubble-avatar')!;
  expect(avatar).toBeInTheDocument();
  fireEvent.click(avatar);
}

describe('MessageBubble (好友) — 头像点击打开只读资料', () => {
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    cleanup();
    useProfileViewStore.setState({ userId: null });
    openSpy = vi.spyOn(useProfileViewStore.getState(), 'open');
  });

  it('点他人头像 → openProfileView(friend.friend_id)', () => {
    render(<MessageBubble message={makeMessage()} isOwn={false} session={session} friend={friend} />);
    clickAvatar();
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('them');
  });

  it('点自己头像 → openProfileView(session.userId)', () => {
    render(<MessageBubble message={makeMessage({ sender_id: 'me', receiver_id: 'them' })} isOwn session={session} friend={friend} />);
    clickAvatar();
    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith('me');
  });
});
