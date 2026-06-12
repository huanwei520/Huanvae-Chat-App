/**
 * GroupMessageBubble 好友拉黑 → 群消息折叠测试
 *
 * 锁定契约：发送者是我拉黑的好友时，其群消息折叠成占位「已拉黑此人消息」（前端折叠，
 * 取消拉黑后随 store 恢复）。与 D6 群屏蔽独立：群屏蔽折叠为「已屏蔽此人消息」。
 * own 消息永不折叠；普通成员正常渲染内容。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { GroupMessage } from '../../src/api/groupMessages';
import type { Friend } from '../../src/types/chat';

vi.mock('../../src/chat/shared/MessageContextMenu', () => ({ MessageContextMenu: () => null }));
vi.mock('../../src/chat/shared/FileMessageContent', () => ({ FileMessageContent: () => null }));
vi.mock('../../src/chat/shared/MeetingInviteCard', () => ({ MeetingInviteCard: () => null }));
vi.mock('../../src/components/common/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}));
vi.mock('../../src/chat/shared/MobileMessageFullPreview', () => ({ MobileMessageFullPreview: () => null }));
vi.mock('../../src/services/fileCache', () => ({ getCachedFilePath: vi.fn().mockResolvedValue(null) }));
vi.mock('../../src/contexts/SessionContext', () => ({ useApi: () => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }) }));
vi.mock('../../src/utils/platform', () => ({ isMobile: () => false }));
vi.mock('../../src/utils/saveToGallery', () => ({ saveToGallery: vi.fn() }));
vi.mock('../../src/hooks/useFileCache', () => ({ useFileCache: () => ({ localPath: null, isLocal: false }) }));

const mockChatState = vi.hoisted(() => ({
  friends: [] as Friend[],
  setChatTarget: () => {},
  groupMessageBlocks: {} as Record<string, string[]>,
  setGroupMemberBlocked: () => {},
  groupSpecialCares: {} as Record<string, string[]>,
  setGroupMemberSpecialCare: () => {},
  groupMemberRemarks: {} as Record<string, Record<string, string>>,
  setGroupMemberRemark: () => {},
}));
vi.mock('../../src/stores', () => ({
  useChatStore: (selector: (s: typeof mockChatState) => unknown) => selector(mockChatState),
  useProfileViewStore: (selector: (s: { open: () => void }) => unknown) => selector({ open: () => {} }),
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

function blacklistedFriend(id: string): Friend {
  return {
    friend_id: id, friend_nickname: `nick_${id}`, friend_avatar_url: null,
    add_time: '', approve_reason: null, friend_remark: null,
    is_blacklisted: true, is_special_care: false,
  };
}

const placeholder = () => document.querySelector('.bubble-blocked-placeholder');

describe('GroupMessageBubble — 好友拉黑折叠群消息', () => {
  beforeEach(() => {
    cleanup();
    mockChatState.friends = [];
    mockChatState.groupMessageBlocks = {};
  });

  it('发送者是我拉黑的好友 → 折叠为「已拉黑此人消息」，不渲染内容', () => {
    mockChatState.friends = [blacklistedFriend('user-2')];
    render(<GroupMessageBubble message={makeMessage({ sender_id: 'user-2' })} isOwn={false} />);
    expect(placeholder()).toBeInTheDocument();
    expect(placeholder()!.textContent).toContain('已拉黑此人消息');
    expect(document.querySelector('[data-testid="md"]')).not.toBeInTheDocument();
  });

  it('发送者非拉黑好友 → 正常渲染内容，不折叠', () => {
    mockChatState.friends = [];
    render(<GroupMessageBubble message={makeMessage({ sender_id: 'user-9' })} isOwn={false} />);
    expect(placeholder()).toBeNull();
    expect(document.querySelector('[data-testid="md"]')!.textContent).toBe('hello');
  });

  it('D6 群屏蔽仍折叠为「已屏蔽此人消息」（与拉黑独立）', () => {
    mockChatState.groupMessageBlocks = { 'g-1': ['user-2'] };
    render(<GroupMessageBubble message={makeMessage({ sender_id: 'user-2' })} isOwn={false} groupId="g-1" />);
    expect(placeholder()!.textContent).toContain('已屏蔽此人消息');
  });

  it('自己的消息即使在黑名单(异常态)也不折叠', () => {
    mockChatState.friends = [blacklistedFriend('me')];
    render(<GroupMessageBubble message={makeMessage({ sender_id: 'me' })} isOwn />);
    expect(placeholder()).toBeNull();
  });
});
