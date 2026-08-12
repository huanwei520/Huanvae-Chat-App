/**
 * 已读标记的两条显示口径 —— 列表级真渲染验收（私聊 + 群聊）
 *
 * 口径（huanwei 2026-08-12）：
 * 1. **只挂我发出的最新一条**：更早的自己消息一律不出现已读标记；
 * 2. **没人读过时隐藏**：私聊 isRead=false ⇒ 不渲染（不再是灰色双勾）；
 *    群聊 readers=0 ⇒ 文案为 null ⇒ 不渲染（不再是"0 人已读"）。
 *
 * 为什么必须在**列表**层测而不是只测气泡/纯函数：门控就落在 ChatMessages /
 * GroupChatMessages 的 map 之外那一步（latestOwnReceiptUuid 锚点比对）。只渲染单个气泡
 * 或只测纯函数，都会让"列表忘了接门控"这类回归静默溜过去（见 .claude/rules/frontend-test.md
 * 「拒绝假测试」）。这里渲染**真列表 + 真气泡 + 真 hook**，只把叶子（Markdown/文件/头像缓存等）
 * 与 Tauri 侧（db / api / ws / sync）替身掉。
 *
 * 桌面与移动端复用同一份 ChatMessages / GroupChatMessages（ChatPanel 与 MobileChatView 各自
 * 渲染它们），故这里验一次即两端同时生效；两端**布局**差异（标记是否被样式挤掉）jsdom 测不出，
 * 需真机复核。
 */

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

import type { Friend, Message } from '../../src/types/chat';
import type { GroupMessage } from '../../src/api/groupMessages';

/**
 * 每条用例的超时预算（全局 testTimeout=10s 对本文件不够用）。
 * 这里一条用例要挂起整条真实链路（列表 + 3 个真气泡 + 已读 hook 的异步 db 校准），
 * 且本仓工作树在共享盘上（模块 transform/import 实测比本地盘慢一个量级）——
 * 首条用例在冷模块态下实测超过 10s。放宽的只是**等待预算**，断言一个没弱化；
 * 真正"标记没出现"会在 waitFor 的 asyncUtilTimeout（setup.ts 配的 5s）就报断言失败，
 * 不会被这个更大的数字掩盖。
 */
const HEAVY_RENDER_TIMEOUT_MS = 30000;

// ---- 叶子替身（与 FriendMessageReply / GroupMessageReply 同款骨架） ----
// setup.ts 的 @tauri-apps/api/core 替身没有 convertFileSrc，而这里会渲染**自己**的消息 ⇒
// 走 UserAvatar（tests/components/SidebarPinned.test.tsx 同款处置），故整份补齐再覆盖一次。
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
  Channel: class {
    onmessage: ((msg: unknown) => void) | null = null;
    id = 1;
  },
}));
vi.mock('../../src/utils/platform', () => ({ isMobile: () => false }));
vi.mock('../../src/chat/shared/FileMessageContent', () => ({ FileMessageContent: () => null }));
vi.mock('../../src/chat/shared/MeetingInviteCard', () => ({ MeetingInviteCard: () => null }));
vi.mock('../../src/chat/shared/CardRenderer', () => ({ CardRenderer: () => null }));
vi.mock('../../src/components/common/MarkdownRenderer', () => ({
  MarkdownRenderer: ({ content }: { content: string }) => <div>{content}</div>,
}));
vi.mock('../../src/chat/shared/MobileMessageFullPreview', () => ({ MobileMessageFullPreview: () => null }));
vi.mock('../../src/chat/group/GroupRemarkInputModal', () => ({ GroupRemarkInputModal: () => null }));
vi.mock('../../src/hooks/useFileCache', () => ({ useFileCache: () => ({ localPath: null, isLocal: false }) }));
vi.mock('../../src/utils/saveToGallery', () => ({ saveToGallery: vi.fn() }));
vi.mock('../../src/services/fileCache', () => ({ getCachedFilePath: vi.fn().mockResolvedValue(null) }));
vi.mock('../../src/utils/avatar', () => ({
  resolveServerAvatarUrl: (u: string | null | undefined) => u ?? null,
}));

// ---- context 替身：返回值必须引用稳定（见 frontend-test.md「mock context hook 的返回值必须引用稳定」）----
const sessionMock = vi.hoisted(() => ({ session: { userId: 'me' } }));
const apiMock = vi.hoisted(() => ({ api: {} as Record<string, unknown> }));
vi.mock('../../src/contexts/SessionContext', () => ({
  useApi: () => apiMock.api,
  useSession: () => sessionMock,
}));
const wsMock = vi.hoisted(() => ({ ws: { onReadSync: () => () => {} } }));
vi.mock('../../src/contexts/WebSocketContext', () => ({ useWebSocket: () => wsMock.ws }));

// ---- 本地 db / 服务端 / sync 替身：已读位置的唯一数据源，用它拨"读到哪"----
const dbState = vi.hoisted(() => ({
  peerSeq: 0,
  groupRows: [] as Array<Record<string, unknown>>,
}));
vi.mock('../../src/db', () => ({
  getConversationPeerReadSeq: vi.fn(async () => dbState.peerSeq),
  setConversationPeerReadSeq: vi.fn(async () => undefined),
  getGroupReadPositions: vi.fn(async () => dbState.groupRows),
  upsertGroupReadPositions: vi.fn(async () => undefined),
  replaceGroupReadPositions: vi.fn(async () => undefined),
}));
vi.mock('../../src/services/syncService', () => ({ subscribeReadPositions: () => () => {} }));
vi.mock('../../src/api/groups', () => ({
  getGroupReadPositions: vi.fn(async () => ({ positions: [], member_count: 0 })),
  addGroupMessageBlock: vi.fn(),
  removeGroupMessageBlock: vi.fn(),
  addGroupSpecialCare: vi.fn(),
  removeGroupSpecialCare: vi.fn(),
  setGroupMemberRemark: vi.fn(),
  removeGroupMemberRemark: vi.fn(),
}));

// ---- store 替身：'../../stores'（列表/气泡）与 '../../stores/chatStore'（两个已读 hook）两条 specifier ----
const chatState = vi.hoisted(() => ({
  setReplyDraft: vi.fn(),
  setPendingScrollToMessageId: vi.fn(),
  highlightedMessageId: null as string | null,
  friends: [] as unknown[],
  setChatTarget: vi.fn(),
  friendBlacklistTimes: {} as Record<string, string>,
  groupMessageBlocks: {} as Record<string, string[]>,
  setGroupMemberBlocked: vi.fn(),
  groupSpecialCares: {} as Record<string, string[]>,
  setGroupMemberSpecialCare: vi.fn(),
  groupMemberRemarks: {} as Record<string, Record<string, string>>,
  setGroupMemberRemark: vi.fn(),
  cachedFriendReadPositions: {} as Record<string, number>,
  cacheFriendReadPositions: vi.fn(),
  cachedGroupReadPositions: {} as Record<string, unknown>,
  cacheGroupReadPositions: vi.fn(),
}));
/** 两条 specifier 各建一个同状态的 hook 替身（工厂在 mock 时执行，chatState 已由 vi.hoisted 就位） */
vi.mock('../../src/stores/chatStore', () => ({
  useChatStore: Object.assign(
    (selector: (s: typeof chatState) => unknown) => selector(chatState),
    { getState: () => chatState },
  ),
}));
vi.mock('../../src/stores', () => ({
  useChatStore: Object.assign(
    (selector: (s: typeof chatState) => unknown) => selector(chatState),
    { getState: () => chatState },
  ),
  useProfileViewStore: (selector: (s: { open: () => void }) => unknown) => selector({ open: () => {} }),
}));

import { ChatMessages } from '../../src/chat/friend/ChatMessages';
import { GroupChatMessages } from '../../src/chat/group/GroupChatMessages';

const SESSION = {
  userId: 'me',
  profile: { user_nickname: '我', user_avatar_url: '' },
} as unknown as Parameters<typeof ChatMessages>[0]['session'];

const FRIEND = {
  friend_id: 'peer',
  friend_nickname: 'Alice',
  friend_avatar_url: '',
} as unknown as Friend;

/** 私聊消息：默认自己发出、已送达 */
function friendMsg(uuid: string, content: string, seq: number, over: Partial<Message> = {}): Message {
  return {
    message_uuid: uuid,
    sender_id: 'me',
    receiver_id: 'peer',
    message_content: content,
    message_type: 'text',
    file_uuid: null,
    file_url: null,
    file_size: null,
    file_hash: null,
    reply_to: null,
    send_time: `2026-01-01T00:0${seq}:00Z`,
    is_recalled: false,
    seq,
    ...over,
  };
}

/** 群消息：默认自己发出、已送达 */
function groupMsg(uuid: string, content: string, seq: number, over: Partial<GroupMessage> = {}): GroupMessage {
  return {
    message_uuid: uuid,
    group_id: 'g-1',
    sender_id: 'me',
    sender_nickname: '我',
    sender_avatar_url: '',
    message_content: content,
    message_type: 'text',
    file_uuid: null,
    file_url: null,
    file_size: null,
    file_hash: null,
    image_width: null,
    image_height: null,
    reply_to: null,
    send_time: `2026-01-01T00:0${seq}:00Z`,
    is_recalled: false,
    seq,
    ...over,
  };
}

/** 群已读位置行（本地 db 形状） */
function posRow(userId: string, lastReadSeq: number) {
  return {
    group_id: 'g-1',
    user_id: userId,
    last_read_seq: lastReadSeq,
    display_name: userId,
    avatar_url: null,
    last_read_at: '2026-01-01T00:10:00Z',
  };
}

/** 标记所在气泡的正文（用于断言"标记落在哪一条上"） */
function bubbleTextOf(marker: Element | null): string {
  return marker?.closest('.message-bubble')?.textContent ?? '';
}

function renderFriendList(messages: Message[]) {
  return render(
    <ChatMessages messages={messages} session={SESSION} friend={FRIEND} conversationType="friend" />,
  );
}

function renderGroupList(messages: GroupMessage[]) {
  return render(<GroupChatMessages messages={messages} currentUserId="me" groupId="g-1" />);
}

beforeEach(() => {
  dbState.peerSeq = 0;
  dbState.groupRows = [];
  chatState.groupMemberRemarks = {};
  chatState.groupMessageBlocks = {};
  chatState.groupSpecialCares = {};
  chatState.friendBlacklistTimes = {};
});

describe('私聊已读标记（ChatMessages 列表级）', () => {
  const THREE_OWN = [
    friendMsg('u3', '第三条', 3),
    friendMsg('u2', '第二条', 2),
    friendMsg('u1', '第一条', 1),
  ];

  it('对方已读到最新：三条自己的消息里只有最新那条挂标记，前两条没有', async () => {
    dbState.peerSeq = 100; // 对方读到 seq=100 ⇒ 三条按 seq 判定全部已读
    const { container } = renderFriendList(THREE_OWN);

    await waitFor(() => {
      expect(container.querySelectorAll('.read-receipt-icon.double-check')).toHaveLength(1);
    });
    // 落点必须是最新那条（第三条），不是任意一条
    expect(bubbleTextOf(container.querySelector('.read-receipt-icon.double-check'))).toContain('第三条');
    // 三条气泡都在（防"只渲染了一条"造成的假通过）
    expect(container.querySelectorAll('.message-bubble')).toHaveLength(3);
  }, HEAVY_RENDER_TIMEOUT_MS);

  it('对方一条都没读过：一个标记都不显示（不再是灰色双勾"已送达"）', async () => {
    dbState.peerSeq = 0;
    const { container } = renderFriendList(THREE_OWN);

    await waitFor(() => {
      expect(container.querySelectorAll('.message-bubble')).toHaveLength(3);
    });
    expect(container.querySelectorAll('.read-receipt-icon.double-check')).toHaveLength(0);
    expect(container.querySelector('.read-receipt-icon.unread')).toBeNull();
  }, HEAVY_RENDER_TIMEOUT_MS);

  it('最新一条是对方发的：标记仍挂在我发出的最新一条上（不因对方回话而消失）', async () => {
    dbState.peerSeq = 100;
    const { container } = renderFriendList([
      friendMsg('p1', '对方回话', 4, { sender_id: 'peer', receiver_id: 'me' }),
      friendMsg('u2', '我的第二条', 2),
      friendMsg('u1', '我的第一条', 1),
    ]);

    await waitFor(() => {
      expect(container.querySelectorAll('.read-receipt-icon.double-check')).toHaveLength(1);
    });
    expect(bubbleTextOf(container.querySelector('.read-receipt-icon.double-check'))).toContain('我的第二条');
  }, HEAVY_RENDER_TIMEOUT_MS);

  it('最新一条发送中：它显示时钟（发送状态不受门控影响），标记退到我发出的最新一条已送达消息上', async () => {
    dbState.peerSeq = 100;
    const { container } = renderFriendList([
      friendMsg('s1', '发送中的', 0, { sendStatus: 'sending' }),
      friendMsg('u2', '已送达的第二条', 2),
      friendMsg('u1', '已送达的第一条', 1),
    ]);

    await waitFor(() => {
      expect(container.querySelectorAll('.read-receipt-icon.double-check')).toHaveLength(1);
    });
    expect(bubbleTextOf(container.querySelector('.read-receipt-icon.double-check'))).toContain('已送达的第二条');
    // 发送中那条的时钟槽仍在（本次改动不碰发送状态显示）
    expect(bubbleTextOf(container.querySelector('.read-receipt-icon.sending'))).toContain('发送中的');
  }, HEAVY_RENDER_TIMEOUT_MS);
});

describe('群聊已读标记（GroupChatMessages 列表级）', () => {
  const THREE_OWN = [
    groupMsg('g3', '第三条', 3),
    groupMsg('g2', '第二条', 2),
    groupMsg('g1', '第一条', 1),
  ];

  it('有人已读：三条自己的消息里只有最新那条挂标记，且文案为"N 人已读"', async () => {
    // 3 名成员（含我）⇒ 应读 2；alice 读到 100、bob 还停在 0 ⇒ 最新一条 1 人已读
    dbState.groupRows = [posRow('me', 100), posRow('alice', 100), posRow('bob', 0)];
    const { container } = renderGroupList(THREE_OWN);

    await waitFor(() => {
      expect(container.querySelectorAll('.group-read-receipt')).toHaveLength(1);
    });
    const marker = container.querySelector('.group-read-receipt');
    expect(marker?.querySelector('.group-read-receipt-text')?.textContent).toBe('1 人已读');
    expect(bubbleTextOf(marker)).toContain('第三条');
    expect(container.querySelectorAll('.message-bubble')).toHaveLength(3);
  }, HEAVY_RENDER_TIMEOUT_MS);

  it('没人读过：一个标记都不显示（不再是"0 人已读"）', async () => {
    dbState.groupRows = [posRow('me', 100), posRow('alice', 0), posRow('bob', 0)];
    const { container } = renderGroupList(THREE_OWN);

    await waitFor(() => {
      expect(container.querySelectorAll('.message-bubble')).toHaveLength(3);
    });
    expect(container.querySelectorAll('.group-read-receipt')).toHaveLength(0);
    expect(container.textContent).not.toContain('人已读');
  }, HEAVY_RENDER_TIMEOUT_MS);

  it('最新一条是别人发的：标记仍挂在我发出的最新一条上', async () => {
    dbState.groupRows = [posRow('me', 100), posRow('alice', 100), posRow('bob', 0)];
    const { container } = renderGroupList([
      groupMsg('go1', '别人的消息', 4, { sender_id: 'alice', sender_nickname: 'Alice' }),
      groupMsg('g2', '我的第二条', 2),
      groupMsg('g1', '我的第一条', 1),
    ]);

    await waitFor(() => {
      expect(container.querySelectorAll('.group-read-receipt')).toHaveLength(1);
    });
    expect(bubbleTextOf(container.querySelector('.group-read-receipt'))).toContain('我的第二条');
  }, HEAVY_RENDER_TIMEOUT_MS);
});
