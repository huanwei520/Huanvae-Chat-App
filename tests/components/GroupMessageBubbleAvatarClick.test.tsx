/**
 * GroupMessageBubble 头像单击/双击路由测试（本次 UX 重构核心交互）
 *
 * 锁定契约：群成员头像（非撤回态）——
 * - 单击 → openProfileView(sender_id) 看公开资料（所有人，含自己）
 * - 双击 → 好友：setChatTarget 进私聊；非好友/自己：回退看资料（无私聊）
 * 用 250ms 计时器区分单/双击，避免双击时先误触发单击看资料。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
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
  friendBlacklistTimes: {} as Record<string, string>,
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

function avatarEl() {
  const avatar = document.querySelector('.bubble-avatar')!;
  expect(avatar).toBeInTheDocument();
  return avatar;
}

describe('GroupMessageBubble — 头像单击看资料 / 双击进私聊', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setChatTargetSpy.mockReset();
    openProfileViewSpy.mockReset();
    mockChatState.friends = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('单击 → openProfileView 看资料，不进私聊（好友也是）', () => {
    mockChatState.friends = [makeFriend('user-2')];
    render(<GroupMessageBubble message={makeMessage({ sender_id: 'user-2' })} isOwn={false} />);
    fireEvent.click(avatarEl());
    // 计时窗口结束后判定单击
    act(() => { vi.advanceTimersByTime(260); });
    expect(openProfileViewSpy).toHaveBeenCalledTimes(1);
    expect(openProfileViewSpy).toHaveBeenCalledWith('user-2');
    expect(setChatTargetSpy).not.toHaveBeenCalled();
  });

  it('双击好友 → setChatTarget 进私聊，不看资料', () => {
    mockChatState.friends = [makeFriend('user-2')];
    render(<GroupMessageBubble message={makeMessage({ sender_id: 'user-2' })} isOwn={false} />);
    const avatar = avatarEl();
    fireEvent.click(avatar);
    fireEvent.click(avatar); // 计时窗口内第二击 → 双击
    expect(setChatTargetSpy).toHaveBeenCalledTimes(1);
    expect(setChatTargetSpy).toHaveBeenCalledWith({ type: 'friend', data: makeFriend('user-2') });
    // 双击应取消单击看资料
    act(() => { vi.advanceTimersByTime(260); });
    expect(openProfileViewSpy).not.toHaveBeenCalled();
  });

  it('双击非好友 → 回退看资料，不进私聊', () => {
    mockChatState.friends = []; // sender 非好友
    render(<GroupMessageBubble message={makeMessage({ sender_id: 'stranger-9' })} isOwn={false} />);
    const avatar = avatarEl();
    fireEvent.click(avatar);
    fireEvent.click(avatar);
    expect(openProfileViewSpy).toHaveBeenCalledTimes(1);
    expect(openProfileViewSpy).toHaveBeenCalledWith('stranger-9');
    expect(setChatTargetSpy).not.toHaveBeenCalled();
  });

  it('单击自己头像 → openProfileView 看自己资料', () => {
    render(<GroupMessageBubble message={makeMessage({ sender_id: 'me' })} isOwn />);
    fireEvent.click(avatarEl());
    act(() => { vi.advanceTimersByTime(260); });
    expect(openProfileViewSpy).toHaveBeenCalledWith('me');
    expect(setChatTargetSpy).not.toHaveBeenCalled();
  });
});
