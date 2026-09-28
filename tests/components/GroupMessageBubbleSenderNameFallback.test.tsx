/**
 * GroupMessageBubble 发送者名显示回退链（D4 昵称混显收口）
 *
 * 契约（src/utils/senderName.ts + 气泡侧接线）：
 * - 落库昵称/备注优先（groupMemberDisplayName：我设的备注 → 消息携带昵称）
 * - 都缺席 → 回退本地好友资料名（chatStore.friends：备注 → 昵称）
 * - 资料也没有 → 兜底文案「未知用户」
 * - **任何一路都不得裸露 sender_id，也不得渲染空昵称节点**
 *
 * 气泡是纯 props 驱动（store 接线在 GroupChatMessages），store mock 沿用
 * GroupMessageReply.test.tsx 的骨架。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
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

function renderBubble(message: GroupMessage) {
  render(<GroupMessageBubble message={message} isOwn={false} groupId="g-1" />);
  // 单条自成一组，昵称锚点恒显示（showName=true）
  const node = document.querySelector('.bubble-sender-name');
  expect(node).not.toBeNull();
  return node!.textContent;
}

describe('GroupMessageBubble — 发送者名回退链（D4）', () => {
  beforeEach(() => {
    mockChatState.friends = [];
    mockChatState.groupMessageBlocks = {};
    mockChatState.friendBlacklistTimes = {};
    mockChatState.groupMemberRemarks = {};
  });

  it('落库昵称非空 → 原样显示，不被资料覆盖', () => {
    mockChatState.friends = [
      { friend_id: 'user-2', friend_nickname: '李四', friend_remark: '老李' },
    ];
    expect(renderBubble(makeMessage())).toBe('Alice');
  });

  it('昵称空白 + 好友资料有昵称 → 回退资料昵称', () => {
    mockChatState.friends = [
      { friend_id: 'user-2', friend_nickname: '李四', friend_remark: null },
    ];
    expect(renderBubble(makeMessage({ sender_nickname: '' }))).toBe('李四');
  });

  it('昵称空白 + 好友资料有备注 → 备注优先', () => {
    mockChatState.friends = [
      { friend_id: 'user-2', friend_nickname: '李四', friend_remark: '老李' },
    ];
    expect(renderBubble(makeMessage({ sender_nickname: '' }))).toBe('老李');
  });

  it('昵称与资料都缺席 → 兜底「未知用户」，绝不裸露 sender_id', () => {
    const text = renderBubble(makeMessage({ sender_nickname: '' }));
    expect(text).toBe('未知用户');
    expect(text).not.toContain('user-2');
  });

  it('我设的群内备注仍然最优先（与 D7 口径一致，回退链不打乱它）', () => {
    mockChatState.friends = [
      { friend_id: 'user-2', friend_nickname: '李四', friend_remark: '老李' },
    ];
    mockChatState.groupMemberRemarks = { 'g-1': { 'user-2': '我的备注名' } };
    expect(renderBubble(makeMessage({ sender_nickname: '' }))).toBe('我的备注名');
  });
});
