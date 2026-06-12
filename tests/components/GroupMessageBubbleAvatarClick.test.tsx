/**
 * GroupMessageBubble 头像点击路由测试（本次 UX 重构核心交互）
 *
 * 锁定契约：点击群成员头像（非撤回态）——
 * - isOwn（自己）→ openProfileView(自己 id)，不进私聊
 * - 他人且是好友 → setChatTarget({type:'friend', data: friend}) 进私聊，不开资料页
 * - 他人非好友 → openProfileView(sender_id) 看公开资料，不进私聊
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import type { GroupMessage } from '../../src/api/groupMessages';
import type { Friend } from '../../src/types/chat';

// ============== Mock 重型依赖 ==============
vi.mock('../../src/chat/shared/MessageContextMenu', () => ({ MessageContextMenu: () => null }));
vi.mock('../../src/chat/shared/FileMessageContent', () => ({ FileMessageContent: () => null }));
vi.mock('../../src/chat/shared/MeetingInviteCard', () => ({ MeetingInviteCard: () => null }));
vi.mock('../../src/components/common/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock('../../src/chat/shared/MobileMessageFullPreview', () => ({ MobileMessageFullPreview: () => null }));
vi.mock('../../src/services/fileCache', () => ({ getCachedFilePath: vi.fn().mockResolvedValue(null) }));
vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }),
}));
vi.mock('../../src/utils/platform', () => ({ isMobile: () => false }));
vi.mock('../../src/utils/saveToGallery', () => ({ saveToGallery: vi.fn() }));
vi.mock('../../src/hooks/useFileCache', () => ({ useFileCache: () => ({ localPath: null, isLocal: false }) }));

// 可控的 store mock：friends 可按用例调整，setChatTarget / openProfileView 为可断言 spy
const setChatTargetSpy = vi.hoisted(() => vi.fn());
const openProfileViewSpy = vi.hoisted(() => vi.fn());
const mockChatState = vi.hoisted(() => ({
  friends: [] as Friend[],
  setChatTarget: setChatTargetSpy,
  groupMessageBlocks: {} as Record<string, string[]>,
  setGroupMemberBlocked: () => {},
  groupSpecialCares: {} as Record<string, string[]>,
  setGroupMemberSpecialCare: () => {},
  groupMemberRemarks: {} as Record<string, Record<string, string>>,
  setGroupMemberRemark: () => {},
}));
vi.mock('../../src/stores', () => ({
  useChatStore: (selector: (s: typeof mockChatState) => unknown) => selector(mockChatState),
  useProfileViewStore: (selector: (s: { open: typeof openProfileViewSpy }) => unknown) =>
    selector({ open: openProfileViewSpy }),
}));

import { GroupMessageBubble } from '../../src/chat/group/GroupMessageBubble';

function makeMessage(overrides: Partial<GroupMessage> = {}): GroupMessage {
  return {
    message_uuid: 'uuid-1', group_id: 'g-1', sender_id: 'user-2', sender_nickname: 'Alice',
    sender_avatar_url: '', message_content: 'hello', message_type: 'text',
    file_uuid: null, file_url: null, file_size: null, file_hash: null,
    image_width: null, image_height: null, reply_to: null,
    send_time: '2026-01-01T00:00:00Z', is_recalled: false, seq: 1, ...overrides,
  };
}

function makeFriend(id: string): Friend {
  return {
    friend_id: id, friend_nickname: `nick_${id}`, friend_avatar_url: null,
    add_time: '', approve_reason: null, friend_remark: null,
    is_blacklisted: false, is_special_care: false,
  };
}

function clickAvatar() {
  const avatar = document.querySelector('.bubble-avatar')!;
  expect(avatar).toBeInTheDocument();
  fireEvent.click(avatar);
}

describe('GroupMessageBubble — 头像点击路由', () => {
  beforeEach(() => {
    cleanup();
    setChatTargetSpy.mockReset();
    openProfileViewSpy.mockReset();
    mockChatState.friends = [];
  });

  it('他人且是好友 → setChatTarget 进私聊，不开资料页', () => {
    mockChatState.friends = [makeFriend('user-2')];
    render(<GroupMessageBubble message={makeMessage({ sender_id: 'user-2' })} isOwn={false} />);
    clickAvatar();
    expect(setChatTargetSpy).toHaveBeenCalledTimes(1);
    expect(setChatTargetSpy).toHaveBeenCalledWith({ type: 'friend', data: makeFriend('user-2') });
    expect(openProfileViewSpy).not.toHaveBeenCalled();
  });

  it('他人非好友 → openProfileView 看资料，不进私聊', () => {
    mockChatState.friends = []; // sender 不在好友列表
    render(<GroupMessageBubble message={makeMessage({ sender_id: 'stranger-9' })} isOwn={false} />);
    clickAvatar();
    expect(openProfileViewSpy).toHaveBeenCalledTimes(1);
    expect(openProfileViewSpy).toHaveBeenCalledWith('stranger-9');
    expect(setChatTargetSpy).not.toHaveBeenCalled();
  });

  it('自己的头像 → openProfileView 看自己资料，不进私聊', () => {
    render(<GroupMessageBubble message={makeMessage({ sender_id: 'me' })} isOwn />);
    clickAvatar();
    expect(openProfileViewSpy).toHaveBeenCalledWith('me');
    expect(setChatTargetSpy).not.toHaveBeenCalled();
  });
});
