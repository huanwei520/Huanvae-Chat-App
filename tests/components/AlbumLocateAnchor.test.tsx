/**
 * 相册的定位锚点唯一性（私聊 + 群聊两个气泡，配**真实**的 AlbumMessage）
 *
 * 这是 AlbumMessage.test.tsx（只测格子自身）与 AlbumBubble.test.tsx（把 AlbumMessage 整个 mock 掉）
 * 之间的缺口：只有把两者**一起真渲染**，才能验证下面这条唯一性不变量 ——
 *
 *   相册态下，组内每条消息在整棵 DOM 里**恰好有一个** [data-message-uuid] 节点。
 *
 * 为什么这条必须单独守：
 * - 只给格子加锚点、忘了把外层消息行的锚点摘掉 ⇒ 代表消息（index=0）有**两个**同名锚点，
 *   而 scrollMessageIntoView 取 `document.querySelectorAll` 的**首个**命中 = DOM 顺序在前的
 *   外层行 ⇒ 「定位第一张图」仍然居中整块 3×3 网格，位置照旧不准（缺陷 B3 只修掉一半）。
 * - 反过来只摘行、忘了给格子加 ⇒ 整组消息全部无锚点，定位全废。
 * 两个半成品都能让各自那半边的测试全绿，唯有这条端到端的唯一性断言拦得住。
 *
 * ⚠️ 本文件只验**锚点结构**。「滚动落点是否真的把那一格居中」依赖真实布局，
 * jsdom 测不出（见 .claude/rules/frontend-test.md「滚动 / 布局相关行为 vitest 结构性测不出」），
 * 必须真机复核。
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { Friend, Message } from '../../src/types/chat';
import type { GroupMessage } from '../../src/api/groupMessages';

// 只 mock 媒体加载本身（自带 useFileCache / 预签名 URL / Tauri 依赖）；
// AlbumMessage **不 mock** —— 本文件要验的正是它产出的格子锚点。
vi.mock('../../src/chat/shared/FileMessageContent', () => ({
  FileMessageContent: ({ fileUuid }: { fileUuid: string | null }) => (
    <div data-testid="single-media" data-uuid={fileUuid} />
  ),
}));
vi.mock('../../src/chat/shared/MeetingInviteCard', () => ({ MeetingInviteCard: () => null }));
vi.mock('../../src/chat/shared/CardRenderer', () => ({ CardRenderer: () => null }));
vi.mock('../../src/components/common/MarkdownRenderer', () => ({ MarkdownRenderer: () => null }));
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

import { MessageBubble } from '../../src/chat/friend/MessageBubble';
import { GroupMessageBubble } from '../../src/chat/group/GroupMessageBubble';
import type { AlbumMediaItem } from '../../src/chat/shared/AlbumMessage';
import type { AlbumNode } from '../../src/chat/shared/mediaGroup';

const SESSION = {
  userId: 'me',
  profile: { user_nickname: '我', user_avatar_url: '' },
} as unknown as Parameters<typeof MessageBubble>[0]['session'];

const FRIEND = { friend_id: 'peer', friend_nickname: 'Alice', friend_avatar_url: '' } as unknown as Friend;

function albumItem(index: number): AlbumMediaItem {
  return {
    message_uuid: `album-msg-${index}`,
    message_content: '',
    message_type: 'image',
    file_uuid: `f${index}`,
    file_size: 100,
    media_group_index: index,
  };
}

/** 3 张的相册；代表消息 = index 0，它同时也是消息行上那条消息 */
const ALBUM: AlbumNode<AlbumMediaItem> = {
  kind: 'album',
  groupId: 'grp-1',
  items: [albumItem(0), albumItem(1), albumItem(2)],
  expectedCount: 3,
  caption: '',
  isComplete: true,
};

function privateMsg(overrides: Partial<Message> = {}): Message {
  return {
    message_uuid: 'album-msg-0',
    sender_id: 'peer',
    receiver_id: 'me',
    message_content: '',
    message_type: 'image',
    file_uuid: 'f0',
    file_url: null,
    file_size: 100,
    reply_to: null,
    send_time: '2026-01-01T00:00:00Z',
    is_recalled: false,
    ...overrides,
  };
}

function groupMsg(overrides: Partial<GroupMessage> = {}): GroupMessage {
  return {
    message_uuid: 'album-msg-0',
    group_id: 'g-1',
    sender_id: 'other',
    sender_nickname: 'Alice',
    sender_avatar_url: '',
    message_content: '',
    message_type: 'image',
    file_uuid: 'f0',
    file_url: null,
    file_size: 100,
    image_width: null,
    image_height: null,
    reply_to: null,
    send_time: '2026-01-01T00:00:00Z',
    is_recalled: false,
    seq: 1,
    ...overrides,
  };
}

/** 整棵 DOM 里所有锚点的 uuid（按 DOM 顺序，与 scrollMessageIntoView 的取首个命中同序） */
function anchors(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-message-uuid]'))
    .map((el) => el.dataset.messageUuid ?? '');
}

describe.each([
  [
    '私聊气泡',
    (album?: AlbumNode<AlbumMediaItem>) => (
      <MessageBubble
        message={privateMsg()}
        isOwn={false}
        session={SESSION}
        friend={FRIEND}
        album={album ?? null}
      />
    ),
  ],
  [
    '群聊气泡',
    (album?: AlbumNode<AlbumMediaItem>) => (
      <GroupMessageBubble message={groupMsg()} isOwn={false} groupId="g-1" album={album ?? null} />
    ),
  ],
] as const)('%s — 相册定位锚点', (_label, renderBubble) => {
  it('组内每条消息各有且仅有一个锚点（代表消息不得同时出现在行上和格子里）', () => {
    const { container } = render(renderBubble(ALBUM));

    // 顺序 = 组内位次；数量 = 组员数，一条不多一条不少
    expect(anchors(container)).toEqual(['album-msg-0', 'album-msg-1', 'album-msg-2']);
  });

  it('相册态下消息行本身不带锚点（否则代表消息的定位会落到整块网格上）', () => {
    const { container } = render(renderBubble(ALBUM));

    const row = container.querySelector('.message-row');
    expect(row).not.toBeNull();
    expect(row!.hasAttribute('data-message-uuid')).toBe(false);
  });

  it('锚点全部落在相册格子上（滚动落点按单格矩形算，不是整块网格）', () => {
    const { container } = render(renderBubble(ALBUM));

    const anchored = Array.from(container.querySelectorAll('[data-message-uuid]'));
    expect(anchored).toHaveLength(3);
    anchored.forEach((el) => expect(el.classList.contains('album-cell')).toBe(true));
  });

  it('非相册消息（album 为空）：锚点仍在消息行上，原行为一点没变', () => {
    const { container } = render(renderBubble(undefined));

    expect(anchors(container)).toEqual(['album-msg-0']);
    const row = container.querySelector('.message-row');
    expect(row!.getAttribute('data-message-uuid')).toBe('album-msg-0');
    // 且没有任何格子（没折叠就不该有网格）
    expect(container.querySelector('.album-cell')).toBeNull();
  });
});
